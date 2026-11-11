import { db } from "./firestore";
import { FieldValue } from "firebase-admin/firestore";

const PANELIST_FREE_LIMIT = 20;
const CANDIDATE_FREE_LIMIT = 3;

/**
 * Deducts one panelist credit, free allowance first then purchased balance.
 *
 * Runs in a transaction: the previous read-then-write let two concurrent requests both
 * observe the same count and both pass the limit check, over-spending free credits and
 * double-spending purchased ones.
 */
export async function checkAndDeductPanelistCredit(email: string): Promise<boolean> {
  const ref = db().collection("credits").doc(email.toLowerCase().trim());

  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data() ?? {};
    const freeUsed = (data.freeUsed as number) ?? 0;
    const purchasedCount = (data.count as number) ?? 0;

    if (freeUsed >= PANELIST_FREE_LIMIT && purchasedCount <= 0) return false;

    if (freeUsed < PANELIST_FREE_LIMIT) {
      tx.set(ref, { freeUsed: FieldValue.increment(1) }, { merge: true });
    } else {
      tx.set(ref, { count: FieldValue.increment(-1) }, { merge: true });
    }
    return true;
  });
}

export async function getPanelistCreditInfo(email: string): Promise<{ freeUsed: number; freeLimit: number; purchased: number; remaining: number }> {
  const snap = await db().collection("credits").doc(email.toLowerCase().trim()).get();
  const data = snap.data() ?? {};
  const freeUsed = (data.freeUsed as number) ?? 0;
  const purchased = (data.count as number) ?? 0;
  const freeRemaining = Math.max(0, PANELIST_FREE_LIMIT - freeUsed);
  return { freeUsed, freeLimit: PANELIST_FREE_LIMIT, purchased, remaining: freeRemaining + purchased };
}

export async function awardPanelistCredit(email: string): Promise<void> {
  const ref = db().collection("credits").doc(email.toLowerCase().trim());
  await ref.set({ count: FieldValue.increment(1) }, { merge: true });
}

/** Atomic, for the same reason as the panelist path above. */
export async function checkAndDeductCandidateCredit(email: string): Promise<boolean> {
  const ref = db().collection("selfAssessCredits").doc(email.toLowerCase().trim());

  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const used = (snap.data()?.used as number) ?? 0;
    if (used >= CANDIDATE_FREE_LIMIT) return false;
    tx.set(ref, { used: FieldValue.increment(1) }, { merge: true });
    return true;
  });
}

/** Demo sessions must not consume a real candidate's allowance. */
export function isDemoEmail(email: string): boolean {
  return email.toLowerCase().trim().endsWith("@demo.invalid");
}
