/** Shared helpers for the StackScore test suite. */
import * as fs from "fs";
import * as path from "path";

export interface AuthTokens {
  panelToken?: string;
  candToken?: string;
  adminToken?: string;
  expiredPanelToken?: string;
  panelistEmail?: string;
  adminEmail?: string;
  candidateEmail?: string;
  baseURL?: string;
}

export const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";

/** True when pointed at a production BUILD (https deploy, or an explicit prod target). */
export const IS_PROD = /^https:\/\//.test(BASE) || process.env.TEST_PROD_BUILD === "1";

export function tokens(): AuthTokens {
  const p = path.join(__dirname, ".auth-tokens.json");
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as AuthTokens;
  } catch {
    return {};
  }
}

export function cookieHeader(pairs: Record<string, string | undefined>): string {
  return Object.entries(pairs)
    .filter(([, v]) => !!v)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

/** A syntactically valid but unsigned token — the shape an attacker can trivially make. */
export function forgedToken(payload: Record<string, unknown> = { name: "Attacker", email: "attacker@evil.com" }): string {
  const body = Buffer.from(JSON.stringify({ ...payload, iat: Date.now() }), "utf8").toString("base64url");
  return `${body}.${"0".repeat(64)}`;
}
