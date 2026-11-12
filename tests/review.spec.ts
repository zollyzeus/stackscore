/**
 * Reviewer role and blind-review pipeline (AUDIT_TODO A3).
 *
 * The property worth testing above all others: a reviewer's browser never receives the AI's
 * scores. That is enforced server-side in /api/review/submission, which is why these tests
 * assert on the API response rather than on what the page happens to render — a page that
 * receives the scores and declines to display them has already lost.
 */
import { test, expect } from "@playwright/test";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";

test.describe("Reviewer access control", () => {
  test("GET /review redirects an unauthenticated visitor to the reviewer login", async ({ request }) => {
    const res = await request.get(`${BASE}/review`, { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    const location = res.headers()["location"] ?? "";
    expect(location).toContain("/login");
    expect(location).toContain("type=reviewer");
  });

  test("the review APIs reject an anonymous caller", async ({ request }) => {
    for (const path of ["/api/review/tasks", "/api/review/submission?sessionId=x"]) {
      const res = await request.get(`${BASE}${path}`);
      expect(res.status(), `${path} must require a reviewer session`).toBe(401);
    }
  });

  test("submitting a review anonymously is rejected", async ({ request }) => {
    // The highest-value target in this feature: writing scores onto a candidate's record.
    const res = await request.post(`${BASE}/api/review/submit`, {
      data: { sessionId: "anything", scores: { D1: 100 } },
    });
    expect(res.status()).toBe(401);
  });

  test("claiming a task anonymously is rejected", async ({ request }) => {
    const res = await request.post(`${BASE}/api/review/claim`, { data: { sessionId: "anything" } });
    expect(res.status()).toBe(401);
  });

  test("a forged reviewer cookie is rejected", async ({ request }) => {
    const res = await request.get(`${BASE}/api/review/tasks`, {
      headers: { Cookie: "ss_reviewer=forged.token.value" },
    });
    expect(res.status()).toBe(401);
  });

  test("a panelist cookie does not grant reviewer access", async ({ request }) => {
    // Roles are deliberately disjoint: a panelist can already see AI scores, which is
    // exactly who must not be able to walk into a blind review with that context.
    const res = await request.get(`${BASE}/api/review/tasks`, {
      headers: { Cookie: "ss_panel=some.panelist.token" },
    });
    expect(res.status()).toBe(401);
  });
});

test.describe("Reviewer sign-in", () => {
  test("an unregistered address cannot request a reviewer code", async ({ request }) => {
    const res = await request.post(`${BASE}/api/auth/send-otp`, {
      data: { email: `not-a-reviewer-${Date.now()}@example.com`, type: "reviewer" },
    });
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("access_denied");
  });

  test("an unregistered address cannot verify into a reviewer session", async ({ request }) => {
    const res = await request.post(`${BASE}/api/auth/verify-otp`, {
      data: { email: `not-a-reviewer-${Date.now()}@example.com`, code: "000000", type: "reviewer" },
    });
    expect([401, 403]).toContain(res.status());
    expect(res.headers()["set-cookie"] ?? "").not.toContain("ss_reviewer=");
  });

  test("the login page offers reviewer sign-in via OTP and Google", async ({ page }) => {
    await page.goto(`${BASE}/login?type=reviewer`);
    await expect(page.getByText(/reviewer sign in/i)).toBeVisible();
    const google = page.getByRole("link", { name: /continue with google/i });
    await expect(google).toBeVisible();
    expect(await google.getAttribute("href")).toContain("type=reviewer");
  });
});

test.describe("Admin review pipeline", () => {
  test("the review queue is admin-only", async ({ request }) => {
    const res = await request.get(`${BASE}/api/admin/review-queue`);
    expect(res.status()).toBe(401);
  });

  test("assigning a reviewer is admin-only", async ({ request }) => {
    const res = await request.post(`${BASE}/api/admin/review-queue`, {
      data: { sessionId: "x", reviewerEmail: "someone@example.com" },
    });
    expect(res.status()).toBe(401);
  });

  test("the reviewer registry is admin-only", async ({ request }) => {
    const res = await request.post(`${BASE}/api/admin/reviewers`, {
      data: { email: "attacker@evil.com" },
    });
    expect(res.status()).toBe(401);
  });
});

test.describe("Re-judge worker", () => {
  test("cannot be triggered without the task-runner secret", async ({ request }) => {
    // This endpoint spends money on model calls, so an open version of it is a billing
    // vulnerability as much as an access-control one. It fails closed when the secret is
    // unset, which is the case this asserts in CI.
    const res = await request.post(`${BASE}/api/tasks/rejudge`);
    expect(res.status()).toBe(401);
  });

  test("a wrong bearer token is rejected", async ({ request }) => {
    const res = await request.post(`${BASE}/api/tasks/rejudge`, {
      headers: { Authorization: "Bearer definitely-not-the-secret" },
    });
    expect(res.status()).toBe(401);
  });
});

test.describe("Calibration monitor and scoring hold (B5)", () => {
  test("the monitor cannot be triggered without the task-runner secret", async ({ request }) => {
    // It spends money on judge calls, so an open version is a billing vulnerability.
    const res = await request.post(`${BASE}/api/tasks/calibration-monitor`);
    expect(res.status()).toBe(401);
  });

  test("the pending-queue drain cannot be triggered anonymously", async ({ request }) => {
    const res = await request.post(`${BASE}/api/tasks/drain-pending`);
    expect(res.status()).toBe(401);
  });

  test("scoring settings are admin-only to read", async ({ request }) => {
    const res = await request.get(`${BASE}/api/admin/settings`);
    expect(res.status()).toBe(401);
  });

  test("scoring cannot be paused by an anonymous caller", async ({ request }) => {
    // Pausing scoring is a denial-of-service against the whole product if it is reachable
    // without an admin session.
    const res = await request.post(`${BASE}/api/admin/settings`, {
      data: { holdActive: true, reason: "unauthorised" },
    });
    expect(res.status()).toBe(401);
  });

  test("the automatic hold cannot be armed by an anonymous caller", async ({ request }) => {
    const res = await request.post(`${BASE}/api/admin/settings`, {
      data: { scoringHoldEnabled: true },
    });
    expect(res.status()).toBe(401);
  });
});
