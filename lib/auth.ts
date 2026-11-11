import { cookies } from "next/headers";
import { signToken, verifyToken, DEFAULT_MAX_AGE_MS } from "./token";

const COOKIE = "ss_panel";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days, in seconds (cookie maxAge)

function secret() {
  const s = process.env.PANELIST_SECRET;
  if (!s) throw new Error("PANELIST_SECRET not set");
  return s;
}

export interface PanelistSession {
  name: string;
  email?: string;
}

export async function createSessionToken(email: string, displayName?: string): Promise<string> {
  const name = displayName ?? email.split("@")[0];
  return signToken(secret(), { name, email });
}

export async function verifySessionToken(token: string): Promise<PanelistSession | null> {
  const payload = await verifyToken<{ name?: string; email?: string }>(
    secret(),
    token,
    DEFAULT_MAX_AGE_MS
  );
  if (!payload) return null;
  if (typeof payload.name !== "string" || !payload.name) return null;
  return { name: payload.name, email: payload.email };
}

export async function getSession(): Promise<PanelistSession | null> {
  const token = cookies().get(COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export function sessionCookieOptions(token: string) {
  return {
    name: COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: MAX_AGE,
  };
}

export function clearCookieOptions() {
  return {
    name: COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 0,
  };
}
