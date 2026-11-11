import { NextRequest, NextResponse } from "next/server";
import { requirePanelist, getPanelistEmail } from "../../../lib/requirePanelist";
import { updateScoreFields } from "../../../lib/firestore";
import { awardPanelistCredit } from "../../../lib/freeCredits";
import { logError } from "../../../lib/logger";

export async function POST(req: NextRequest) {
  const deny = await requirePanelist(req);
  if (deny) return deny;
  try {
    const email = await getPanelistEmail(req);
    if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const { sessionId, rating, notes } = await req.json() as {
      sessionId?: string;
      rating?: "exceeded" | "met" | "below";
      notes?: string;
    };

    if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });
    const validRatings = ["exceeded", "met", "below"];
    if (!rating || !validRatings.includes(rating)) {
      return NextResponse.json({ error: "rating must be exceeded, met, or below" }, { status: 400 });
    }

    await updateScoreFields(sessionId, {
      outcomeFeedback: {
        rating,
        ...(notes?.trim() ? { notes: notes.trim() } : {}),
        recordedAt: new Date().toISOString(),
        recordedBy: email,
      },
    });

    // Award 1 purchased credit as incentive
    await awardPanelistCredit(email);

    return NextResponse.json({ ok: true, credited: true });
  } catch (err) {
    logError("[outcome-feedback]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
