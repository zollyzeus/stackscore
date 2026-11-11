import { NextRequest, NextResponse } from "next/server";
import { getScoresByEmail } from "../../../../lib/firestore";
import { getCandidateSessionFromRequest } from "../../../../lib/candidateAuth";
import { getPanelistSession } from "../../../../lib/requirePanelist";
import { logError } from "../../../../lib/logger";

/**
 * GET /api/candidate/history
 *
 * Returns the signed-in candidate's own score history. The email is taken from the
 * session cookie, never from a query parameter — an `?email=` parameter previously made
 * every candidate's scores readable by anyone.
 *
 * Panelists may look up a specific candidate via ?email= (they administer sessions).
 */
export async function GET(req: NextRequest) {
  const cand = await getCandidateSessionFromRequest(req);
  const panelist = cand ? null : await getPanelistSession(req);

  let email: string | null = null;
  if (cand?.email) {
    email = cand.email;
  } else if (panelist) {
    email = req.nextUrl.searchParams.get("email");
    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "valid email required" }, { status: 400 });
    }
  } else {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const scores = await getScoresByEmail(email);
    return NextResponse.json({ scores });
  } catch (err) {
    logError("[candidate/history]", err);
    return NextResponse.json({ error: "failed to fetch history" }, { status: 500 });
  }
}
