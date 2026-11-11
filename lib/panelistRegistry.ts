import { db } from "./firestore";

/** Checks the bootstrap env-var seed first, then the Firestore-backed panelist registry. */
export async function isPanelistEmail(email: string): Promise<boolean> {
  const normalized = email.toLowerCase().trim();
  const seed = process.env.PANELIST_EMAILS;
  if (seed && seed.split(",").map((e) => e.trim().toLowerCase()).includes(normalized)) return true;
  try {
    const snap = await db().collection("panelists").doc(normalized).get();
    return snap.exists && snap.data()?.active !== false;
  } catch { return false; }
}
