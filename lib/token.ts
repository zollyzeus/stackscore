/**
 * Shared HMAC session-token primitives for all three roles (panelist, candidate, admin).
 *
 * Edge-runtime safe: uses WebCrypto + btoa/atob only — no node:crypto, no Buffer, so the
 * same verifier runs in middleware.ts and in Node route handlers.
 *
 * Token format: `<base64url(JSON payload)>.<hex HMAC-SHA256>`
 */

const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function encodeBase64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * Decodes base64url back to a UTF-8 string.
 * atob() yields a latin1 string (one char per byte), so the bytes must be run through
 * TextDecoder — otherwise any multi-byte character (e.g. "José") is mojibake.
 */
function decodeBase64url(s: string): string {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) return new Uint8Array(0);
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function importKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage]
  );
}

/** Signs an arbitrary payload object into a token. `iat` is stamped automatically. */
export async function signToken(secret: string, payload: Record<string, unknown>): Promise<string> {
  const body = JSON.stringify({ ...payload, iat: Date.now() });
  const b64 = encodeBase64url(new TextEncoder().encode(body));
  const key = await importKey(secret, "sign");
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(b64));
  return `${b64}.${bytesToHex(new Uint8Array(sig))}`;
}

/**
 * Verifies a token's signature AND its age. Returns null on any failure.
 *
 * The age check is what makes logout and the idle timeout meaningful: without it a cookie
 * value captured once stays valid forever, since cookie maxAge is only a client-side hint.
 */
export async function verifyToken<T extends Record<string, unknown>>(
  secret: string,
  token: string,
  maxAgeMs: number = DEFAULT_MAX_AGE_MS
): Promise<(T & { iat?: number }) | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const [b64, sig] = parts;
    if (!b64 || !sig) return null;

    const sigBytes = hexToBytes(sig);
    if (sigBytes.length !== 32) return null; // SHA-256 HMAC is always 32 bytes

    // crypto.subtle.verify is constant-time.
    const key = await importKey(secret, "verify");
    const valid = await crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(b64));
    if (!valid) return null;

    const payload = JSON.parse(decodeBase64url(b64)) as T & { iat?: number };

    // Reject tokens with no issue time, or issued outside the allowed window
    // (including implausibly-future timestamps).
    if (typeof payload.iat !== "number") return null;
    const age = Date.now() - payload.iat;
    if (age < -60_000 || age > maxAgeMs) return null;

    return payload;
  } catch {
    return null;
  }
}

export { DEFAULT_MAX_AGE_MS };
