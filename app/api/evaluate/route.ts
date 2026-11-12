import { NextRequest, NextResponse } from "next/server";
import { judgeSubmission, generateSummaryAndTips } from "../../../lib/judge";
import { computeScoreCard } from "../../../lib/scoring";
import { getTranscript, getSession, saveScore, updateScoreFields, getAllScores } from "../../../lib/firestore";
import { extractFromTranscript } from "../../../lib/transcriptExtract";
import { similarity } from "../../../lib/similarity";
import { notifyPanelist, gradeLabel } from "../../../lib/notify";
import { createReviewTask, isAuthoritativeStatus, type JudgeStatus } from "../../../lib/reviewQueue";
import { enqueueRejudge } from "../../../lib/rejudgeQueue";
import { getScoringHold, enqueuePendingScoring } from "../../../lib/scoringHold";
import { logError } from "../../../lib/logger";
import { requirePanelist } from "../../../lib/requirePanelist";
import { getCandidateSessionFromRequest } from "../../../lib/candidateAuth";
import { nanoid } from "nanoid";

/**
 * POST /api/evaluate
 * { sessionId }
 * Gathers all stage artifacts from Firestore, runs the rubric-constrained
 * judge pass, computes the weighted StackScore, persists, and returns
 * the full score card + a public slug for the shareable score-card URL.
 *
 * Auth: accepts ss_panel (panelist) OR ss_cand where the candidate's email
 * matches the session's candidateEmail (candidate submitting their own assessment).
 */
