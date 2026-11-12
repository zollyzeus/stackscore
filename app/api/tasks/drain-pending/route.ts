import { NextRequest, NextResponse } from "next/server";
import { judgeSubmission } from "../../../../lib/judge";
import { computeScoreCard } from "../../../../lib/scoring";
import { db } from "../../../../lib/firestore";
import { getScoringHold, listPendingScoring, markPendingScoringDone } from "../../../../lib/scoringHold";
import { saveScore } from "../../../../lib/firestore";
import { logError } from "../../../../lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Drains submissions that were queued while scoring was paused (B5).
 *
 * Refuses to run while the hold is still active. Draining into a paused pipeline would
 * defeat the pause: the whole reason to hold is that the judge is not trusted right now,
 * so scoring the backlog with it produces exactly the results the hold existed to prevent.
 */
function authorised(req: NextRequest): boolean {
  const expected = process.env.TASK_RUNNER_SECRET;
  if (!expected) return false;
  return req.headers.get("authorization") === `Bearer ${expected}`;
}

export async function POST(req: NextRequest) {
  if (!authorised(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (await getScoringHold()) {
    return NextResponse.json({ skipped: true, reason: "scoring is still held" });
  }

  const batch = await listPendingScoring(10);
  const results: Array<{ sessionId: string; outcome: string }> = [];

  for (const job of batch) {
    try {
      const snap = await db().collection("sessions").doc(job.sessionId).get();
      if (!snap.exists) {
        await markPendingScoringDone(job.sessionId);
        results.push({ sessionId: job.sessionId, outcome: "session_gone" });
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
      await saveScore(job.sessionId, job.publicSlug, card, judged.feedback, {
        brief: s.brief as string | undefined,
        role: s.role as string | undefined,
        candidateName: s.candidateName as string | undefined,
        candidateEmail: s.candidateEmail as string | undefined,
        rowLabel: s.rowLabel as string | undefined,
        columnLabel: s.columnLabel as string | undefined,
        judgeStatus: "judged",
        ...(judged.usage ? { judgeUsage: judged.usage } : {}),
      });
      await markPendingScoringDone(job.sessionId);
      results.push({ sessionId: job.sessionId, outcome: "scored" });
    } catch (err) {
      logError("[drain-pending]", err);
      results.push({ sessionId: job.sessionId, outcome: "retry_later" });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
