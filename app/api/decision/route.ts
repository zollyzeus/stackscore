import { NextRequest, NextResponse } from "next/server";
import { setDecision } from "../../../lib/firestore";
import { requirePanelist } from "../../../lib/requirePanelist";
import { logError } from "../../../lib/logger";

export async function POST(req: NextRequest) {
  const deny = await requirePanelist(req);
  if (deny) return deny;
  try {
    const { sessionId, decision } = await req.json();
    if (!sessionId) return new NextResponse("sessionId required", { status: 400 });
    const valid = ["shortlist", "hold", "reject", null];
    if (!valid.includes(decision)) return new NextResponse("invalid decision", { status: 400 });
    await setDecision(sessionId, decision);
    return NextResponse.json({ ok: true });
  } catch (err) {
    logError("[decision]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
