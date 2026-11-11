import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { signToken, verifyToken, DEFAULT_MAX_AGE_MS } from "./token";

const COOKIE = "ss_cand";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days, in seconds (cookie maxAge)

function secret(): string {
  const dedicated = process.env.CANDIDATE_SECRET;
  if (dedicated) return dedicated;
  const panelist = process.env.PANELIST_SECRET;
  if (!panelist) throw new Error("CANDIDATE_SECRET (or PANELIST_SECRET) not configured");
  return panelist + ":candidate"; // fallback namespace
}

export interface CandidateSession {
  email: string;
  name?: string;
}

export async function createCandidateToken(email: string, name?: string): Promise<string> {
  return signToken(secret(), { email: email.toLowerCase().trim(), ...(name ? { name } : {}) });
}

export async function verifyCandidateToken(token: string): Promise<CandidateSession | null> {
  const payload = await verifyToken<{ email?: string; name?: string }>(
    secret(),
    token,
    DEFAULT_MAX_AGE_MS
  );
  if (!payload) return null;
  if (typeof payload.email !== "string" || !payload.email.includes("@")) return null;
  return { email: payload.email, name: payload.name };
}

export async function getCandidateSession(): Promise<CandidateSession | null> {
  try {
    const token = cookies().get(COOKIE)?.value;
    if (!token) return null;
    return verifyCandidateToken(token);
  } catch {
    return null;
  }
}

export function candidateCookieOptions(token: string) {
  return {
    name: COOKIE, value: token, httpOnly: true, sameSite: "lax" as const,
    path: "/", maxAge: MAX_AGE, secure: process.env.NODE_ENV === "production",
  };
}

export function clearCandidateCookieOptions() {
  return {
    name: COOKIE, value: "", httpOnly: true, sameSite: "lax" as const,
    path: "/", maxAge: 0, secure: process.env.NODE_ENV === "production",
  };
}

export async function getCandidateSessionFromRequest(req: NextRequest): Promise<CandidateSession | null> {
  const token = req.cookies.get(COOKIE)?.value;
  if (!token) return null;
  return verifyCandidateToken(token);
}
