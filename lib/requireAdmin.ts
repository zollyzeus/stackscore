import { NextRequest, NextResponse } from "next/server";
import { verifyAdminToken } from "./adminAuth";
import { db } from "./firestore";

function getClientIp(req: NextRequest): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.ip ?? null;
}

export function checkIpAllowlist(req: NextRequest): NextResponse | null {
  const allowlist = process.env.ADMIN_IP_ALLOWLIST;
  if (!allowlist) return NextResponse.json({ error: "forbidden" }, { status: 403 }); // fail closed
  const clientIp = getClientIp(req);
  if (!clientIp) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const allowed = allowlist.split(",").map(ip => ip.trim());
  if (!allowed.includes(clientIp)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return null;
}

export async function requireAdmin(req: NextRequest): Promise<NextResponse | null> {
  const ipDeny = checkIpAllowlist(req);
  if (ipDeny) return ipDeny;

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
  if (checkIpAllowlist(req)) return null;
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
