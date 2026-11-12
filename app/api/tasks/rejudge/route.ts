import { NextRequest, NextResponse } from "next/server";
import { judgeSubmission } from "../../../../lib/judge";
import { computeScoreCard } from "../../../../lib/scoring";
import { db } from "../../../../lib/firestore";
import {
  listPendingRejudges, markRejudgeDone, markRejudgeAttemptFailed,
} from "../../../../lib/rejudgeQueue";
import { createReviewTask } from "../../../../lib/reviewQueue";
import { logError } from "../../../../lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Re-judge worker (A3). Drains the queue of `partial` scores, re-running the calibrated
 * judge on the candidate's original submission.
 *
 * Authentication is a shared bearer token rather than a user session: this is called by a
 * scheduler, not a person. It is NOT behind the admin cookie, because an admin session is
 * a browser artifact and a cron job does not have one.
 */
function authorised(req: NextRequest): boolean {
  const expected = process.env.TASK_RUNNER_SECRET;
  // Fail closed. An unset secret must not mean "anyone may drain the queue and spend money
  // on model calls" -- an open endpoint that triggers paid work is a billing vulnerability
  // as much as an access-control one.
  if (!expected) return false;
  const got = req.headers.get("authorization");
  return got === `Bearer ${expected}`;
}

export async function POST(req: NextRequest) {
  if (!authorised(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const batch = await listPendingRejudges(10);
  const results: Array<{ sessionId: string; outcome: string }> = [];

  for (const task of batch) {
    try {
      const snap = await db().collection("sessions").doc(task.sessionId).get();
      if (!snap.exists) {
        await markRejudgeDone(task.sessionId);
        results.push({ sessionId: task.sessionId, outcome: "session_gone" });
        continue;
      }
      const s = snap.data() ?? {};
      const transcript = (s.transcript ?? {}) as Record<string, Array<Record<string, unknown>>>;
      const extract = (stage: string, field: string): string => {
        const entries = transcript[stage] ?? [];
        const hit = entries.find((e) => typeof e[field] === "string");
        return (hit?.[field] as string) ?? "";
      };

      const judged = await judgeSubmission({
        brief: (s.brief as string) ?? "",
        clarifyingTranscript: extract("clarify", "transcript") || extract("clarify", "text"),
        designProposal: extract("propose", "text") || extract("propose", "design"),
        code: extract("implement", "code"),
        twistResponse: extract("adapt", "text"),
        debugResponse: extract("debug", "code") || extract("debug", "text"),
        role: s.role as string | undefined,
      });

      const card = computeScoreCard(judged.axisScores);
      await db().collection("scores").doc(task.sessionId).update({
        axisScores: judged.axisScores,
        feedback: judged.feedback,
        evidence: judged.evidence,
        stackScore: card.stackScore,
        levelScores: card.levelScores,
        judgeStatus: "judged",
        judgeFallback: false,
        ...(judged.usage ? { judgeUsage: judged.usage } : {}),
      });
      await markRejudgeDone(task.sessionId);
      results.push({ sessionId: task.sessionId, outcome: "rejudged" });
      console.log("[rejudge] REJUDGE_OK", JSON.stringify({ sessionId: task.sessionId, stackScore: card.stackScore }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const exhausted = await markRejudgeAttemptFailed(task.sessionId, message)
        .catch(() => false);
      if (exhausted) {
        // Out of attempts. Escalate rather than retry forever: a submission the judge has
        // now failed four times is not going to succeed on the fifth, and the candidate is
        // still waiting. A human takes it from here.
        const scoreSnap = await db().collection("scores").doc(task.sessionId).get();
        const sc = scoreSnap.data() ?? {};
        await db().collection("scores").doc(task.sessionId).update({
          judgeStatus: "pending_review",
          judgeFallback: true,
          judgeFallbackReason: `re-judge exhausted after repeated failures: ${message}`.slice(0, 500),
        });
        await createReviewTask({
          sessionId: task.sessionId,
          publicSlug: (sc.publicSlug as string) ?? task.sessionId,
          reason: `re-judge exhausted: ${message}`,
          candidateName: sc.candidateName as string | undefined,
          role: sc.role as string | undefined,
        }).catch((e) => logError("[rejudge] createReviewTask", e));
        results.push({ sessionId: task.sessionId, outcome: "escalated_to_review" });
        console.error("[rejudge] REJUDGE_EXHAUSTED", JSON.stringify({ sessionId: task.sessionId }));
      } else {
        results.push({ sessionId: task.sessionId, outcome: "retry_later" });
      }
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
