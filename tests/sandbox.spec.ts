/**
 * B1 — code sandbox containment (PRD NFR4).
 *
 * These exercise the real /api/run-code endpoint with a valid candidate session, which is
 * exactly the position an attacker is in: candidate signup is free and self-serve.
 *
 * The original escape was `console.log.constructor("return process.env")()` — the host
 * `console` object handed into the vm context leaked the host `Function`, and with it
 * every API key and signing secret in the process.
 */
import { test, expect } from "@playwright/test";
import { BASE, tokens, cookieHeader } from "./helpers";

/** Markers that must never appear in sandbox output. */
const SECRET_MARKERS = [
  "sk-ant-",                 // Anthropic key prefix
  "AIza",                    // Google API key prefix
  "BEGIN PRIVATE KEY",       // Firebase service-account key
  "PANELIST_SECRET",
  "CANDIDATE_SECRET",
  "ADMIN_SECRET",
  "GOOGLE_CLIENT_SECRET",
];

const ESCAPES: Array<[string, string]> = [
  ["host console constructor", `console.log(console.log.constructor("return process.env")())`],
  ["this.constructor.constructor", `console.log(this.constructor.constructor("return process.env")())`],
  ["object literal prototype", `console.log(({}).constructor.constructor("return process.env")())`],
  ["array prototype", `console.log([].constructor.constructor("return process.env")())`],
  ["function prototype", `console.log((function(){}).constructor("return process.env")())`],
  ["direct process", `console.log(JSON.stringify(process.env))`],
  ["require", `console.log(require("fs").readFileSync("/proc/self/environ","utf8"))`],
  ["globalThis walk", `console.log(Object.getOwnPropertyNames(globalThis).join(","))`],
  ["Error stack realm probe", `try{null.x}catch(e){console.log(e.constructor.constructor("return process.env")())}`],
  ["GCP metadata via fetch", `fetch("http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token",{headers:{"Metadata-Flavor":"Google"}}).then(r=>r.text()).then(t=>console.log("METADATA:"+t))`],
  ["obfuscated eval import", `eval("imp"+"ort('fs')").then(m=>console.log("FSLEAK:"+typeof m.readFileSync))`],
  ["new Function import", `new Function("return import('fs')")().then(m=>console.log("FSLEAK2"))`],
];

test.describe("B1 — sandbox cannot reach host secrets", () => {
  for (const [name, code] of ESCAPES) {
    test(`escape attempt blocked: ${name}`, async ({ request }) => {
      const t = tokens();
      test.skip(!t.candToken, "no candidate token minted");

      const res = await request.post(`${BASE}/api/run-code`, {
        headers: { Cookie: cookieHeader({ ss_cand: t.candToken }), "Content-Type": "application/json" },
        data: { sessionId: `sandbox-test-${Date.now()}`, stage: "build", code },
        failOnStatusCode: false,
      });

      // The endpoint may 200 with an error in the payload, or 4xx/5xx — either is fine.
      // What matters is that no secret material comes back.
      const text = await res.text();
      for (const marker of SECRET_MARKERS) {
        expect(text, `sandbox output leaked "${marker}" for: ${name}`).not.toContain(marker);
      }
      expect(text, "GCP metadata token leaked").not.toContain("METADATA:ya29");
      expect(text, "filesystem module reached").not.toContain("FSLEAK");
      expect(text).not.toMatch(/"access_token"/);
    });
  }

  test("dynamic import does not crash the server (DoS regression)", async ({ request }) => {
    const t = tokens();
    test.skip(!t.candToken, "no candidate token minted");

    // Without an importModuleDynamically callback this threw asynchronously, outside any
    // try/catch, taking the whole Node process down — one line to restart the container.
    const res = await request.post(`${BASE}/api/run-code`, {
      headers: { Cookie: cookieHeader({ ss_cand: t.candToken }), "Content-Type": "application/json" },
      data: { sessionId: `sandbox-import-${Date.now()}`, stage: "build", code: `import("fs").then(m=>console.log("GOT FS"))` },
      failOnStatusCode: false,
    });
    expect(res.status()).toBeLessThan(500);

    // The server must still be serving immediately afterwards.
    const health = await request.get(`${BASE}/api/health`);
    expect(health.status(), "server died after a dynamic import in the sandbox").toBe(200);
  });

  test("an infinite loop is terminated by the timeout", async ({ request }) => {
    const t = tokens();
    test.skip(!t.candToken, "no candidate token minted");
    const started = Date.now();
    const res = await request.post(`${BASE}/api/run-code`, {
      headers: { Cookie: cookieHeader({ ss_cand: t.candToken }), "Content-Type": "application/json" },
      data: { sessionId: `sandbox-loop-${Date.now()}`, stage: "build", code: `while(true){}` },
      failOnStatusCode: false,
    });
    const elapsed = Date.now() - started;
    expect(res.status()).toBeLessThan(500);
    expect(elapsed, "timeout should fire in a couple of seconds").toBeLessThan(25_000);
    const body = await res.json().catch(() => ({}));
    if (body.error) expect(String(body.error)).toMatch(/timed out/i);
  });

  test("legitimate candidate code still runs and returns logs", async ({ request }) => {
    const t = tokens();
    test.skip(!t.candToken, "no candidate token minted");
    const res = await request.post(`${BASE}/api/run-code`, {
      headers: { Cookie: cookieHeader({ ss_cand: t.candToken }), "Content-Type": "application/json" },
      data: {
        sessionId: `sandbox-ok-${Date.now()}`,
        stage: "build",
        code: `
          function reserve(stock, qty) { return qty <= stock ? stock - qty : null; }
          console.log("remaining:", reserve(10, 3));
          console.log(JSON.stringify({ ok: true }));
        `,
      },
      failOnStatusCode: false,
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.logs.join(" ")).toContain("remaining: 7");
    expect(body.logs.join(" ")).toContain('{"ok":true}');
  });

  test("log output is capped (flood protection)", async ({ request }) => {
    const t = tokens();
    test.skip(!t.candToken, "no candidate token minted");
    const res = await request.post(`${BASE}/api/run-code`, {
      headers: { Cookie: cookieHeader({ ss_cand: t.candToken }), "Content-Type": "application/json" },
      data: {
        sessionId: `sandbox-flood-${Date.now()}`,
        stage: "build",
        code: `for (let i = 0; i < 50000; i++) console.log("x".repeat(500));`,
      },
      failOnStatusCode: false,
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.logs.length, "log lines must be capped").toBeLessThanOrEqual(200);
  });
});
