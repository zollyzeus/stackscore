import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/requireAdmin";
import { db } from "../../../../lib/firestore";
import { getPanelistCreditInfo, awardPanelistCredit } from "../../../../lib/freeCredits";
import { logError } from "../../../../lib/logger";

export async function GET(req: NextRequest) {
  const deny = await requireAdmin(req);
  if (deny) return deny;
  try {
    const panelistSnap = await db().collection("panelists").get();
    const emails = panelistSnap.docs.map(d => d.id);
    const creditInfos = await Promise.all(
      emails.map(async email => ({ email, ...(await getPanelistCreditInfo(email)) }))
    );
    return NextResponse.json({ credits: creditInfos });
  } catch (err) {
    logError("[admin/credits GET]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const deny = await requireAdmin(req);
  if (deny) return deny;
  try {
    const { email, amount } = await req.json() as { email?: string; amount?: number };
    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "Valid email required" }, { status: 400 });
    }
    if (!amount || typeof amount !== "number" || amount < 1 || amount > 100) {
      return NextResponse.json({ error: "amount must be 1–100" }, { status: 400 });
    }
    for (let i = 0; i < amount; i++) await awardPanelistCredit(email);
    return NextResponse.json({ ok: true, email, awarded: amount });
  } catch (err) {
    logError("[admin/credits POST]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
