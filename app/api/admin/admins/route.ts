import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, getAdminEmail } from "../../../../lib/requireAdmin";
import { db } from "../../../../lib/firestore";
import { logError } from "../../../../lib/logger";

export async function GET(req: NextRequest) {
  const deny = await requireAdmin(req);
  if (deny) return deny;
  try {
    const snap = await db().collection("admins").get();
    const admins = snap.docs.map(d => ({ email: d.id, ...d.data() }));
    return NextResponse.json({ admins });
  } catch (err) {
    logError("[admin/admins GET]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const deny = await requireAdmin(req);
  if (deny) return deny;
  try {
    const promotedBy = await getAdminEmail(req);
    const { email } = await req.json() as { email?: string };
    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "Valid email required" }, { status: 400 });
    }
    const normalized = email.toLowerCase().trim();
    await db().collection("admins").doc(normalized).set({
      active: true,
      promotedAt: new Date().toISOString(),
      promotedBy: promotedBy ?? "admin",
    }, { merge: true });
    return NextResponse.json({ ok: true, email: normalized });
  } catch (err) {
    logError("[admin/admins POST]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const deny = await requireAdmin(req);
  if (deny) return deny;
  try {
    const callerEmail = await getAdminEmail(req);
    const { email } = await req.json() as { email?: string };
    if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });
    const normalized = email.toLowerCase().trim();
    // Cannot demote yourself
    if (normalized === callerEmail?.toLowerCase()) {
      return NextResponse.json({ error: "Cannot demote yourself" }, { status: 400 });
    }
    // Cannot demote env-var seed admins
    const seed = process.env.ADMIN_EMAILS;
    if (seed && seed.split(",").map(e => e.trim().toLowerCase()).includes(normalized)) {
      return NextResponse.json({ error: "Cannot demote a bootstrap admin" }, { status: 400 });
    }
    await db().collection("admins").doc(normalized).set({ active: false }, { merge: true });
    return NextResponse.json({ ok: true });
  } catch (err) {
    logError("[admin/admins DELETE]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
