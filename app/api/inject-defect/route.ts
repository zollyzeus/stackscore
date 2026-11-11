import { NextRequest, NextResponse } from "next/server";
import { generateDefect } from "../../../lib/vertex";
import { appendTranscript, getTranscript } from "../../../lib/firestore";
import { runJavaScript } from "../../../lib/sandbox";
import { logError } from "../../../lib/logger";
import { getCandidateSessionFromRequest } from "../../../lib/candidateAuth";

export async function POST(req: NextRequest) {
  const cand = await getCandidateSessionFromRequest(req);
  if (!cand) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const { sessionId } = await req.json();
    const transcript = await getTranscript(sessionId);

    // Prefer updated code from adapt stage (candidate revised after twist), fall back to build
    const adaptEntries = (transcript["adapt"] ?? []) as Array<{ code?: string }>;
    const buildEntries = (transcript["build"] ?? []) as Array<{ code?: string }>;
    const latestCode =
      [...adaptEntries].reverse().find((e) => e.code?.trim())?.code ||
      buildEntries.at(-1)?.code ||
      "// candidate did not submit code\nfunction solution(input) { return input; }";

    // Only inject a defect if the code is substantive and parses cleanly.
    const MIN_CODE_LENGTH = 30;
    const trial = runJavaScript(latestCode, 1000);
    const isJunk = latestCode.trim().length < MIN_CODE_LENGTH || trial.error?.includes("SyntaxError");

    let buggedCode: string;
    let hint: string;

    if (isJunk) {
      // Pseudo-code or syntax errors — treat as an approach description, seed a conceptual defect
      buggedCode = latestCode;
      hint = "The submission uses pseudo-code or has syntax issues. Review the logical approach for missing edge cases, incorrect assumptions, or off-by-one errors in the described algorithm.";
    } else {
      try {
        ({ buggedCode, hint } = await generateDefect(latestCode));
      } catch {
        // AI defect injection failed — pass code through, let candidate debug their own work
        buggedCode = latestCode;
        hint = "Review the code carefully for any logic errors, off-by-ones, or missing edge cases.";
      }
    }

    await appendTranscript(sessionId, "debug", { buggedCode, hint, role: "system" });

    return NextResponse.json({ buggedCode, hint });
  } catch (err) {
    logError("[inject-defect]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
