/**
 * Reviewer role (A3).
 *
 * Token and cookie handling only. The registry lookup lives in lib/reviewerRegistry.ts
 * and the route guard in lib/requireReviewer.ts, because middleware.ts imports this
 * module to verify the cookie and middleware runs on the Edge runtime, which cannot
 * load firebase-admin. A dynamic import is not enough -- webpack bundles it anyway --
 * so the dependency has to be absent, not deferred.
 *
 * A reviewer is a human grader who scores a submission against the same rubric the AI judge
 * uses, for submissions the judge could not score. Deliberately a fourth role with its own
 * cookie and registry rather than a flag on panelists, for one reason: a panelist can
 * already see AI scores across the dashboard, and the entire point of a review is that it is
 * produced without having seen them. Separating the identity makes "the reviewer never saw
 * the LLM output" a property of the system rather than a promise about a UI.
 */
import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { signToken, verifyToken } from "./token";

const COOKIE = "ss_reviewer";
/** Seconds, for the cookie. Between admin (12h) and panelist (7d): review is a work session. */
const MAX_AGE = 60 * 60 * 24;
const REVIEWER_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function secret(): string {
  // Mirrors adminAuth's derivation so a leaked PANELIST_SECRET cannot mint reviewer
  // tokens that pass as panelist tokens or vice versa -- the namespace suffix keeps the
  // three token families disjoint even when they share a root secret.
  const dedicated = process.env.REVIEWER_SECRET;
  if (dedicated) return dedicated;
  const panelist = process.env.PANELIST_SECRET;
  if (!panelist) throw new Error("REVIEWER_SECRET (or PANELIST_SECRET) not configured");
  return panelist + ":reviewer";
}

export interface ReviewerSession {
  email: string;
  name?: string;
}

export async function createReviewerToken(email: string, name?: string): Promise<string> {
  return signToken(secret(), { email: email.toLowerCase().trim(), ...(name ? { name } : {}) });
}

export async function verifyReviewerToken(token: string): Promise<ReviewerSession | null> {
  const payload = await verifyToken<{ email?: string; name?: string }>(
    secret(),
    token,
    REVIEWER_MAX_AGE_MS
  );
  if (!payload) return null;
  if (typeof payload.email !== "string" || !payload.email.includes("@")) return null;
  return { email: payload.email, name: payload.name };
}

export async function getReviewerSession(): Promise<ReviewerSession | null> {
  try {
    const token = cookies().get(COOKIE)?.value;
    if (!token) return null;
    return verifyReviewerToken(token);
  } catch {
    return null;
  }
}

export function reviewerCookieOptions(token: string) {
  return {
    name: COOKIE, value: token, httpOnly: true, sameSite: "lax" as const,
    path: "/", maxAge: MAX_AGE, secure: process.env.NODE_ENV === "production",
  };
}

export function clearReviewerCookieOptions() {
  return {
    name: COOKIE, value: "", httpOnly: true, sameSite: "lax" as const,
    path: "/", maxAge: 0, secure: process.env.NODE_ENV === "production",
  };
}

export async function getReviewerSessionFromRequest(req: NextRequest): Promise<ReviewerSession | null> {
  const token = req.cookies.get(COOKIE)?.value;
  if (!token) return null;
  return verifyReviewerToken(token);
}
