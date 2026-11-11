/**
 * Audit regression suite.
 *
 * One test (or group) per finding in AUDIT_TODO.md, named with its id so a failure points
 * straight at the item. These are the tests that would have caught each bug.
 *
 * Run locally:  npx playwright test tests/audit-regression.spec.ts
 * Run vs prod:  TEST_BASE_URL=https://stackscore.anandrajendran.dev npx playwright test tests/audit-regression.spec.ts
 */
import { test, expect } from "@playwright/test";
import { BASE, IS_PROD, tokens, cookieHeader, forgedToken } from "./helpers";

// ─────────────────────────────────────────────────────────────────────────────
// A1 — any ss_panel cookie value must NOT authorise transcript/checkpoint access
// ─────────────────────────────────────────────────────────────────────────────
test.describe("A1 — ss_panel signature is actually verified", () => {
  const junkCookies = [
    "not-a-real-token",
    "x",
    "a.b",
    ".",
    "eyJuYW1lIjoiYSJ9.deadbeef",
  ];

  for (const value of junkCookies) {
    test(`GET /api/transcript rejects ss_panel="${value}"`, async ({ request }) => {
      const res = await request.get(`${BASE}/api/transcript/any-session-id`, {
        headers: { Cookie: `ss_panel=${value}` },
      });
      expect(res.status(), "an unsigned cookie must never return data").not.toBe(200);
      expect([401, 404]).toContain(res.status());
    });

    test(`GET /api/session/:id/checkpoint rejects ss_panel="${value}"`, async ({ request }) => {
      const res = await request.get(`${BASE}/api/session/any-session-id/checkpoint`, {
        headers: { Cookie: `ss_panel=${value}` },
      });
      expect(res.status()).toBe(401);
    });

    test(`POST /api/session/:id/checkpoint rejects ss_panel="${value}"`, async ({ request }) => {
      const res = await request.post(`${BASE}/api/session/any-session-id/checkpoint`, {
        headers: { Cookie: `ss_panel=${value}`, "Content-Type": "application/json" },
        data: { stage: "build", code: "malicious" },
      });
      expect(res.status()).toBe(401);
    });
  }

  test("a forged (correct-shape, bad-signature) token is rejected", async ({ request }) => {
    const res = await request.get(`${BASE}/api/session/any-session-id/checkpoint`, {
      headers: { Cookie: `ss_panel=${forgedToken()}` },
    });
    expect(res.status()).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A2 — the shared-secret login backdoor is gone
// ─────────────────────────────────────────────────────────────────────────────
test.describe("A2 — /api/auth/login backdoor removed", () => {
  test("POST /api/auth/login no longer exists", async ({ request }) => {
    const res = await request.post(`${BASE}/api/auth/login`, {
      headers: { "Content-Type": "application/json" },
      data: { code: process.env.PANELIST_SECRET ?? "whatever", name: "Attacker" },
    });
    expect([404, 405]).toContain(res.status());
  });

  test("the signing secret is not accepted as a credential anywhere", async ({ request }) => {
    const secret = process.env.PANELIST_SECRET;
    test.skip(!secret, "PANELIST_SECRET not available to the test runner");
    const res = await request.get(`${BASE}/api/auth/me`, {
      headers: { Cookie: `ss_panel=${secret}` },
    });
    expect(res.status()).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A3 — candidate data is session-scoped, never query-parameter-scoped
// ─────────────────────────────────────────────────────────────────────────────
test.describe("A3 — candidate data endpoints require a session", () => {
  test("GET /api/candidate/history without a cookie returns 401", async ({ request }) => {
    const res = await request.get(`${BASE}/api/candidate/history`);
    expect(res.status()).toBe(401);
  });

  test("GET /api/candidate/history?email= cannot read another candidate's scores", async ({ request }) => {
    const res = await request.get(`${BASE}/api/candidate/history?email=victim@example.com`);
    expect(res.status()).toBe(401);
    const body = await res.json().catch(() => ({}));
    expect(body.scores).toBeUndefined();
  });

  test("GET /api/trajectory without a cookie returns 401", async ({ request }) => {
    const res = await request.get(`${BASE}/api/trajectory`);
    expect(res.status()).toBe(401);
  });

  test("GET /api/trajectory?email= cannot enumerate another candidate", async ({ request }) => {
    const res = await request.get(`${BASE}/api/trajectory?email=victim@example.com`);
    expect(res.status()).toBe(401);
    const body = await res.json().catch(() => ({}));
    expect(body.attempts ?? []).toEqual([]);
  });

  test("a candidate session reads its OWN history and ignores ?email=", async ({ request }) => {
    const t = tokens();
    test.skip(!t.candToken, "no candidate token minted");
    const res = await request.get(`${BASE}/api/candidate/history?email=someone-else@example.com`, {
      headers: { Cookie: cookieHeader({ ss_cand: t.candToken }) },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.scores)).toBe(true);
    // Every returned score must belong to the cookie's owner, not the query param.
    for (const s of body.scores) {
      if (s.candidateEmail) {
        expect(String(s.candidateEmail).toLowerCase()).toBe(t.candidateEmail!.toLowerCase());
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A4 — tokens expire
// ─────────────────────────────────────────────────────────────────────────────
test.describe("A4 — token expiry is enforced", () => {
  test("a correctly-signed but 8-day-old panelist token is rejected", async ({ request }) => {
    const t = tokens();
    test.skip(!t.expiredPanelToken, "no expired token minted");
    const res = await request.get(`${BASE}/api/auth/me`, {
      headers: { Cookie: cookieHeader({ ss_panel: t.expiredPanelToken }) },
    });
    expect(res.status(), "an aged-out token must not authenticate").toBe(401);
  });

  test("a fresh panelist token still works (control)", async ({ request }) => {
    const t = tokens();
    test.skip(!t.panelToken, "no panelist token minted");
    const res = await request.get(`${BASE}/api/auth/me`, {
      headers: { Cookie: cookieHeader({ ss_panel: t.panelToken }) },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.authenticated).toBe(true);
  });

  test("a token with no iat claim is rejected", async ({ request }) => {
    const body = Buffer.from(JSON.stringify({ name: "No Iat", email: "x@y.com" })).toString("base64url");
    const res = await request.get(`${BASE}/api/auth/me`, {
      headers: { Cookie: `ss_panel=${body}.${"0".repeat(64)}` },
    });
    expect(res.status()).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A6 — panelist management is admin-only
// ─────────────────────────────────────────────────────────────────────────────
test.describe("A6 — a panelist cannot grant panelist access", () => {
  test("POST /api/admin/panelists with only a panelist cookie is refused", async ({ request }) => {
    const t = tokens();
    const res = await request.post(`${BASE}/api/admin/panelists`, {
      headers: { Cookie: cookieHeader({ ss_panel: t.panelToken }), "Content-Type": "application/json" },
      data: { email: "escalation-target@evil.com" },
    });
    expect([401, 403]).toContain(res.status());
  });

  test("DELETE /api/admin/panelists with only a panelist cookie is refused", async ({ request }) => {
    const t = tokens();
    const res = await request.delete(`${BASE}/api/admin/panelists`, {
      headers: { Cookie: cookieHeader({ ss_panel: t.panelToken }), "Content-Type": "application/json" },
      data: { email: t.panelistEmail ?? "someone@example.com" },
    });
    expect([401, 403]).toContain(res.status());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A7 — open redirect on the login page
// ─────────────────────────────────────────────────────────────────────────────
test.describe("A7 — login next= cannot leave the origin", () => {
  const hostiles = [
    "https://evil.example.com/steal",
    "//evil.example.com",
    "javascript:alert(document.domain)",
    "http:/\\/\\evil.example.com",
  ];

  for (const nextParam of hostiles) {
    test(`?next=${nextParam} does not navigate off-origin`, async ({ page }) => {
      await page.goto(`${BASE}/login?type=candidate&next=${encodeURIComponent(nextParam)}`);
      // Read the value the page actually resolved for `next` by submitting nothing and
      // asserting the page stays put, then confirm no off-origin nav is queued.
      const offOrigin: string[] = [];
      page.on("framenavigated", (f) => {
        const u = f.url();
        if (!u.startsWith(BASE) && !u.startsWith("about:")) offOrigin.push(u);
      });
      await page.waitForTimeout(1200);
      expect(offOrigin, `navigated off-origin: ${offOrigin.join(", ")}`).toEqual([]);
      expect(page.url().startsWith(BASE)).toBe(true);
    });
  }

  test("OAuth callback ignores an external next= in state", async ({ request }) => {
    const maliciousState = Buffer.from(JSON.stringify({
      type: "candidate", next: "https://evil.example.com/steal", nonce: "any",
    })).toString("base64url");
    const res = await request.get(`${BASE}/api/auth/google/callback?code=fake&state=${maliciousState}`, {
      maxRedirects: 0,
    });
    const location = res.headers()["location"] ?? "";
    expect(location).not.toContain("evil.example.com");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A11 — ownership checks on candidate-scoped writes
// ─────────────────────────────────────────────────────────────────────────────
test.describe("A11 — candidates cannot act on sessions they do not own", () => {
  test("POST /api/session-status on an unknown/foreign session is refused", async ({ request }) => {
    const t = tokens();
    test.skip(!t.candToken, "no candidate token minted");
    const res = await request.post(`${BASE}/api/session-status`, {
      headers: { Cookie: cookieHeader({ ss_cand: t.candToken }), "Content-Type": "application/json" },
      data: { sessionId: "someone-elses-session-id", status: "quit" },
    });
    expect([403, 404]).toContain(res.status());
  });

  test("POST /api/evaluate on a session the candidate does not own is refused", async ({ request }) => {
    const t = tokens();
    test.skip(!t.candToken, "no candidate token minted");
    const res = await request.post(`${BASE}/api/evaluate`, {
      headers: { Cookie: cookieHeader({ ss_cand: t.candToken }), "Content-Type": "application/json" },
      data: { sessionId: "someone-elses-session-id" },
    });
    expect([401, 404]).toContain(res.status());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A14 — identity is not echoed into response headers
// ─────────────────────────────────────────────────────────────────────────────
test.describe("A14 — no identity leakage in response headers", () => {
  test("/dashboard response carries no x-panelist-name header", async ({ request }) => {
    const t = tokens();
    const res = await request.get(`${BASE}/dashboard`, {
      headers: { Cookie: cookieHeader({ ss_panel: t.panelToken }) },
      maxRedirects: 0,
    });
    expect(res.headers()["x-panelist-name"]).toBeUndefined();
    expect(res.headers()["x-admin-email"]).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B3 — rate limiting is actually awaited
// ─────────────────────────────────────────────────────────────────────────────
test.describe("B3 — rate limiting is enforced on unauthenticated endpoints", () => {
  test("POST /api/demo eventually rate-limits a burst from one client", async ({ request }) => {
    const statuses: number[] = [];
    for (let i = 0; i < 9; i++) {
      const res = await request.post(`${BASE}/api/demo`, { failOnStatusCode: false });
      statuses.push(res.status());
    }
    // The limiter is per-IP per-hour, so a burst must not be all-200s.
    expect(
      statuses.some((s) => s === 429),
      `expected at least one 429 in a burst, got: ${statuses.join(",")}`
    ).toBe(true);
  });

  test("POST /api/session mode=random requires a candidate session", async ({ request }) => {
    const res = await request.post(`${BASE}/api/session`, {
      headers: { "Content-Type": "application/json" },
      data: { mode: "random", role: "Mid" },
    });
    expect([401, 429]).toContain(res.status());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B5 — security headers / CSP
// ─────────────────────────────────────────────────────────────────────────────
test.describe("B5 — HTTP security headers", () => {
  test("baseline headers are present", async ({ request }) => {
    const res = await request.get(`${BASE}/`);
    const h = res.headers();
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBeTruthy();
    expect(h["permissions-policy"]).toBeTruthy();
  });

  test("CSP no longer allows unsafe-eval, and sets the missing directives", async ({ request }) => {
    const res = await request.get(`${BASE}/`);
    const csp = res.headers()["content-security-policy"] ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("object-src 'none'");
  });

  test("production CSP does not allow unsafe-eval", async ({ request }) => {
    // The Next.js dev server needs 'unsafe-eval' for React Refresh, so this guarantee is
    // only assertable against a production build (prod URL, or `npm start` locally).
    test.skip(!IS_PROD, "dev server requires unsafe-eval for HMR; asserted against prod");
    const res = await request.get(`${BASE}/`);
    const csp = res.headers()["content-security-policy"] ?? "";
    expect(csp, "unsafe-eval must not ship — the sandbox is server-side").not.toContain("unsafe-eval");
  });

  test("x-powered-by is suppressed", async ({ request }) => {
    const res = await request.get(`${BASE}/`);
    expect(res.headers()["x-powered-by"]).toBeUndefined();
  });

  test("HSTS is set on HTTPS", async ({ request }) => {
    test.skip(!IS_PROD, "HSTS only meaningful over HTTPS");
    const res = await request.get(`${BASE}/`);
    expect(res.headers()["strict-transport-security"]).toContain("max-age=");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E5 — health endpoint
// ─────────────────────────────────────────────────────────────────────────────
test.describe("E5 — /api/health", () => {
  test("reports ok with no missing required env and a reachable Firestore", async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    const body = await res.json();
    expect(body.missingRequiredEnv, `missing env: ${JSON.stringify(body.missingRequiredEnv)}`).toEqual([]);
    expect(body.firestore).toBe("ok");
    expect(res.status()).toBe(200);
    expect(body.status).toBe("ok");
  });

  test("never leaks a secret value", async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    const text = await res.text();
    // `configured` must be booleans only.
    const body = JSON.parse(text);
    for (const [k, v] of Object.entries(body.configured ?? {})) {
      expect(typeof v, `${k} should be a boolean, not a value`).toBe("boolean");
    }
    expect(text).not.toMatch(/sk-ant-|BEGIN PRIVATE KEY|AIza/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F4 — the credential is publicly verifiable and signed
// ─────────────────────────────────────────────────────────────────────────────
test.describe("F4 — public credential verification", () => {
  test("/api/verify/:slug is CORS-open (third parties can verify)", async ({ request }) => {
    const res = await request.get(`${BASE}/api/verify/does-not-exist-slug`);
    expect(res.headers()["access-control-allow-origin"]).toBe("*");
  });

  test("other API routes remain same-origin only", async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    const acao = res.headers()["access-control-allow-origin"] ?? "";
    expect(acao).not.toBe("*");
  });

  test("an unknown slug returns a clean 404, not a 500", async ({ request }) => {
    const res = await request.get(`${BASE}/api/verify/definitely-not-a-real-slug-zzz`);
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.verified).toBe(false);
    expect(body.reason).toBe("not_found");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Role separation — the three cookies must never substitute for each other
// ─────────────────────────────────────────────────────────────────────────────
test.describe("Role separation", () => {
  test("a candidate token is not accepted as a panelist", async ({ request }) => {
    const t = tokens();
    test.skip(!t.candToken, "no candidate token");
    const res = await request.get(`${BASE}/api/auth/me`, {
      headers: { Cookie: cookieHeader({ ss_panel: t.candToken }) },
    });
    expect(res.status()).toBe(401);
  });

  test("a panelist token is not accepted as a candidate", async ({ request }) => {
    const t = tokens();
    test.skip(!t.panelToken, "no panelist token");
    const res = await request.get(`${BASE}/api/auth/candidate-me`, {
      headers: { Cookie: cookieHeader({ ss_cand: t.panelToken }) },
    });
    expect(res.status()).toBe(401);
  });

  test("a panelist token is not accepted as an admin", async ({ request }) => {
    const t = tokens();
    test.skip(!t.panelToken, "no panelist token");
    const res = await request.get(`${BASE}/api/auth/admin-me`, {
      headers: { Cookie: cookieHeader({ ss_admin: t.panelToken }) },
    });
    expect(res.status()).toBe(401);
  });

  test("a candidate token is not accepted as an admin", async ({ request }) => {
    const t = tokens();
    test.skip(!t.candToken, "no candidate token");
    const res = await request.get(`${BASE}/api/auth/admin-me`, {
      headers: { Cookie: cookieHeader({ ss_admin: t.candToken }) },
    });
    expect(res.status()).toBe(401);
  });

  test("/api/admin/* needs ss_admin even with a valid panelist cookie", async ({ request }) => {
    const t = tokens();
    const res = await request.get(`${BASE}/api/admin/analytics`, {
      headers: { Cookie: cookieHeader({ ss_panel: t.panelToken }) },
    });
    expect([401, 403]).toContain(res.status());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unauthenticated route inventory — every protected route must refuse anonymous
// ─────────────────────────────────────────────────────────────────────────────
test.describe("Protected route inventory (anonymous access)", () => {
  const panelistRoutes: Array<[string, string, Record<string, unknown>]> = [
    ["POST", "/api/generate-problem", { rowId: "R2", columnId: "C1" }],
    ["GET", "/api/export-csv", {}],
    ["POST", "/api/decision", { sessionId: "s1", decision: "shortlist" }],
    ["POST", "/api/notes", { sessionId: "s1", notes: "x" }],
    ["POST", "/api/re-evaluate", { sessionId: "s1" }],
    ["GET", "/api/credits", {}],
    ["POST", "/api/outcome-feedback", { sessionId: "s1", outcome: "good" }],
  ];

  for (const [method, path, data] of panelistRoutes) {
    test(`${method} ${path} refuses anonymous`, async ({ request }) => {
      const res = await request.fetch(`${BASE}${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(method === "GET" ? {} : { data }),
      });
      expect([401, 403]).toContain(res.status());
    });
  }

  const candidateRoutes: Array<[string, Record<string, unknown>]> = [
    ["/api/run-code", { sessionId: "s1", stage: "build", code: "1+1" }],
    ["/api/stakeholder-chat", { sessionId: "s1", question: "hi", brief: "b", history: [] }],
    ["/api/inject-twist", { sessionId: "s1" }],
    ["/api/inject-defect", { sessionId: "s1" }],
    ["/api/session-status", { sessionId: "s1", status: "quit" }],
    ["/api/retry", { slug: "abc123" }],
  ];

  for (const [path, data] of candidateRoutes) {
    test(`POST ${path} refuses anonymous`, async ({ request }) => {
      const res = await request.post(`${BASE}${path}`, {
        headers: { "Content-Type": "application/json" },
        data,
      });
      expect(res.status()).toBe(401);
    });
  }

  const protectedPages = ["/dashboard", "/panel", "/compare"];
  for (const p of protectedPages) {
    test(`GET ${p} redirects anonymous to /login`, async ({ request }) => {
      const res = await request.get(`${BASE}${p}`, { maxRedirects: 0 });
      expect([302, 307, 308]).toContain(res.status());
      expect(res.headers()["location"] ?? "").toContain("/login");
    });
  }

  test("GET /admin is IP-gated (403) or redirects to login", async ({ request }) => {
    const res = await request.get(`${BASE}/admin`, { maxRedirects: 0 });
    expect([403, 302, 307, 308]).toContain(res.status());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Public surfaces must stay public
// ─────────────────────────────────────────────────────────────────────────────
test.describe("Public surfaces", () => {
  const publicPages = ["/", "/why", "/terms", "/privacy", "/login", "/benchmarks"];
  for (const p of publicPages) {
    test(`GET ${p} is reachable anonymously`, async ({ request }) => {
      const res = await request.get(`${BASE}${p}`);
      expect(res.status()).toBe(200);
    });
  }
});
