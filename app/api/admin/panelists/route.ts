import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, getAdminEmail } from "../../../../lib/requireAdmin";
import { db } from "../../../../lib/firestore";
import { logError } from "../../../../lib/logger";

// GET — list all Firestore-registered panelists
export async function GET(req: NextRequest) {
  const deny = await requireAdmin(req);
  if (deny) return deny;
  try {
    const snaps = await db().collection("panelists").orderBy("addedAt", "desc").get();
    const panelists = snaps.docs.map((d) => ({ email: d.id, ...d.data() }));
    return NextResponse.json({ panelists });
  } catch (err) {
    logError("[admin/panelists GET]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

// POST { email } — add a new panelist. Admin-only: letting any panelist invite
// another made every panelist able to grant panelist access laterally.
export async function POST(req: NextRequest) {
  const deny = await requireAdmin(req);
  if (deny) return deny;
  try {
    const invitedBy = await getAdminEmail(req);
    const { email } = await req.json() as { email?: string };
    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "Valid email required" }, { status: 400 });
    }
    const normalized = email.toLowerCase().trim();
    await db().collection("panelists").doc(normalized).set({
      active: true,
      addedAt: new Date().toISOString(),
      invitedBy: invitedBy ?? "unknown",
    }, { merge: true });
    return NextResponse.json({ ok: true, email: normalized });
  } catch (err) {
    logError("[admin/panelists POST]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

// DELETE { email } — deactivate a panelist
export async function DELETE(req: NextRequest) {
  const deny = await requireAdmin(req);
  if (deny) return deny;
  try {
    const { email } = await req.json() as { email?: string };
    if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });
    const normalized = email.toLowerCase().trim();
    await db().collection("panelists").doc(normalized).set({ active: false }, { merge: true });
    return NextResponse.json({ ok: true });
  } catch (err) {
    logError("[admin/panelists DELETE]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
