import { NextRequest, NextResponse } from "next/server";
import { runCalibrationProbe } from "../../../../lib/calibrationMonitor";
import { getSettings } from "../../../../lib/settings";
import { setScoringHold, getScoringHold } from "../../../../lib/scoringHold";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Hourly calibration monitor (B5).
 *
 * Runs the rule-compliance probe and records the result. Whether a failure PAUSES scoring
 * depends on the admin setting `scoringHoldEnabled`, which defaults to false — see
 * lib/settings.ts for why alert-only is the default posture.
 *
 * Bearer-token authed and fails closed: this endpoint spends money on model calls, so an
 * open version is a billing vulnerability as much as an access-control one.
 */
function authorised(req: NextRequest): boolean {
  const expected = process.env.TASK_RUNNER_SECRET;
  if (!expected) return false;
  return req.headers.get("authorization") === `Bearer ${expected}`;
}

export async function POST(req: NextRequest) {
  if (!authorised(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const result = await runCalibrationProbe();
  const settings = await getSettings();
  const failed = result.assertions.filter((a) => !a.pass);

  if (!result.ok) {
    // CALIBRATION_FAILED is the alert token. A hard assertion is something the judge was
    // explicitly instructed to do, so failing one is a bug, not drift -- it is worth
    // waking someone for whether or not the hold is switched on.
    console.error("[calibration-monitor] CALIBRATION_FAILED", JSON.stringify({
      fingerprint: result.fingerprint,
      failures: failed.map((f) => `${f.fixtureId}/${f.axis}=${f.observed} want ${f.band[0]}-${f.band[1]}`),
    }));
  }
  if (result.fingerprintChanged) {
    console.warn("[calibration-monitor] CALIBRATION_STALE", JSON.stringify({
      fingerprint: result.fingerprint,
      note: "rubric or judge changed; committed sweep results no longer describe this judge",
    }));
  }

  let holdAction: "none" | "engaged" | "released" | "would_engage" = "none";
  const holdWasActive = await getScoringHold();

  if (!result.ok && !settings.scoringHoldEnabled) {
    // The whole point of the default: say loudly what would have happened, and change
    // nothing. An operator can read this and decide.
    holdAction = "would_engage";
    console.warn("[calibration-monitor] hold is DISABLED; scoring continues despite the failure");
  } else if (!result.ok && settings.scoringHoldEnabled) {
    await setScoringHold(true, `calibration probe failed at ${result.checkedAt}`);
    holdAction = "engaged";
  } else if (result.ok && holdWasActive) {
    // Auto-release only a hold the monitor itself engaged. A human who paused scoring
    // deliberately must not have it silently resumed by a passing probe.
    await setScoringHold(false, `calibration probe passed at ${result.checkedAt}`, { onlyIfAutomatic: true });
    holdAction = "released";
  }

  return NextResponse.json({
    ok: result.ok,
    fingerprint: result.fingerprint,
    fingerprintChanged: result.fingerprintChanged,
    holdEnabled: settings.scoringHoldEnabled,
    holdAction,
    callsAttempted: result.callsAttempted,
    callsFailed: result.callsFailed,
    failures: failed,
    notes: result.notes,
  });
}
