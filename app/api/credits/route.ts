import { NextRequest, NextResponse } from "next/server";
import { requirePanelist, getPanelistEmail } from "../../../lib/requirePanelist";
import { getPanelistCreditInfo } from "../../../lib/freeCredits";
import { logError } from "../../../lib/logger";

export async function GET(req: NextRequest) {
  const deny = await requirePanelist(req);
  if (deny) return deny;
  try {
    const email = await getPanelistEmail(req);
    if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const info = await getPanelistCreditInfo(email);
    return NextResponse.json(info);
  } catch (err) {
    logError("[credits]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
