import crypto from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./firestore";

export type OTPType = "panelist" | "candidate" | "admin" | "reviewer";

const MAX_ATTEMPTS = 5;
/** Lifetime budget of verification attempts across all resends in a window.
 *  Without this, every resend reset `attempts` to 0, so 3 sends/15min bought 15 guesses. */
const MAX_ATTEMPTS_PER_WINDOW = 8;
const WINDOW_MS = 15 * 60 * 1000;
const TTL_MS = 10 * 60 * 1000;

function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

function docId(email: string, type: OTPType): string {
  return `${type}:${email.toLowerCase().trim()}`;
}

export function generateOTP(): string {
  // 6-digit numeric OTP — cryptographically random
  return String(crypto.randomInt(100_000, 1_000_000));
}

export async function storeOTP(email: string, code: string, type: OTPType): Promise<void> {
  const ref = db().collection("otps").doc(docId(email, type));
  const now = Date.now();

  // Preserve the attempt budget across resends within the window.
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const prev = snap.exists ? snap.data() : undefined;
    const windowStart = prev && typeof prev.windowStart === "number" && now - prev.windowStart < WINDOW_MS
      ? prev.windowStart
      : now;
    const windowAttempts = windowStart === prev?.windowStart ? (prev?.windowAttempts ?? 0) : 0;

    tx.set(ref, {
      codeHash: hashCode(code),
      expiresAt: new Date(now + TTL_MS),
      type,
      attempts: 0,          // per-code attempts
      windowAttempts,       // carried across resends
      windowStart,
      createdAt: FieldValue.serverTimestamp(),
    });
  });
}

/**
 * Verifies a code. Atomic: the attempt counters are read and incremented in one
 * transaction, so concurrent guesses cannot each see a stale count.
 */
export async function verifyOTP(email: string, code: string, type: OTPType): Promise<boolean> {
  const ref = db().collection("otps").doc(docId(email, type));

  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const data = snap.data()!;

    const expiresAt: Date | undefined =
      typeof data.expiresAt?.toDate === "function" ? data.expiresAt.toDate() : undefined;
    if (!expiresAt || expiresAt < new Date()) {
      tx.delete(ref);
      return false;
    }

    const attempts = (data.attempts as number) ?? 0;
    const windowAttempts = (data.windowAttempts as number) ?? 0;
    if (attempts >= MAX_ATTEMPTS || windowAttempts >= MAX_ATTEMPTS_PER_WINDOW) {
      return false; // locked out
    }

    if (typeof data.codeHash !== "string" || data.codeHash !== hashCode(code)) {
      tx.update(ref, {
        attempts: FieldValue.increment(1),
        windowAttempts: FieldValue.increment(1),
      });
      return false;
    }

    tx.delete(ref); // single-use
    return true;
  });
}
