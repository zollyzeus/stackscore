import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { signToken, verifyToken } from "./token";

const COOKIE = "ss_admin";
const MAX_AGE = 60 * 60 * 12; // 12 hours, in seconds (cookie maxAge)
/** Admin sessions are shorter-lived than panelist/candidate ones — highest privilege. */
const ADMIN_MAX_AGE_MS = 12 * 60 * 60 * 1000;

function secret(): string {
  const dedicated = process.env.ADMIN_SECRET;
  if (dedicated) return dedicated;
  const panelist = process.env.PANELIST_SECRET;
  if (!panelist) throw new Error("ADMIN_SECRET (or PANELIST_SECRET) not configured");
  return panelist + ":admin"; // fallback namespace — distinct from panelist/candidate tokens
}

export interface AdminSession {
  email: string;
  name?: string;
}

export async function createAdminToken(email: string, name?: string): Promise<string> {
  return signToken(secret(), { email: email.toLowerCase().trim(), ...(name ? { name } : {}) });
}

export async function verifyAdminToken(token: string): Promise<AdminSession | null> {
  const payload = await verifyToken<{ email?: string; name?: string }>(
    secret(),
    token,
    ADMIN_MAX_AGE_MS
  );
  if (!payload) return null;
  if (typeof payload.email !== "string" || !payload.email.includes("@")) return null;
  return { email: payload.email, name: payload.name };
}

export async function getAdminSession(): Promise<AdminSession | null> {
  try {
    const token = cookies().get(COOKIE)?.value;
    if (!token) return null;
    return verifyAdminToken(token);
  } catch {
    return null;
  }
}

export function adminCookieOptions(token: string) {
  return {
    name: COOKIE, value: token, httpOnly: true, sameSite: "lax" as const,
    path: "/", maxAge: MAX_AGE, secure: process.env.NODE_ENV === "production",
  };
}

export function clearAdminCookieOptions() {
  return {
    name: COOKIE, value: "", httpOnly: true, sameSite: "lax" as const,
    path: "/", maxAge: 0, secure: process.env.NODE_ENV === "production",
  };
}

export async function getAdminSessionFromRequest(req: NextRequest): Promise<AdminSession | null> {
  const token = req.cookies.get(COOKIE)?.value;
  if (!token) return null;
  return verifyAdminToken(token);
}
