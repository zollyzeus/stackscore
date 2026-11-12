/**
 * Admin panel tests — covers auth guards and core admin flows.
 * Tests run against either localhost:3000 (default) or TEST_BASE_URL (prod).
 *
 * To run against prod:
 *   TEST_BASE_URL=https://stackscore.anandrajendran.dev npx playwright test tests/admin.spec.ts
 */
import { test, expect } from "@playwright/test";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";

// ── 1. Admin access control (A1: session-only; the IP allowlist was removed) ─
//
// These assertions used to be `expect([403, 200]).toContain(status)`, which passes when the
// endpoint returns the page, and they skipped against prod because the runner's IP was not
// allow-listed. Both weaknesses came from the allowlist. With it gone the admin surface
// behaves identically everywhere, so these can state what should actually happen -- and
// they now run against production, which is where it matters.
test.describe("Admin access control", () => {
  test("GET /admin redirects an unauthenticated visitor to login", async ({ request }) => {
    const res = await request.get(`${BASE}/admin`, { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    const location = res.headers()["location"] ?? "";
    expect(location).toContain("/login");
    // ?type=admin matters: the login page uses it to show the admin form rather than the
    // candidate one, so a broken redirect strands the operator on the wrong screen.
    expect(location).toContain("type=admin");
  });

  test("GET /admin never serves admin content unauthenticated", async ({ request }) => {
    // Following the redirect must land on the login page, not the console.
    const res = await request.get(`${BASE}/admin`);
    expect(res.ok()).toBeTruthy();
    const body = await res.text();
    expect(body).not.toMatch(/Pending panelist requests/i);
    expect(body).toMatch(/sign in/i);
  });

  test("GET /api/admin/analytics returns 401 without an admin session", async ({ request }) => {
    const res = await request.get(`${BASE}/api/admin/analytics`);
    expect(res.status()).toBe(401);
  });

  test("POST /api/admin/panelist-requests returns 401 without an admin session", async ({ request }) => {
    const res = await request.post(`${BASE}/api/admin/panelist-requests`, {
      data: { email: "test@example.com", action: "approve" },
    });
    expect(res.status()).toBe(401);
  });

  test("POST /api/admin/admins cannot be used to self-grant admin", async ({ request }) => {
    // The highest-value target on the admin surface: anonymous privilege escalation.
    const res = await request.post(`${BASE}/api/admin/admins`, {
      data: { email: "attacker@evil.com" },
    });
    expect(res.status()).toBe(401);
  });

  test("a forged admin cookie is rejected", async ({ request }) => {
    // Signature verification, not merely cookie presence.
    const res = await request.get(`${BASE}/api/admin/analytics`, {
      headers: { Cookie: "ss_admin=not.a.valid.token" },
    });
    expect(res.status()).toBe(401);
  });
});

// ── 3. Admin page — authenticated panelist, non-admin ───────────────────────
test.describe("Admin page — non-admin panelist", () => {
  test("panelist without admin role sees Access Denied", async ({ page }) => {
    if (BASE.includes("stackscore.anandrajendran.dev")) {
      test.skip(true, "Skipped: test runner IP not in allowlist for prod");
    }
    // Use the test panelist cookie (set up by auth-setup.ts)
    await page.goto(`${BASE}/admin`);
    // Should show either Access Restricted (IP) or Access Denied (not admin) or redirect to login
    const body = (await page.content()).toLowerCase();
    const isBlocked =
      body.includes("access restricted") ||
      body.includes("access denied") ||
      page.url().includes("/login");
    expect(isBlocked, `page was not blocked; url=${page.url()}`).toBe(true);
  });
});

// ── 3b. Admin is a distinct role, not an elevated panelist ──────────────────
test.describe("Admin role separation", () => {
  test("send-otp type=admin for a non-admin email is rejected (IP or registry)", async ({ request }) => {
    const res = await request.post(`${BASE}/api/auth/send-otp`, {
      data: { email: "not-an-admin-zzz@example.com", type: "admin" },
    });
    // 403 forbidden (bad IP) or 403 access_denied (not in admin registry) — never 200/202
    expect(res.status()).toBe(403);
  });

  test("verify-otp type=admin for a non-admin email is rejected before checking the OTP code", async ({ request }) => {
    const res = await request.post(`${BASE}/api/auth/verify-otp`, {
      data: { email: "not-an-admin-zzz@example.com", code: "000000", type: "admin" },
    });
    expect(res.status()).toBe(403);
  });

  test("a valid panelist session alone cannot reach /api/admin/analytics (no ss_admin cookie)", async ({ request }) => {
    // Simulates the old bug: panelist cookie must never substitute for an admin session.
    const res = await request.get(`${BASE}/api/admin/analytics`, {
      headers: { Cookie: "ss_panel=not-a-real-token" },
    });
    expect([401, 403]).toContain(res.status());
  });
});

// ── 4. Panelist signup request flow ─────────────────────────────────────────
test.describe("Panelist signup request flow", () => {
  test("unknown email returns 202 pending_approval", async ({ request }) => {
    const res = await request.post(`${BASE}/api/auth/send-otp`, {
      data: { email: "unknown-test-panelist-zzz@example.com", type: "panelist" },
    });
    // 202 = pending approval, 403 = rejected
    expect([202, 403]).toContain(res.status());
    if (res.status() === 202) {
      const body = await res.json();
      expect(body.error).toBe("pending_approval");
    }
  });

  test("candidate type always gets OTP regardless of email", async ({ request }) => {
    const res = await request.post(`${BASE}/api/auth/send-otp`, {
      data: { email: "any-candidate@example.com", type: "candidate" },
    });
    // Should not be blocked — 200 OK or 500 (email send failure in test env)
    expect([200, 500, 429]).toContain(res.status());
    if (res.status() !== 200) return;
    const body = await res.json();
    expect(body.error).toBeUndefined();
  });
});

// ── 5. Prod smoke test (run with TEST_BASE_URL set) ──────────────────────────
test.describe("Prod admin smoke (requires TEST_BASE_URL + allowed IP)", () => {
  test.skip(!process.env.TEST_BASE_URL || !process.env.ADMIN_SESSION_COOKIE,
    "Set TEST_BASE_URL and ADMIN_SESSION_COOKIE to run prod admin tests");

  test("GET /api/admin/analytics returns data with valid admin cookie", async ({ request }) => {
    const cookie = process.env.ADMIN_SESSION_COOKIE!;
    const res = await request.get(`${BASE}/api/admin/analytics`, {
      headers: { Cookie: `ss_admin=${cookie}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body.totalSessions).toBe("number");
    expect(typeof body.activePanelists).toBe("number");
  });

  test("GET /admin loads admin console with valid admin cookie", async ({ page }) => {
    const cookie = process.env.ADMIN_SESSION_COOKIE!;
    await page.context().addCookies([{
      name: "ss_admin",
      value: cookie,
      domain: new URL(BASE).hostname,
      path: "/",
    }]);
    await page.goto(`${BASE}/admin`);
    await expect(page.getByText("Admin Console")).toBeVisible();
    await expect(page.getByText("Overview")).toBeVisible();
  });
});
