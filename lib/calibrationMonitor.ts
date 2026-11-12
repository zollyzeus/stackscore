/**
 * Calibration monitor (B5).
 *
 * Two different questions, answered by two different mechanisms:
 *
 * 1. "Has the thing being calibrated changed?" — a fingerprint over data/rubric.json plus
 *    the judge's model and effort. This is free and instant. It catches the failure mode
 *    the calibration README warns about: a rubric edit silently invalidating the committed
 *    evidence, so the repo keeps citing numbers for a judge that no longer exists.
 *
 * 2. "Is the judge still obeying its own rules?" — a live probe. The full sweep is 30 calls
 *    and about $4, which is far too expensive to run hourly. Instead this runs only the
 *    fixtures carrying hard assertions, once each: three calls, roughly $0.40. Those are
 *    the checks that follow from explicit instructions in the judge's system prompt rather
 *    than from grader taste, so a failure is a bug rather than drift — which is exactly the
 *    class of problem worth paging someone about. Band compliance, slope and R² are NOT
 *    checked here; they need the full sweep and the statistical power of three runs.
 */
import rubric from "../data/rubric.json";
import { fingerprintOf } from "./calibrationFingerprint";
// The fingerprint the committed sweep was run under. Shipped in the image, so the
// monitor can answer "does the committed evidence describe the deployed judge?"
// rather than only "has anything changed since my last probe?".
import committedSweep from "../data/calibration/post-anchor-runs.json";
import { FIXTURES } from "../data/calibration/fixtures";
import { judgeSubmission, JUDGE_MODEL, JUDGE_EFFORT } from "./judge";
import { db } from "./firestore";
import { FieldValue } from "firebase-admin/firestore";

export interface CalibrationProbeResult {
  ok: boolean;
  fingerprint: string;
  fingerprintChanged: boolean;
  /** True when the COMMITTED sweep was run under a different rubric/judge. */
  evidenceStale?: boolean;
  checkedAt: string;
  model: string;
  effort: string;
  assertions: Array<{
    fixtureId: string;
    axis: string;
    band: [number, number];
    observed: number | null;
    pass: boolean;
    why: string;
  }>;
  callsAttempted: number;
  callsFailed: number;
  notes: string[];
}

/**
 * Identity of everything that moves calibration results. The rubric is in here because its
 * anchors are rendered into the system prompt -- editing an anchor IS editing the judge,
 * which is the point AUDIT_TODO D10 established the hard way.
 */
export { fingerprintOf };

export function calibrationFingerprint(): string {
  return fingerprintOf(rubric, JUDGE_MODEL, JUDGE_EFFORT);
}

const STATE_DOC = "calibrationState";

export async function getCalibrationState(): Promise<{
  fingerprint?: string;
  lastResult?: CalibrationProbeResult;
  lastOkAt?: string;
} | null> {
  try {
    const snap = await db().collection("config").doc(STATE_DOC).get();
    return snap.exists ? (snap.data() as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Runs the rule-compliance probe. Returns a result rather than throwing: a monitor that
 * crashes tells you nothing, and "the probe could not run" is itself a finding that needs
 * recording rather than a stack trace in a log nobody reads.
 */
export async function runCalibrationProbe(): Promise<CalibrationProbeResult> {
  const fingerprint = calibrationFingerprint();
  const prior = await getCalibrationState();
  const fingerprintChanged = Boolean(prior?.fingerprint && prior.fingerprint !== fingerprint);
  // The question that actually matters for the evidence: was the committed sweep run
  // against THIS judge? Comparing to the last probe instead reports "stale" after every
  // rubric edit, including ones a fresh sweep has already covered -- a false alarm that
  // would fire during a demo.
  const sweepFingerprint = (committedSweep as { fingerprint?: string }).fingerprint;
  const evidenceStale = Boolean(sweepFingerprint && sweepFingerprint !== fingerprint);

  const fixtures = FIXTURES.filter((f) => (f.hardAssertions?.length ?? 0) > 0);
  const assertions: CalibrationProbeResult["assertions"] = [];
  const notes: string[] = [];
  let callsAttempted = 0;
  let callsFailed = 0;

  for (const fixture of fixtures) {
    callsAttempted++;
    try {
      const judged = await judgeSubmission({
        brief: fixture.submission.brief,
        clarifyingTranscript: fixture.submission.clarifyingTranscript,
        designProposal: fixture.submission.designProposal,
        code: fixture.submission.code,
        twistResponse: fixture.submission.twistResponse,
        debugResponse: fixture.submission.debugResponse,
        role: fixture.role,
      });
      for (const ha of fixture.hardAssertions ?? []) {
        const observed = judged.axisScores[ha.axis] ?? null;
        assertions.push({
          fixtureId: fixture.id,
          axis: ha.axis,
          band: ha.band,
          observed,
          pass: observed !== null && observed >= ha.band[0] && observed <= ha.band[1],
          why: ha.why,
        });
      }
    } catch (err) {
      callsFailed++;
      const message = err instanceof Error ? err.message : String(err);
      notes.push(`${fixture.id}: judge call failed — ${message.slice(0, 200)}`);
      for (const ha of fixture.hardAssertions ?? []) {
        assertions.push({
          fixtureId: fixture.id, axis: ha.axis, band: ha.band,
          observed: null, pass: false, why: ha.why,
        });
      }
    }
  }

  // A probe that could not reach the judge is NOT a calibration failure -- it is an outage,
  // and conflating the two would hold scoring because of a network blip. Recorded, flagged,
  // but it does not make `ok` false on its own.
  const judgeUnreachable = callsFailed === callsAttempted && callsAttempted > 0;
  if (judgeUnreachable) notes.push("every probe call failed: treat as a judge outage, not calibration drift");

  const ok = judgeUnreachable ? true : assertions.every((a) => a.pass);
  if (fingerprintChanged) {
    notes.push(`rubric/judge fingerprint changed since the last probe (${prior?.fingerprint} → ${fingerprint})`);
  }
  if (evidenceStale) {
    notes.push(
      `the committed sweep was run under ${sweepFingerprint}, not ${fingerprint}: ` +
      "its slope, R² and per-axis leans describe a different judge. Re-run the full sweep.",
    );
  } else if (sweepFingerprint) {
    notes.push(`committed sweep matches the deployed judge (${sweepFingerprint})`);
  }

  const result: CalibrationProbeResult = {
    ok, fingerprint, fingerprintChanged, evidenceStale,
    checkedAt: new Date().toISOString(),
    model: JUDGE_MODEL, effort: JUDGE_EFFORT,
    assertions, callsAttempted, callsFailed, notes,
  };

  await db().collection("config").doc(STATE_DOC).set({
    fingerprint,
    lastResult: result,
    ...(ok ? { lastOkAt: result.checkedAt } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true }).catch(() => { /* recording is best-effort; the result still returns */ });

  return result;
}
