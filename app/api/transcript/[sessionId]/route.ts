import { NextRequest, NextResponse } from "next/server";
import { getTranscript, getSession } from "../../../../lib/firestore";
import { logError } from "../../../../lib/logger";
import { getCandidateSessionFromRequest } from "../../../../lib/candidateAuth";
import { getPanelistSession } from "../../../../lib/requirePanelist";

/**
 * A transcript may be read by any active panelist, or by the candidate who owns the
 * session. See the note in session/[id]/checkpoint — verifySessionToken returns null
 * rather than throwing, so this must branch on its return value.
 */
async function authorised(
  req: NextRequest,
  session: { candidateEmail?: string }
): Promise<boolean> {
  if (await getPanelistSession(req)) return true;

  const cand = await getCandidateSessionFromRequest(req);
  if (cand?.email && session.candidateEmail) {
    return cand.email.toLowerCase().trim() === String(session.candidateEmail).toLowerCase().trim();
  }
  return false;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  try {
    // Verify the session has been evaluated before exposing transcript
    const session = await getSession(params.sessionId).catch(() => null);
    if (!session || session.status !== "evaluated") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    if (!(await authorised(req, session))) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const transcript = await getTranscript(params.sessionId);
    return NextResponse.json({ transcript });
  } catch (err) {
    logError("[transcript]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
