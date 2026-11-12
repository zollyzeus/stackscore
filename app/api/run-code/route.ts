import { NextRequest, NextResponse } from "next/server";
import { runJavaScript } from "../../../lib/sandbox";
import { appendTranscript } from "../../../lib/firestore";
import { getCandidateSessionFromRequest } from "../../../lib/candidateAuth";

/**
 * POST /api/run-code
 * { sessionId, stage: "build"|"debug", code: string }
 * Executes in the MVP in-process sandbox and stores the code snapshot.
 */
export async function POST(req: NextRequest) {
  const cand = await getCandidateSessionFromRequest(req);
  if (!cand) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { sessionId, stage, code } = await req.json();

  if (!sessionId || typeof sessionId !== "string") {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }
  if (!["build", "adapt", "debug"].includes(stage)) {
    return NextResponse.json({ error: "Invalid stage" }, { status: 400 });
  }
  if (typeof code !== "string" || code.length > 50_000) {
    return NextResponse.json({ error: "code too large" }, { status: 400 });
  }

  const result = runJavaScript(code);

  await appendTranscript(sessionId, stage, { code, result });

  return NextResponse.json(result);
}
