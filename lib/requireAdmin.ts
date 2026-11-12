import { NextRequest, NextResponse } from "next/server";
import { verifyAdminToken } from "./adminAuth";
import { db } from "./firestore";

/**
 * Admin authorisation. The IP allowlist that used to run before these checks was removed
 * in A1; see middleware.ts for why. Everything that protected admin now runs here, so this
 * function is the control -- not a second line behind a network one.
 */
export async function requireAdmin(req: NextRequest): Promise<NextResponse | null> {
  const cookie = req.cookies.get("ss_admin");
  if (!cookie?.value) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const session = await verifyAdminToken(cookie.value);
    if (!session?.email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    // Re-check against the live registry in case admin access was revoked after the token was issued.
    if (await isAdmin(session.email)) return null;
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}

export async function getAdminEmail(req: NextRequest): Promise<string | null> {
  const cookie = req.cookies.get("ss_admin");
  if (!cookie?.value) return null;
  try {
    const session = await verifyAdminToken(cookie.value);
    if (!session?.email) return null;
    if (await isAdmin(session.email)) return session.email;
    return null;
  } catch { return null; }
}

export async function isAdmin(email: string): Promise<boolean> {
  const normalized = email.toLowerCase().trim();
  const seed = process.env.ADMIN_EMAILS;
  if (seed && seed.split(",").map(e => e.trim().toLowerCase()).includes(normalized)) return true;
  try {
    const snap = await db().collection("admins").doc(normalized).get();
    return snap.exists && snap.data()?.active !== false;
  } catch { return false; }
}
