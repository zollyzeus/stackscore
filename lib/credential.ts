/**
 * Credential attestation signing.
 *
 * A StackScore is only a credential if a third party can check it. This signs the claim
 * set so a verifier can confirm the score was issued by StackScore and has not been
 * altered in transit or by a screenshot-and-retype.
 *
 * MVP uses a detached HMAC-SHA256 over the canonical JSON of the claims, with the shared
 * verification secret exposed via /api/verify/jwks only as a key *id* — verifiers confirm
 * by calling the verify endpoint. Phase 2 should move to an asymmetric key (Ed25519) so
 * verifiers can check offline without contacting us; tracked in AUDIT_TODO.md F4.
 */

function secret(): string {
  const dedicated = process.env.CREDENTIAL_SECRET;
  if (dedicated) return dedicated;
  const fallback = process.env.PANELIST_SECRET;
  if (!fallback) throw new Error("CREDENTIAL_SECRET (or PANELIST_SECRET) not configured");
  return fallback + ":credential";
}

/**
 * Canonical JSON: keys sorted at every level, so the signature is stable regardless of
 * property insertion order. A verifier must canonicalise the same way.
 */
export function canonicalise(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalise).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalise(v)}`).join(",")}}`;
}

export async function signCredential(claims: Record<string, unknown>): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonicalise(claims)));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyCredential(
  claims: Record<string, unknown>,
  signature: string
): Promise<boolean> {
  const expected = await signCredential(claims);
  if (expected.length !== signature.length) return false;
  // Constant-time-ish comparison.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

/** A short, non-secret identifier for the signing key, so keys can be rotated. */
export function credentialKeyId(): string {
  return process.env.CREDENTIAL_KEY_ID ?? "ss-mvp-1";
}
