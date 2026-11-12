/**
 * Reviewer registry (A3).
 *
 * Deliberately separate from lib/reviewerAuth.ts. middleware.ts imports the auth module to
 * verify the reviewer cookie, and middleware runs on the Edge runtime, which cannot load
 * firebase-admin. Keeping the Firestore lookup in its own module is what lets the token
 * verification stay edge-safe -- the same split lib/panelistRegistry.ts already uses.
 */
import { db } from "./firestore";

/** Bootstrap seed first, then the Firestore registry an admin manages. */
export async function isReviewer(email: string): Promise<boolean> {
  const normalized = email.toLowerCase().trim();
  const seed = process.env.REVIEWER_EMAILS;
  if (seed && seed.split(",").map((e) => e.trim().toLowerCase()).includes(normalized)) return true;
  try {
    const snap = await db().collection("reviewers").doc(normalized).get();
    return snap.exists && snap.data()?.active !== false;
  } catch {
    return false;
  }
}
