import { NextRequest, NextResponse } from "next/server";
import { judgeSubmission, generateSummaryAndTips } from "../../../lib/judge";
import { computeScoreCard } from "../../../lib/scoring";
import { getTranscript, getSession, updateScoreFields } from "../../../lib/firestore";
import { extractFromTranscript } from "../../../lib/transcriptExtract";
import { requirePanelist } from "../../../lib/requirePanelist";
import { logError } from "../../../lib/logger";

/**
 * POST /api/re-evaluate
 * { sessionId }
 * Re-runs the judge on an already-evaluated submission.
 * Panelist-triggered; updates the existing score doc in place.
 */
export async function POST(req: NextRequest) {
  const deny = await requirePanelist(req);
  if (deny) return deny;
  try {
    const { sessionId } = await req.json();
    if (!sessionId) return new NextResponse("sessionId required", { status: 400 });

    const [session, transcript] = await Promise.all([
      getSession(sessionId),
      getTranscript(sessionId),
    ]);

    const extract = (stage: string, field: string) => extractFromTranscript(transcript, stage, field);

    const sessionAny = session as unknown as Record<string, unknown>;
    const twistText = extract("adapt", "text");
    const adaptCode = extract("adapt", "code");

    const { axisScores, feedback, evidence, thinkingLog } = await judgeSubmission({
      brief: session.brief,
      clarifyingTranscript: extract("clarify", "text"),
      designProposal: extract("propose", "text"),
      code: extract("build", "code") || "(no build code submitted)",
      twistResponse: adaptCode.trim()
        ? `${twistText}\n\n[Revised code after twist]\n${adaptCode}`
        : twistText,
      debugResponse: extract("debug", "code"),
      role: sessionAny.role as string | undefined,
    });

    const scoreCard = computeScoreCard(axisScores);

    await updateScoreFields(sessionId, {
      ...scoreCard,
      feedback,
      ...(thinkingLog ? { thinkingLog } : {}),
      ...(Object.keys(evidence).length > 0 ? { evidence } : {}),
      reEvaluatedAt: new Date().toISOString(),
    });

    // Re-generate summary + tips in background
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

    return NextResponse.json({ ...scoreCard, feedback });
  } catch (err) {
    logError("[re-evaluate]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