export async function POST(req: NextRequest) {
  const panelistErr = await requirePanelist(req);
  if (panelistErr) {
    // Not a panelist — check if this is the candidate submitting their own session
    const candSession = await getCandidateSessionFromRequest(req);
    if (!candSession) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    // Candidate email ownership is verified below after session is fetched
    const { sessionId } = await req.clone().json();
    if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });
    const session = await getSession(sessionId).catch(() => null);
    if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });
    const sessionAny = session as unknown as Record<string, unknown>;
    const owner = sessionAny.candidateEmail as string | undefined;
    // A session with no recorded candidateEmail (B2C self-serve) is claimable only by
    // the candidate whose checkpoint/transcript it is; require an explicit match so a
    // logged-in candidate cannot trigger a judge run on an arbitrary session id.
    if (!owner || owner.toLowerCase().trim() !== candSession.email.toLowerCase().trim()) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  try {
    const { sessionId, tabSwitchCount } = await req.json();
    const [session, transcript] = await Promise.all([
      getSession(sessionId),
      getTranscript(sessionId),
    ]);

    const extract = (stage: string, field: string) => extractFromTranscript(transcript, stage, field);

    const twistText = extract("adapt", "text");
    const adaptCode = extract("adapt", "code");
    const submissionInput = {
      brief: session.brief,
      clarifyingTranscript: extract("clarify", "text"),
      designProposal: extract("propose", "text"),
      code: extract("build", "code") || "(no build code submitted — candidate may have used pseudo-code or skipped for time)",
      twistResponse: adaptCode.trim()
        ? `${twistText}\n\n[Revised code after twist]\n${adaptCode}`
        : twistText,
      debugResponse: extract("debug", "code"),
    };

    // Scoring hold (B5). Checked before any model call: the candidate's work is already
    // complete and saved, so a hold parks the judging, never the submission. Nothing the
    // candidate did is lost, and they are told plainly that the score is coming later.
    if (await getScoringHold().catch(() => false)) {
      const heldSlug = nanoid(10);
      await enqueuePendingScoring({
        sessionId,
        publicSlug: heldSlug,
        reason: "scoring paused by the calibration monitor",
      });
      console.warn("[evaluate] SCORING_HELD queued for later judging:", sessionId);
      return NextResponse.json({
        queued: true,
        publicSlug: heldSlug,
        message:
          "Your submission is saved. Scoring is temporarily paused for a calibration check, "
          + "and your result will be available shortly.",
      });
    }

    let axisScores: import("../../../lib/scoring").AxisScores;
    let feedback: Record<string, string>;
    let evidence: Record<string, string> = {};
    let thinkingLog: string | undefined;
    let judgeUsage: import("../../../lib/judge").JudgeUsage | undefined;

    // Provenance of the numbers below. Every surface that shows or counts this score reads
    // it, so it is set on every path -- there is no "unset means fine" default. See
    // lib/reviewQueue.ts for what each value means.
    let judgeStatus: JudgeStatus = "judged";
    let judgeFallbackReason: string | undefined;

    const sessionAny = session as unknown as Record<string, unknown>;

    // Pass 1: the calibrated judge. The normal path.
    try {
      ({ axisScores, feedback, evidence, thinkingLog, usage: judgeUsage } = await judgeSubmission({
        ...submissionInput,
        role: sessionAny.role as string | undefined,
      }));
    } catch (judgeErr: unknown) {
      judgeFallbackReason = judgeErr instanceof Error ? judgeErr.message : String(judgeErr);
      // JUDGE_FALLBACK is the alert token. The service stays healthy during a judge outage
      // -- /api/health reports on the service, not its model dependency -- so this log line
      // is the only runtime signal that scoring is degraded. AUDIT_TODO D8 ran undetected
      // in production for want of exactly this.
      console.error("[evaluate] JUDGE_FALLBACK calibrated judge failed:", judgeFallbackReason);

      // Pass 2: the UNCALIBRATED judge. A real model pass against the bare axis list rather
      // than mechanical placeholder numbers. Retrying the identical prompt would mostly
      // reproduce the identical failure, so the thinner prompt is a genuinely different
      // attempt -- and its output is model judgement, which placeholder arithmetic is not.
      try {
        ({ axisScores, feedback, evidence, thinkingLog, usage: judgeUsage } = await judgeSubmission({
          ...submissionInput,
          role: sessionAny.role as string | undefined,
          calibrated: false,
        }));
        judgeStatus = "partial";
        console.warn("[evaluate] JUDGE_PARTIAL uncalibrated pass succeeded; queueing re-judge");
      } catch (uncalErr: unknown) {
        // Both passes failed. Hold the result rather than inventing one: no AI numbers are
        // shown, and a human review task is created. Axis scores are zeroed only because
        // the record needs a shape -- `judgeStatus` is what every reader must branch on,
        // and the score page refuses to render numbers for a held card.
        const second = uncalErr instanceof Error ? uncalErr.message : String(uncalErr);
        judgeFallbackReason = `calibrated: ${judgeFallbackReason} | uncalibrated: ${second}`;
        judgeStatus = "pending_review";
        console.error("[evaluate] JUDGE_HELD both passes failed:", judgeFallbackReason);
        const zero = 0;
        axisScores = {
          D1: zero, D2: zero, D3: zero, D4: zero, D5: zero,
          K1: zero, K2: zero, K3: zero, K4: zero, K5: zero, K6: zero,
        };
        feedback = {};
        evidence = {};
      }
    }

    const scoreCard = computeScoreCard(axisScores);
    const publicSlug = nanoid(10);

    // Velocity flag: flag stages where submission was implausibly fast
    const proposeElapsed = (() => {
      const entries = (transcript["propose"] ?? []) as Array<Record<string, unknown>>;
      const e = entries.find((x) => typeof x.elapsedSeconds === "number");
      return typeof e?.elapsedSeconds === "number" ? (e.elapsedSeconds as number) : null;
    })();
    const adaptElapsed = (() => {
      const entries = (transcript["adapt"] ?? []) as Array<Record<string, unknown>>;
      const e = entries.find((x) => typeof x.elapsedSeconds === "number");
      return typeof e?.elapsedSeconds === "number" ? (e.elapsedSeconds as number) : null;
    })();
    const fastStages: string[] = [];
    if (proposeElapsed !== null && proposeElapsed < 90) fastStages.push("propose");
    if (adaptElapsed !== null && adaptElapsed < 60) fastStages.push("adapt");
    const fastSubmit = fastStages.length > 0;

    await saveScore(sessionId, publicSlug, scoreCard, feedback, {
      brief: session.brief,
      designProposal: submissionInput.designProposal,
      rowLabel: sessionAny.rowLabel as string | undefined,
      columnLabel: sessionAny.columnLabel as string | undefined,
      role: sessionAny.role as string | undefined,
      candidateName: sessionAny.candidateName as string | undefined,
      candidateEmail: sessionAny.candidateEmail as string | undefined,
      ...(fastSubmit ? { fastSubmit: true, fastSubmitStages: fastStages } : {}),
      ...(typeof tabSwitchCount === "number" && tabSwitchCount > 0 ? { tabSwitchCount } : {}),
      ...(thinkingLog ? { thinkingLog } : {}),
      ...(Object.keys(evidence).length > 0 ? { evidence } : {}),
      judgeStatus,
      ...(judgeFallbackReason ? { judgeFallbackReason } : {}),
      // judgeFallback stays as the single boolean every aggregate filters on, so a new
      // status can never be added without deciding whether it counts in statistics.
      ...(isAuthoritativeStatus(judgeStatus) ? {} : { judgeFallback: true }),
      ...(judgeUsage ? { judgeUsage } : {}),
    });

    // A held score needs a human. Created after saveScore so a task never points at a
    // score document that does not exist.
    if (judgeStatus === "pending_review") {
      await createReviewTask({
        sessionId,
        publicSlug,
        reason: judgeFallbackReason ?? "judge unavailable",
        candidateName: sessionAny.candidateName as string | undefined,
        role: sessionAny.role as string | undefined,
      }).catch((e) => console.error("[evaluate] failed to create review task:", e));
    }

    // A partial score is a placeholder for a proper one. Queue the re-judge; the hourly
    // worker picks it up. Fire-and-forget by design: the candidate must not wait on it.
    if (judgeStatus === "partial") {
      await enqueueRejudge(sessionId, judgeFallbackReason ?? "calibrated pass failed")
        .catch((e) => console.error("[evaluate] failed to enqueue re-judge:", e));
    }

    // Also logged, so cost is visible in Cloud Run logs during an incident without a
    // Firestore round-trip. The stored copy is the one that survives log rotation.
    if (judgeUsage) {
      console.log(
        "[evaluate] JUDGE_USAGE",
        JSON.stringify({ sessionId, ...judgeUsage }),
      );
    }

    // Webhook on completion (non-fatal, background)
    const webhookUrl = process.env.WEBHOOK_URL;
    if (webhookUrl) {
      fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "assessment.completed",
          sessionId,
          publicSlug,
          stackScore: scoreCard.stackScore,
          levelScores: scoreCard.levelScores,
          axisScores,
          candidateName: sessionAny.candidateName,
          candidateEmail: sessionAny.candidateEmail,
          role: sessionAny.role,
          fastSubmit,
          tabSwitchCount,
          judgeStatus,
          scoreCardUrl: `/score/${publicSlug}`,
          timestamp: new Date().toISOString(),
        }),
      }).catch(console.error);
    }

    // Email panelist notification (non-fatal, background)
    notifyPanelist({
      candidateName: sessionAny.candidateName as string | undefined,
      candidateEmail: sessionAny.candidateEmail as string | undefined,
      stackScore: scoreCard.stackScore,
      gradeLabel: gradeLabel(scoreCard.stackScore),
      judgeStatus,
      scoreCardUrl: `/score/${publicSlug}`,
      role: sessionAny.role as string | undefined,
    }).catch(console.error);

    // Generate summary + tips in the background — doesn't block candidate's result
    generateSummaryAndTips({
      brief: session.brief,
      role: sessionAny.role as string | undefined,
      axisScores,
      feedback,
    }).then(({ summary, tips }) => {
      if (summary) {
        return updateScoreFields(sessionId, { summary, ...(Object.keys(tips).length ? { tips } : {}) });
      }
    }).catch(console.error);

    // Similarity check: compare design proposal against recent submissions
    const designText = submissionInput.designProposal;
    if (designText && designText.length > 100) {
      getAllScores(100).then((recent) => {
        const others = recent.filter((s) => s.docId !== sessionId);
        for (const other of others) {
          const otherDesign = (other.designProposal as string | undefined) ?? "";
          if (!otherDesign) continue;
          const sim = similarity(designText, otherDesign);
          if (sim > 0.6) {
            updateScoreFields(sessionId, { similarToSessionId: other.docId as string, similarityScore: Math.round(sim * 100) }).catch(console.error);
            break;
          }
        }
      }).catch(console.error);
    }

    return NextResponse.json({
      ...scoreCard,
      feedback,
      scoreCardUrl: `/score/${publicSlug}`,
    });
  } catch (err) {
    logError("[evaluate]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
