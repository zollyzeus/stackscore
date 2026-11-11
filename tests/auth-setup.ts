/**
 * Playwright global setup.
 *
 * Mints role cookies directly with the same HMAC primitives the app uses, instead of
 * calling a login endpoint. The previous version POSTed to /api/auth/login with
 * PANELIST_SECRET as a shared access code — that route was a backdoor (it minted a
 * panelist session for anyone holding the signing key, with no registry check) and has
 * been removed, so the test harness must not depend on it.
 *
 * Writes:
 *   tests/.auth-state.json       — panelist storage state  (chromium-auth project)
 *   tests/.auth-state-cand.json  — candidate storage state (chromium-candidate project)
 *   tests/.auth-tokens.json      — raw tokens for API-level tests
 */
import * as path from "path";
import * as fs from "fs";

export const AUTH_STATE_FILE = path.join(__dirname, ".auth-state.json");
export const CAND_STATE_FILE = path.join(__dirname, ".auth-state-cand.json");
export const TOKENS_FILE = path.join(__dirname, ".auth-tokens.json");

const EMPTY = { cookies: [], origins: [] };

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function b64url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}

/** Mirrors lib/token.ts signToken — payload + `iat`, HMAC-SHA256, hex signature. */
async function signToken(secret: string, payload: Record<string, unknown>): Promise<string> {
  const body = JSON.stringify({ ...payload, iat: Date.now() });
  const b64 = b64url(body);
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(b64));
  return `${b64}.${hex(sig)}`;
}

function stateFor(name: string, value: string, baseURL: string) {
  const url = new URL(baseURL);
  return {
    cookies: [{
      name,
      value,
      domain: url.hostname,
      path: "/",
      expires: Math.floor(Date.now() / 1000) + 60 * 60 * 6,
      httpOnly: true,
      secure: url.protocol === "https:",
      sameSite: "Lax" as const,
    }],
    origins: [],
  };
}

export default async function globalSetup() {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? process.env.TEST_BASE_URL ?? "http://localhost:3000";
  const panelistSecret = process.env.PANELIST_SECRET;

  if (!panelistSecret) {
    console.warn("[auth-setup] PANELIST_SECRET not set — authenticated tests will be skipped.");
    fs.writeFileSync(AUTH_STATE_FILE, JSON.stringify(EMPTY));
    fs.writeFileSync(CAND_STATE_FILE, JSON.stringify(EMPTY));
    fs.writeFileSync(TOKENS_FILE, JSON.stringify({}));
    return;
  }

  const candidateSecret = process.env.CANDIDATE_SECRET ?? `${panelistSecret}:candidate`;
  const adminSecret = process.env.ADMIN_SECRET ?? `${panelistSecret}:admin`;

  // The panelist email must be on the registry, because the route guards now re-check it.
  const panelistEmail = (process.env.PANELIST_EMAILS ?? "").split(",")[0].trim()
    || "zollyzeus@gmail.com";
  const adminEmail = (process.env.ADMIN_EMAILS ?? "").split(",")[0].trim()
    || "stackscoreofficial@gmail.com";
  // Unique per run: self-assessment credits are counted per email (3 free), so a fixed
  // address would start returning 402 after the third live run.
  const candidateEmail = process.env.TEST_CANDIDATE_EMAIL
    ?? `playwright-${Date.now().toString(36)}@demo.invalid`;

  const panelToken = await signToken(panelistSecret, { name: "Test Panelist", email: panelistEmail });
  const candToken = await signToken(candidateSecret, { email: candidateEmail, name: "Test Candidate" });
  const adminToken = await signToken(adminSecret, { email: adminEmail, name: "Test Admin" });

  // A token signed with the right key but an `iat` outside the allowed window — used to
  // prove the expiry check actually rejects old tokens.
  const expiredPanelToken = await (async () => {
    const body = JSON.stringify({
      name: "Expired Panelist",
      email: panelistEmail,
      iat: Date.now() - 8 * 24 * 60 * 60 * 1000, // 8 days old, limit is 7
    });
    const b64 = b64url(body);
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(panelistSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(b64));
    return `${b64}.${hex(sig)}`;
  })();

  // A minted token is only useful if the TARGET server shares the signing secret. When
  // the suite runs against a deployment whose secrets differ from this machine's .env,
  // the tokens would verify locally but be rejected remotely — so probe each one and drop
  // the ones the server does not accept. Cookie-dependent tests then skip cleanly instead
  // of failing for a configuration reason that looks like a product bug.
  async function accepted(path: string, cookie: string, token: string): Promise<boolean> {
    try {
      const res = await fetch(`${baseURL}${path}`, { headers: { Cookie: `${cookie}=${token}` } });
      if (!res.ok) return false;
      const body = (await res.json()) as { authenticated?: boolean };
      return body.authenticated === true;
    } catch {
      return false; // server unreachable yet (webServer still booting) — treat as unusable
    }
  }

  const [panelOk, candOk, adminOk] = await Promise.all([
    accepted("/api/auth/me", "ss_panel", panelToken),
    accepted("/api/auth/candidate-me", "ss_cand", candToken),
    accepted("/api/auth/admin-me", "ss_admin", adminToken),
  ]);

  fs.writeFileSync(
    AUTH_STATE_FILE,
    JSON.stringify(panelOk ? stateFor("ss_panel", panelToken, baseURL) : EMPTY, null, 2)
  );
  fs.writeFileSync(
    CAND_STATE_FILE,
    JSON.stringify(candOk ? stateFor("ss_cand", candToken, baseURL) : EMPTY, null, 2)
  );
  fs.writeFileSync(TOKENS_FILE, JSON.stringify({
    ...(panelOk ? { panelToken, expiredPanelToken } : {}),
    ...(candOk ? { candToken } : {}),
    ...(adminOk ? { adminToken } : {}),
    panelistEmail, adminEmail, candidateEmail, baseURL,
  }, null, 2));

  console.log(
    `[auth-setup] ${baseURL} -> panelist:${panelOk ? "ok" : "rejected"} ` +
    `candidate:${candOk ? "ok" : "rejected"} admin:${adminOk ? "ok" : "rejected"}`
  );
  if (!panelOk || !candOk) {
    console.warn(
      "[auth-setup] Some role cookies were rejected by the target. Authenticated tests " +
      "will skip. This is expected when the target's signing secrets differ from this " +
      "machine's .env.local (e.g. running against the deployed service)."
    );
  }
}
