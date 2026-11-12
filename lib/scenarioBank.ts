/**
 * Scenario bank — pre-generated assessment packs stored in Firestore.
 *
 * A pack contains a brief and a pre-picked twist so that if live Gemini
 * generation fails, the allocation path hands the session a coherent
 * scenario instantly. Defect injection is always live (depends on candidate code).
 *
 * Collection: scenarioBank
 *   status: "available" | "allocated"
 *   allocatedToSession: null | session-id
 */
import { db } from "./firestore";
import { FieldValue } from "firebase-admin/firestore";

export interface ScenarioPack {
  id: string;
  rowId: string;
  columnId: string;
  rowLabel: string;
  columnLabel: string;
  seed: string;
  pressure: string;
  brief: string;
  twistColumnId: string;
  twistColumnLabel: string;
  twistPressure: string;
  twist: string;
  status: "available" | "allocated";
  allocatedToSession: string | null;
  allocatedAt: FirebaseFirestore.FieldValue | null;
  generatedAt: FirebaseFirestore.FieldValue;
}

const COLL = "scenarioBank";

/**
 * Atomically claim one available scenario from the bank.
 * Returns null if the bank is empty.
 * When rowId/columnId are supplied, prefer a matching pack but fall back to any.
 */
export async function allocateFromBank(
  sessionId: string,
  opts?: { rowId?: string; columnId?: string }
): Promise<ScenarioPack | null> {
  const firestore = db();

  // Try preferred match first, then any available
  const queries = [
    opts?.rowId
      ? firestore
          .collection(COLL)
          .where("status", "==", "available")
          .where("rowId", "==", opts.rowId)
          .limit(5)
      : null,
    firestore.collection(COLL).where("status", "==", "available").limit(10),
  ].filter(Boolean) as FirebaseFirestore.Query[];

  for (const query of queries) {
    const snap = await query.get();
    for (const doc of snap.docs) {
      const ref = firestore.collection(COLL).doc(doc.id);
      const claimed = await firestore.runTransaction(async (tx) => {
        const fresh = await tx.get(ref);
        if (fresh.data()?.status !== "available") return false;
        tx.update(ref, {
          status: "allocated",
          allocatedToSession: sessionId,
          allocatedAt: FieldValue.serverTimestamp(),
        });
        return true;
      });
      if (claimed) {
        return { id: doc.id, ...doc.data() } as ScenarioPack;
      }
    }
  }
  return null;
}

/** Return a scenario to the bank (e.g. if a session is abandoned before stage 1). */
export async function returnToBank(packId: string): Promise<void> {
  await db().collection(COLL).doc(packId).update({
    status: "available",
    allocatedToSession: null,
    allocatedAt: null,
  });
}

/** Store a freshly generated pack. */
export async function storePack(
  pack: Omit<ScenarioPack, "id" | "status" | "allocatedToSession" | "allocatedAt" | "generatedAt">
): Promise<string> {
  const ref = await db()
    .collection(COLL)
    .add({
      ...pack,
      status: "available",
      allocatedToSession: null,
      allocatedAt: null,
      generatedAt: FieldValue.serverTimestamp(),
    });
  return ref.id;
}

export interface BankStats {
  available: number;
  allocated: number;
  total: number;
}

export async function getBankStats(): Promise<BankStats> {
  const [availSnap, allocSnap] = await Promise.all([
    db().collection(COLL).where("status", "==", "available").count().get(),
    db().collection(COLL).where("status", "==", "allocated").count().get(),
  ]);
  const available = availSnap.data().count;
  const allocated = allocSnap.data().count;
  return { available, allocated, total: available + allocated };
}
