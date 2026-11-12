import { NextRequest, NextResponse } from "next/server";
import { stakeholderReply } from "../../../lib/vertex";
import { appendTranscript } from "../../../lib/firestore";
import { logError } from "../../../lib/logger";
import { getCandidateSessionFromRequest } from "../../../lib/candidateAuth";

export async function POST(req: NextRequest) {
  const cand = await getCandidateSessionFromRequest(req);
  if (!cand) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const { sessionId, brief, history, question, elapsedSeconds } = await req.json();

    if (!question?.trim()) {
      return NextResponse.json({ reply: "Could you elaborate on that?" });
    }
    if (typeof question !== "string" || question.length > 4000) {
      return NextResponse.json({ error: "question too large" }, { status: 400 });
    }

    // Route design proposal and adapt response to their own transcript stages
    // so the judge can read them from the correct stage fields.
    if (question.startsWith("[DESIGN PROPOSAL]")) {
      const text = question.replace("[DESIGN PROPOSAL]\n", "").trim();
      const entry: Record<string, unknown> = { role: "candidate", text };
      if (typeof elapsedSeconds === "number") entry.elapsedSeconds = elapsedSeconds;
      await appendTranscript(sessionId, "propose", entry);
      return NextResponse.json({ reply: "" });
    }

    if (question.startsWith("[ADAPT RESPONSE]")) {
      const text = question.replace("[ADAPT RESPONSE]\n", "").trim();
      const entry: Record<string, unknown> = { role: "candidate", text };
      if (typeof elapsedSeconds === "number") entry.elapsedSeconds = elapsedSeconds;
      await appendTranscript(sessionId, "adapt", entry);
      return NextResponse.json({ reply: "" });
    }

    const reply = await stakeholderReply({ brief, history: history ?? [], question });

    await appendTranscript(sessionId, "clarify", { role: "candidate", text: question });
    await appendTranscript(sessionId, "clarify", { role: "stakeholder", text: reply });

    return NextResponse.json({ reply });
  } catch (err) {
    logError("[stakeholder-chat]", err);
    return NextResponse.json(
      { reply: "I'm not sure how to answer that right now — could you rephrase or move on?" },
      { status: 200 } // return 200 so the UI doesn't crash; degrade gracefully
    );
  }
}
