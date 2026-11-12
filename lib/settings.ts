/**
 * Runtime settings an admin can change without a deploy (B5).
 *
 * Firestore-backed rather than env vars, deliberately: the scoring hold has to be
 * switchable *during* an incident, and an env var change means a redeploy -- which is the
 * slowest possible way to react to a scoring problem, and needs the person at a terminal
 * rather than at the admin console.
 */
import { db } from "./firestore";
import { FieldValue } from "firebase-admin/firestore";

export interface AppSettings {
  /**
   * When true, a failed calibration probe PAUSES scoring: assessments are still accepted
   * and queued, but no judging runs until calibration passes again.
   *
   * Defaults to FALSE, and that default is load-bearing. A monitor that can halt scoring
   * for everyone is the highest-blast-radius automation in this system, and a misfiring one
   * takes the product down in the way that is hardest to diagnose -- the app is healthy,
   * submissions are accepted, and nothing scores. Alert-only is the safe posture; holding
   * is an explicit decision someone makes with the consequences in view.
   */
  scoringHoldEnabled: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  scoringHoldEnabled: false,
};

const DOC = "appSettings";

export async function getSettings(): Promise<AppSettings> {
  try {
    const snap = await db().collection("config").doc(DOC).get();
    if (!snap.exists) return DEFAULT_SETTINGS;
    const data = snap.data() ?? {};
    return {
      // Explicit === true rather than a truthy check: a stray string in Firestore must not
      // be able to switch on the behaviour that stops the product scoring.
      scoringHoldEnabled: data.scoringHoldEnabled === true,
    };
  } catch {
    // Firestore unavailable: fall back to the safe default rather than failing closed into
    // a hold. An infrastructure blip must not pause scoring.
    return DEFAULT_SETTINGS;
  }
}

export async function setSetting<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K],
  changedBy: string,
): Promise<void> {
  await db().collection("config").doc(DOC).set({
    [key]: value,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: changedBy,
  }, { merge: true });
}
