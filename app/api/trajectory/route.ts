import { NextRequest, NextResponse } from "next/server";
import { getScoresByEmail } from "../../../lib/firestore";
import { getCandidateSessionFromRequest } from "../../../lib/candidateAuth";
import { getPanelistSession } from "../../../lib/requirePanelist";
import { logError } from "../../../lib/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/trajectory
 *
 * Score trajectory for the signed-in candidate. As with /api/candidate/history, the
 * email comes from the session, not a query parameter. Panelists may pass ?email=.
 *
 * Uses the indexed getScoresByEmail query rather than scanning getAllScores(500) and
 * filtering in memory.
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
    const mine = (await getScoresByEmail(email, 100)).slice().sort((a, b) => {
      const ta = typeof (a.createdAt as { toDate?: () => Date })?.toDate === "function"
        ? (a.createdAt as { toDate: () => Date }).toDate().getTime() : 0;
      const tb = typeof (b.createdAt as { toDate?: () => Date })?.toDate === "function"
        ? (b.createdAt as { toDate: () => Date }).toDate().getTime() : 0;
      return ta - tb;
    });

    const attempts = mine.map((s) => ({
      date: typeof (s.createdAt as { toDate?: () => Date })?.toDate === "function"
        ? (s.createdAt as { toDate: () => Date }).toDate().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" })
        : "",
      stackScore: s.stackScore as number,
      design: (s.levelScores as { design: number; code: number } | undefined)?.design ?? 0,
      code: (s.levelScores as { design: number; code: number } | undefined)?.code ?? 0,
      scoreCardUrl: `/score/${s.publicSlug}`,
    }));

    return NextResponse.json({ attempts });
  } catch (err) {
    logError("[trajectory]", err);
    return NextResponse.json({ attempts: [], error: "internal_error" }, { status: 500 });
  }
}
