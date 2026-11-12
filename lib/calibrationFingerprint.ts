/**
 * Identity of everything that moves calibration results.
 *
 * Its own module, with no Firestore import, so the calibration sweep (a Playwright test)
 * and the monitor (a server route) can both stamp and compare the same value without the
 * test dragging in firebase-admin.
 *
 * The rubric is in the hash because its anchors are rendered into the judge's system
 * prompt: editing an anchor IS editing the judge, which AUDIT_TODO D10 established the hard
 * way. A fingerprint over the model alone would keep calling stale evidence current.
 */
import { createHash } from "crypto";

export function fingerprintOf(rubricJson: unknown, model: string, effort: string): string {
  return createHash("sha256")
    .update(JSON.stringify(rubricJson))
    .update(model)
    .update(effort)
    .digest("hex")
    // Short enough to read in an alert and compare by eye in the admin console. A 64-char
    // hash there is noise nobody actually diffs.
    .slice(0, 16);
}
