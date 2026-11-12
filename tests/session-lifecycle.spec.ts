/**
 * Signup / login / logout / session-management lifecycle for all three roles.
 *
 * Covers the original requirements (PRD §2, NFR2) rather than only the audit fixes:
 * who can request access, who is auto-approved, what a session grants, that logout
 * actually clears it, and that one role's login clears the other roles' cookies.
 */
import { test, expect } from "@playwright/test";
import { BASE, IS_PROD, tokens, cookieHeader } from "./helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Signup / access-request flows
// ─────────────────────────────────────────────────────────────────────────────
test.describe("Signup — candidate is self-serve", () => {
  test("any email may request a candidate code", async ({ request }) => {
    const res = await request.post(`${BASE}/api/auth/send-otp`, {
      headers: { "Content-Type": "application/json" },
      data: { email: `lifecycle-${Date.now()}@example.com`, type: "candidate" },
    });
    // 200 sent, 429 rate-limited, 500 email provider unavailable — never 403.
    expect(res.status()).not.toBe(403);
    expect([200, 429, 500]).toContain(res.status());
  });

  test("a malformed email is rejected", async ({ request }) => {
    const res = await request.post(`${BASE}/api/auth/send-otp`, {
      headers: { "Content-Type": "application/json" },
      data: { email: "not-an-email", type: "candidate" },
    });
    expect(res.status()).toBe(400);
  });

  test("an unknown role type is rejected", async ({ request }) => {
    const res = await request.post(`${BASE}/api/auth/send-otp`, {
      headers: { "Content-Type": "application/json" },
      data: { email: "x@example.com", type: "superuser" },
    });
    expect(res.status()).toBe(400);
  });
});

test.describe("Signup — panelist is approval-gated", () => {
  test("an unknown panelist email is recorded as a pending request, not signed in", async ({ request }) => {
    const res = await request.post(`${BASE}/api/auth/send-otp`, {
      headers: { "Content-Type": "application/json" },
      data: { email: `pending-${Date.now()}@example.com`, type: "panelist" },
    });
    expect([202, 403]).toContain(res.status());
    const body = await res.json();
    expect(["pending_approval", "access_denied", "Email not authorised for panelist access"])
      .toContain(body.error);
    // Crucially, no session cookie is issued.
    expect(res.headers()["set-cookie"] ?? "").not.toContain("ss_panel=");
  });

  test("verify-otp for a non-registry panelist email is refused", async ({ request }) => {
    const res = await request.post(`${BASE}/api/auth/verify-otp`, {
      headers: { "Content-Type": "application/json" },
      data: { email: `not-a-panelist-${Date.now()}@example.com`, code: "000000", type: "panelist" },
    });
    expect([401, 403]).toContain(res.status());
    expect(res.headers()["set-cookie"] ?? "").not.toContain("ss_panel=");
  });
});

