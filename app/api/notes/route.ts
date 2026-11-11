import { NextRequest, NextResponse } from "next/server";
import { setNotes } from "../../../lib/firestore";
import { requirePanelist } from "../../../lib/requirePanelist";
import { logError } from "../../../lib/logger";

export async function POST(req: NextRequest) {
  const deny = await requirePanelist(req);
  if (deny) return deny;
  try {
    const { sessionId, notes } = await req.json();
    if (!sessionId) return new NextResponse("sessionId required", { status: 400 });
    await setNotes(sessionId, typeof notes === "string" ? notes : "");
    return NextResponse.json({ ok: true });
  } catch (err) {
    logError("[notes]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
