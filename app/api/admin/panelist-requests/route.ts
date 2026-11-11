import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, getAdminEmail } from "../../../../lib/requireAdmin";
import { db } from "../../../../lib/firestore";
import { logError } from "../../../../lib/logger";

export async function GET(req: NextRequest) {
  const deny = await requireAdmin(req);
  if (deny) return deny;
  try {
    const snap = await db().collection("panelistRequests").orderBy("requestedAt", "desc").get();
    const requests = snap.docs.map(d => ({ email: d.id, ...d.data() }));
    return NextResponse.json({ requests });
  } catch (err) {
    logError("[admin/panelist-requests GET]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const deny = await requireAdmin(req);
  if (deny) return deny;
  try {
    const adminEmail = await getAdminEmail(req);
    const { email, action, reason } = await req.json() as {
      email?: string;
      action?: "approve" | "reject";
      reason?: string;
    };
    if (!email || !action || !["approve", "reject"].includes(action)) {
      return NextResponse.json({ error: "email and action (approve|reject) required" }, { status: 400 });
    }
    const normalized = email.toLowerCase().trim();
    const now = new Date().toISOString();

    if (action === "approve") {
      await Promise.all([
        db().collection("panelistRequests").doc(normalized).set(
          { status: "approved", approvedAt: now, approvedBy: adminEmail ?? "admin" },
          { merge: true }
        ),
        db().collection("panelists").doc(normalized).set({
          active: true,
          addedAt: now,
          invitedBy: adminEmail ?? "admin",
          source: "request",
        }, { merge: true }),
      ]);
    } else {
      await db().collection("panelistRequests").doc(normalized).set(
        { status: "rejected", rejectedAt: now, rejectedBy: adminEmail ?? "admin", ...(reason ? { reason } : {}) },
        { merge: true }
      );
    }

    return NextResponse.json({ ok: true, email: normalized, action });
  } catch (err) {
    logError("[admin/panelist-requests POST]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
