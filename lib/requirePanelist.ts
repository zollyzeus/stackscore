import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, type PanelistSession } from "./auth";
import { verifyAdminToken } from "./adminAuth";
import { isAdmin, checkIpAllowlist } from "./requireAdmin";
import { isPanelistEmail } from "./panelistRegistry";

/**
 * Resolves an active panelist session from the request, or null.
 *
 * Verifies the token signature AND re-checks the live panelist registry, so that
 * deactivating a panelist (`active: false`) takes effect immediately instead of only
 * after their 7-day cookie expires.
 */
export async function getPanelistSession(req: NextRequest): Promise<PanelistSession | null> {
  const token = req.cookies.get("ss_panel")?.value;
  if (!token) return null;
  const session = await verifySessionToken(token);
  if (!session) return null;
  // Tokens always carry an email (minted from the verified OTP/OAuth address).
  if (!session.email) return null;
  if (!(await isPanelistEmail(session.email))) return null;
  return session;
}

/** Allows either an active panelist session, or an active admin session (IP-checked). */
export async function requirePanelistOrAdmin(req: NextRequest): Promise<NextResponse | null> {
  if (await getPanelistSession(req)) return null;

  const adminCookie = req.cookies.get("ss_admin")?.value;
  if (adminCookie) {
    const ipDeny = checkIpAllowlist(req);
    if (!ipDeny) {
      const session = await verifyAdminToken(adminCookie);
      if (session?.email && (await isAdmin(session.email))) return null;
    }
  }
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export async function requirePanelist(req: NextRequest): Promise<NextResponse | null> {
  if (await getPanelistSession(req)) return null;
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export async function getPanelistEmail(req: NextRequest): Promise<string | null> {
  const session = await getPanelistSession(req);
  return session?.email ?? null;
}