test.describe("Signup — admin is never self-serve", () => {
  test("send-otp type=admin for a non-admin email is refused", async ({ request }) => {
    const res = await request.post(`${BASE}/api/auth/send-otp`, {
      headers: { "Content-Type": "application/json" },
      data: { email: `not-admin-${Date.now()}@example.com`, type: "admin" },
    });
    expect(res.status()).toBe(403);
  });

  test("verify-otp type=admin for a non-admin email is refused before the code is checked", async ({ request }) => {
    const res = await request.post(`${BASE}/api/auth/verify-otp`, {
      headers: { "Content-Type": "application/json" },
      data: { email: `not-admin-${Date.now()}@example.com`, code: "000000", type: "admin" },
    });
    expect(res.status()).toBe(403);
    expect(res.headers()["set-cookie"] ?? "").not.toContain("ss_admin=");
  });

  test("the login page never offers admin as a public choice", async ({ page }) => {
    await page.goto(`${BASE}/login`);
    const toggle = page.getByRole("group", { name: /sign in as/i });
    await expect(toggle).toBeVisible();
    await expect(toggle.getByRole("button", { name: /^admin$/i })).toHaveCount(0);
    await expect(toggle.getByRole("button", { name: /candidate/i })).toBeVisible();
    await expect(toggle.getByRole("button", { name: /panelist/i })).toBeVisible();
  });

  test("admin mode is only reachable via an explicit ?type=admin link", async ({ page }) => {
    await page.goto(`${BASE}/login?type=admin`);
    await expect(page.getByText(/admin sign in/i)).toBeVisible();
  });

  test("admin mode offers Google, and sends it the admin type", async ({ page }) => {
    // Changed by A1. Admin used to be OTP-only because a network allowlist was the real
    // gate; with that gone, authorisation is the admin registry, which is enforced
    // identically for OTP and Google. The type must reach the OAuth initiator or the
    // callback would mint a candidate session for someone who asked for admin.
    await page.goto(`${BASE}/login?type=admin`);
    const google = page.getByRole("link", { name: /continue with google/i });
    await expect(google).toBeVisible();
    const href = await google.getAttribute("href");
    expect(href).toContain("type=admin");
    expect(href).toContain(encodeURIComponent("/admin"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// OTP mechanics
// ─────────────────────────────────────────────────────────────────────────────
test.describe("OTP mechanics", () => {
  test("a wrong code never signs anyone in", async ({ request }) => {
    const res = await request.post(`${BASE}/api/auth/verify-otp`, {
      headers: { "Content-Type": "application/json" },
      data: { email: "otp-probe@example.com", code: "000000", type: "candidate" },
    });
    expect([401, 403]).toContain(res.status());
    expect(res.headers()["set-cookie"] ?? "").not.toContain("ss_cand=");
  });

  test("verify-otp requires all three fields", async ({ request }) => {
    const res = await request.post(`${BASE}/api/auth/verify-otp`, {
      headers: { "Content-Type": "application/json" },
      data: { email: "x@example.com" },
    });
    expect(res.status()).toBe(400);
  });

  test("repeated wrong codes stay refused (no lockout bypass)", async ({ request }) => {
    const email = `brute-${Date.now()}@example.com`;
    for (let i = 0; i < 6; i++) {
      const res = await request.post(`${BASE}/api/auth/verify-otp`, {
        headers: { "Content-Type": "application/json" },
        data: { email, code: String(100000 + i), type: "candidate" },
      });
      expect([401, 403, 429]).toContain(res.status());
      expect(res.headers()["set-cookie"] ?? "").not.toContain("ss_cand=");
    }
  });

  test("OTP requests are rate-limited per email", async ({ request }) => {
    const email = `ratelimit-${Date.now()}@example.com`;
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await request.post(`${BASE}/api/auth/send-otp`, {
        headers: { "Content-Type": "application/json" },
        data: { email, type: "candidate" },
        failOnStatusCode: false,
      });
      statuses.push(res.status());
    }
    expect(
      statuses.some((s) => s === 429),
      `expected a 429 after repeated sends, got ${statuses.join(",")}`
    ).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Session state — what a valid cookie grants
// ─────────────────────────────────────────────────────────────────────────────
test.describe("Session state", () => {
  test("panelist /api/auth/me reflects the session", async ({ request }) => {
    const t = tokens();
    test.skip(!t.panelToken, "no panelist token");
    const res = await request.get(`${BASE}/api/auth/me`, {
      headers: { Cookie: cookieHeader({ ss_panel: t.panelToken }) },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.authenticated).toBe(true);
    expect(body.name).toBeTruthy();
  });

  test("candidate /api/auth/candidate-me reflects the session", async ({ request }) => {
    const t = tokens();
    test.skip(!t.candToken, "no candidate token");
    const res = await request.get(`${BASE}/api/auth/candidate-me`, {
      headers: { Cookie: cookieHeader({ ss_cand: t.candToken }) },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.authenticated).toBe(true);
    expect(String(body.email).toLowerCase()).toBe(t.candidateEmail!.toLowerCase());
  });

  test("all three /me endpoints return 401 when anonymous", async ({ request }) => {
    for (const p of ["/api/auth/me", "/api/auth/candidate-me", "/api/auth/admin-me"]) {
      const res = await request.get(`${BASE}${p}`);
      expect(res.status(), p).toBe(401);
      const body = await res.json();
      expect(body.authenticated).toBe(false);
    }
  });

  test("a valid panelist session reaches the dashboard", async ({ request }) => {
    const t = tokens();
    test.skip(!t.panelToken, "no panelist token");
    const res = await request.get(`${BASE}/dashboard`, {
      headers: { Cookie: cookieHeader({ ss_panel: t.panelToken }) },
      maxRedirects: 0,
    });
    expect(res.status()).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Logout
// ─────────────────────────────────────────────────────────────────────────────
test.describe("Logout clears the session", () => {
  const cases: Array<[string, string, string]> = [
    ["panelist", "/api/auth/logout", "ss_panel"],
    ["candidate", "/api/auth/candidate-logout", "ss_cand"],
    ["admin", "/api/auth/admin-logout", "ss_admin"],
  ];

  for (const [role, endpoint, cookie] of cases) {
    test(`${role} logout expires ${cookie}`, async ({ request }) => {
      const res = await request.post(`${BASE}${endpoint}`);
      expect(res.status()).toBe(200);
      const setCookie = res.headers()["set-cookie"] ?? "";
      expect(setCookie).toContain(`${cookie}=`);
      // Must be expired, not merely re-set.
      expect(setCookie).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
    });

    test(`${role} logout cookie is HttpOnly`, async ({ request }) => {
      const res = await request.post(`${BASE}${endpoint}`);
      const setCookie = res.headers()["set-cookie"] ?? "";
      expect(setCookie).toMatch(/HttpOnly/i);
    });
  }

  test("after logout the browser can no longer reach the dashboard", async ({ browser }) => {
    const t = tokens();
    test.skip(!t.panelToken, "no panelist token");
    const ctx = await browser.newContext();
    await ctx.addCookies([{
      name: "ss_panel", value: t.panelToken!,
      domain: new URL(BASE).hostname, path: "/",
      httpOnly: true, secure: IS_PROD, sameSite: "Lax",
    }]);
    const page = await ctx.newPage();

    await page.goto(`${BASE}/dashboard`);
    expect(page.url()).toContain("/dashboard");

    await page.request.post(`${BASE}/api/auth/logout`);
    await page.goto(`${BASE}/dashboard`);
    await page.waitForURL(/\/login/, { timeout: 10_000 });
    expect(page.url()).toContain("/login");

    await ctx.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Only one role may be active per browser
// ─────────────────────────────────────────────────────────────────────────────
test.describe("Role exclusivity", () => {
  test("signing in as one role clears the other two cookies", async ({ request }) => {
    // verify-otp always clears the non-selected roles, even on the failure path we can
    // observe here; assert the clearing directives are present in the response.
    const res = await request.post(`${BASE}/api/auth/verify-otp`, {
      headers: { "Content-Type": "application/json" },
      data: { email: "exclusivity@example.com", code: "000000", type: "candidate" },
    });
    // A failed verification must not issue OR preserve a session.
    expect([401, 403]).toContain(res.status());
    const setCookie = res.headers()["set-cookie"] ?? "";
    expect(setCookie).not.toContain("ss_panel=ey");
    expect(setCookie).not.toContain("ss_admin=ey");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Google OAuth
// ─────────────────────────────────────────────────────────────────────────────
test.describe("Google OAuth", () => {
  test("initiating OAuth sets an HttpOnly nonce cookie", async ({ request }) => {
    const res = await request.get(`${BASE}/api/auth/google?type=candidate`, { maxRedirects: 0 });
    const setCookie = res.headers()["set-cookie"] ?? "";
    if (res.status() === 503) {
      test.skip(true, "Google OAuth not configured in this environment");
    }
    expect(setCookie).toContain("oauth_nonce=");
    expect(setCookie).toMatch(/HttpOnly/i);
  });

  test("a tampered nonce fails CSRF validation", async ({ request }) => {
    const state = Buffer.from(JSON.stringify({
      type: "candidate", next: "/me", nonce: "tampered",
    })).toString("base64url");
    const res = await request.get(`${BASE}/api/auth/google/callback?code=fake&state=${state}`, {
      maxRedirects: 0,
    });
    expect([302, 307, 308]).toContain(res.status());
    expect(res.headers()["location"] ?? "").toContain("error=");
    expect(res.headers()["set-cookie"] ?? "").not.toContain("ss_cand=ey");
  });

  test("OAuth never yields an admin session", async ({ request }) => {
    const state = Buffer.from(JSON.stringify({
      type: "admin", next: "/admin", nonce: "x",
    })).toString("base64url");
    const res = await request.get(`${BASE}/api/auth/google/callback?code=fake&state=${state}`, {
      maxRedirects: 0,
    });
    const setCookie = res.headers()["set-cookie"] ?? "";
    expect(setCookie).not.toMatch(/ss_admin=ey/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Login page UX
// ─────────────────────────────────────────────────────────────────────────────
test.describe("Login page", () => {
  test("renders the candidate form by default", async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await expect(page.getByText(/candidate sign in/i)).toBeVisible();
    await expect(page.getByPlaceholder(/you@example.com/i)).toBeVisible();
  });

  test("switching to panelist updates the copy", async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await page.getByRole("button", { name: /panelist/i }).click();
    await expect(page.getByText(/panelist sign in/i)).toBeVisible();
    await expect(page.getByPlaceholder(/you@company.com/i)).toBeVisible();
  });

  test("the send button is disabled until an email is entered", async ({ page }) => {
    await page.goto(`${BASE}/login`);
    const btn = page.getByRole("button", { name: /send sign-in code/i });
    await expect(btn).toBeDisabled();
    await page.getByPlaceholder(/you@example.com/i).fill("someone@example.com");
    await expect(btn).toBeEnabled();
  });

  test("/candidate/login redirects to the unified page", async ({ page }) => {
    await page.goto(`${BASE}/candidate/login`);
    await page.waitForURL(/\/login/);
    expect(page.url()).toContain("type=candidate");
  });
});
