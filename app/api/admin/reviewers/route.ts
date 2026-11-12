import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, getAdminEmail } from "../../../../lib/requireAdmin";
import { db } from "../../../../lib/firestore";
import { logError } from "../../../../lib/logger";

/** Reviewer registry (A3). Mirrors the admins registry; admins decide who may review. */

export async function GET(req: NextRequest) {
  const deny = await requireAdmin(req);
  if (deny) return deny;
  try {
    const snap = await db().collection("reviewers").get();
    return NextResponse.json({ reviewers: snap.docs.map((d) => ({ email: d.id, ...d.data() })) });
  } catch (err) {
    logError("[admin/reviewers GET]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const deny = await requireAdmin(req);
  if (deny) return deny;
  try {
    const addedBy = await getAdminEmail(req);
    const { email } = await req.json() as { email?: string };
    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "Valid email required" }, { status: 400 });
    }
    const normalized = email.toLowerCase().trim();
    await db().collection("reviewers").doc(normalized).set({
      active: true,
      addedAt: new Date().toISOString(),
      addedBy: addedBy ?? "admin",
    }, { merge: true });
    return NextResponse.json({ ok: true, email: normalized });
  } catch (err) {
    logError("[admin/reviewers POST]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const deny = await requireAdmin(req);
  if (deny) return deny;
  try {
    const { email } = await req.json() as { email?: string };
    if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });
    const normalized = email.toLowerCase().trim();
    const seed = process.env.REVIEWER_EMAILS;
    if (seed && seed.split(",").map((e) => e.trim().toLowerCase()).includes(normalized)) {
      return NextResponse.json({ error: "Cannot remove a bootstrap reviewer" }, { status: 400 });
    }
    // Deactivated rather than deleted: reviews they already submitted carry their address
    // as provenance, and a dangling reference to a deleted record is worse than an
    // inactive one.
    await db().collection("reviewers").doc(normalized).set({ active: false }, { merge: true });
    return NextResponse.json({ ok: true });
  } catch (err) {
    logError("[admin/reviewers DELETE]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
