import { NextRequest, NextResponse } from "next/server";
import { saveCheckpoint, loadCheckpoint, getSession } from "../../../../../lib/firestore";
import { getCandidateSessionFromRequest } from "../../../../../lib/candidateAuth";
import { getPanelistSession } from "../../../../../lib/requirePanelist";

/**
 * A checkpoint may be read/written by:
 *  - any active panelist (they administer sessions), or
 *  - the candidate who owns the session (email must match the session's candidateEmail).
 *
 * NOTE: verifySessionToken returns null on failure and never throws, so this must branch
 * on its return value. An earlier version wrapped it in try/catch and returned true
 * unconditionally, which let any ss_panel cookie value through.
 */
async function authorise(req: NextRequest, sessionId: string): Promise<boolean> {
  const session = await getSession(sessionId).catch(() => null);
  if (!session) return false;

  if (await getPanelistSession(req)) return true;

  const cand = await getCandidateSessionFromRequest(req);
  if (cand?.email && session.candidateEmail) {
    return cand.email.toLowerCase().trim() === String(session.candidateEmail).toLowerCase().trim();
  }

  return false;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await authorise(req, params.id))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const cp = await loadCheckpoint(params.id);
    if (!cp) return NextResponse.json(null);
    return NextResponse.json(cp);
  } catch {
    return NextResponse.json(null);
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await authorise(req, params.id))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const body = await req.json();
    await saveCheckpoint(params.id, body);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "checkpoint save failed" }, { status: 500 });
  }
}
