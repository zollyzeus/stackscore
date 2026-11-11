import { db } from "./firestore";

/**
 * Firestore-backed fixed-window rate limiter — works across all Cloud Run instances.
 * Returns true (allowed) or false (rate limited).
 *
 * Transactional, so concurrent requests cannot each read the same count and all pass.
 */
export async function rateLimit(key: string, maxPerHour: number): Promise<boolean> {
  const windowMs = 60 * 60 * 1000;
  // Firestore document ids may not contain "/" and are capped at 1500 bytes.
  const docKey = key.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 400);
  const ref = db().collection("rate_limits").doc(docKey);
  const now = Date.now();

  try {
    return await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) {
        const { count, windowStart } = snap.data() as { count?: number; windowStart?: number };
        if (typeof windowStart === "number" && now - windowStart < windowMs) {
          if ((count ?? 0) >= maxPerHour) return false;
          tx.update(ref, { count: (count ?? 0) + 1 });
          return true;
        }
      }
      tx.set(ref, { count: 1, windowStart: now });
      return true;
    });
  } catch {
    // Fail open if Firestore is unavailable — availability is preferred over throttling
    // for the assessment flow. Abuse protection therefore depends on Firestore being up.
    return true;
  }
}
