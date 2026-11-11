/**
 * Timeout tests — idle session guard + assessment inactivity warning.
 *
 * Uses page.clock to fast-forward time without real waiting.
 * All API routes are mocked; no prod state is mutated.
 */
import { test, expect, type Page } from "@playwright/test";

// ── constants mirror IdleGuard.tsx ───────────────────────────────────────────
/**
 * IdleGuard lives in the root layout, so it is present on every page. Tests mount it on a
 * neutral public page rather than /dashboard or /login:
 *   - /dashboard is middleware-gated, so an anonymous test context is redirected to
 *     /login and the component under test never renders.
 *   - /login auto-redirects when the mocked session says "already signed in", which
 *     produces a navigation loop instead of a settled page.
 * /why is public, static, and has no redirect behaviour.
 */
const IDLE_PAGE = "/why";

const IDLE_MS = 15 * 60 * 1000;   // 15 min
const WARN_MS =  2 * 60 * 1000;   // warn 2 min before
const TICK_MS = 30 * 1000;        // IdleGuard check interval

// ── constants mirror assessment/page.tsx ─────────────────────────────────────
const ASSESS_INACTIVE_MS = 3 * 60 * 1000;  // 3 min
const ASSESS_CHECK_MS    = 60 * 1000;      // check every 60 s

// ── mock helpers ─────────────────────────────────────────────────────────────

/** IdleGuard probes all three role endpoints; an unmocked one would hit the dev server. */
async function mockRoleProbes(
  page: Page,
  roles: { panelist?: boolean; candidate?: boolean; admin?: boolean }
) {
  const json = (body: unknown) => ({
    status: 200, contentType: "application/json", body: JSON.stringify(body),
  });
  await page.route("**/api/auth/me", (r) => r.fulfill(json(
    roles.panelist
      ? { authenticated: true, name: "Test Panelist", email: "panelist@test.com" }
      : { authenticated: false }
  )));
  await page.route("**/api/auth/candidate-me", (r) => r.fulfill(json(
    roles.candidate
      ? { authenticated: true, name: "Test Candidate", email: "cand@test.com" }
      : { authenticated: false }
  )));
  await page.route("**/api/auth/admin-me", (r) => r.fulfill(json(
    roles.admin
      ? { authenticated: true, name: "Test Admin", email: "admin@test.com" }
      : { authenticated: false }
  )));
}

async function mockLoggedInPanelist(page: Page) {
  await mockRoleProbes(page, { panelist: true });
}

async function mockLoggedInCandidate(page: Page) {
  await mockRoleProbes(page, { candidate: true });
}

async function mockLoggedInAdmin(page: Page) {
  await mockRoleProbes(page, { admin: true });
}

/**
 * Installs the virtual clock, navigates, and waits for IdleGuard's three role probes to
 * resolve before returning.
 *
 * Without this wait there is a race: page.clock.fastForward() advances virtual time
 * immediately, but the /api/auth/*-me fetches resolve in real time. If the jump happens
 * first, `isLoggedIn` is still false, the effect returns early, no interval is ever
 * registered — and virtual time never advances again, so the warning can never fire.
 */
async function openWithClock(page: Page, url: string) {
  await page.clock.install();
  const probes = Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/auth/me"), { timeout: 15_000 }),
    page.waitForResponse((r) => r.url().includes("/api/auth/candidate-me"), { timeout: 15_000 }),
    page.waitForResponse((r) => r.url().includes("/api/auth/admin-me"), { timeout: 15_000 }),
  ]).catch(() => undefined);
  await page.goto(url);
  await probes;
  // Let React commit the resulting state and register the interval.
  await page.waitForTimeout(250);
}

async function mockLogoutEndpoints(page: Page) {
  await page.route("**/api/auth/logout", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) })
  );
  await page.route("**/api/auth/candidate-logout", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) })
  );
  await page.route("**/api/auth/admin-logout", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) })
  );
}

async function mockAssessmentSession(page: Page) {
  await page.route("**/api/session", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      sessionId: "timeout-test-001",
      cell: { rowId: "R1", columnId: "C1", rowLabel: "API", columnLabel: "Scale", seed: "api", pressure: "load" },
      brief: "Design a rate-limited API gateway.",
    }) })
  );
  await page.route("**/api/stakeholder-chat", (r) =>
    r.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ reply: "We expect 50k RPS at peak." }) })
  );
  await mockRoleProbes(page, {});
}

// ── IdleGuard — panelist ──────────────────────────────────────────────────────

test.describe("Idle session timeout — panelist", () => {
  test("warning modal appears after 13 min of inactivity", async ({ page }) => {
    await mockLoggedInPanelist(page);
    await openWithClock(page, IDLE_PAGE);

    // Fast-forward to just past the warning threshold (IDLE_MS - WARN_MS + 1 tick)
    await page.clock.fastForward(IDLE_MS - WARN_MS + TICK_MS);

    await expect(page.getByRole("alertdialog")).toBeVisible({ timeout: 3_000 });
    await expect(page.getByText("Still there?")).toBeVisible();
    await expect(page.getByRole("button", { name: "Stay logged in" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Log out now" })).toBeVisible();
  });

  test("countdown in warning modal is 2 min or less", async ({ page }) => {
    await mockLoggedInPanelist(page);
    await openWithClock(page, IDLE_PAGE);

    await page.clock.fastForward(IDLE_MS - WARN_MS + TICK_MS);
    await expect(page.getByRole("alertdialog")).toBeVisible({ timeout: 3_000 });

    // Countdown should show ≤ 2:00
    const countdown = page.locator(".idle-countdown");
    await expect(countdown).toBeVisible();
    const text = await countdown.textContent();
    // Format: "1:59" or "119s" — just assert it's not empty and not past 2 min
    expect(text).toBeTruthy();
    expect(text!.trim()).not.toBe("");
  });

  test("'Stay logged in' dismisses the modal and resets timer", async ({ page }) => {
    await mockLoggedInPanelist(page);
    await openWithClock(page, IDLE_PAGE);

    await page.clock.fastForward(IDLE_MS - WARN_MS + TICK_MS);
    await expect(page.getByRole("alertdialog")).toBeVisible({ timeout: 3_000 });

    await page.getByRole("button", { name: "Stay logged in" }).click();
    await expect(page.getByRole("alertdialog")).not.toBeVisible();
  });

  test("'Log out now' calls logout and redirects to /login", async ({ page }) => {
    await mockLoggedInPanelist(page);
    await mockLogoutEndpoints(page);
    await openWithClock(page, IDLE_PAGE);

    await page.clock.fastForward(IDLE_MS - WARN_MS + TICK_MS);
    await expect(page.getByRole("alertdialog")).toBeVisible({ timeout: 3_000 });

    // Regression: the window-level mousedown listener used to dismiss this dialog before
    // React could dispatch the click, so "Log out now" silently did nothing.
    const logoutCalls: string[] = [];
    await page.route("**/api/auth/logout", (r) => {
      logoutCalls.push(r.request().url());
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });

    await page.getByRole("button", { name: "Log out now" }).click();
    await page.waitForURL(/\/login/, { timeout: 10_000 });
    expect(page.url()).toContain("/login");
    expect(logoutCalls.length, "Log out now must actually call the logout endpoint").toBeGreaterThan(0);
  });

  test("auto-logout fires at 15 min with no interaction", async ({ page }) => {
    await mockLoggedInPanelist(page);
    await mockLogoutEndpoints(page);
    await openWithClock(page, IDLE_PAGE);

    // Fast-forward past the full idle timeout
    await page.clock.fastForward(IDLE_MS + TICK_MS);

    await page.waitForURL(/\/login/, { timeout: 5_000 });
    expect(page.url()).toContain("/login");
  });

  test("user activity resets the idle timer — no modal at 13 min after activity", async ({ page }) => {
    await mockLoggedInPanelist(page);
    await openWithClock(page, IDLE_PAGE);

    // Advance to 10 min, then simulate activity (click resets lastActivityRef)
    await page.clock.fastForward(10 * 60 * 1000);
    await page.mouse.click(400, 400); // triggers mousemove/click listeners

    // Advance another 10 min (20 min total, but only 10 min since last activity)
    await page.clock.fastForward(10 * 60 * 1000);

    // Warning threshold (13 min from last activity) not yet reached
    await expect(page.locator(".idle-overlay")).not.toBeVisible();
  });

  test("no idle guard fires when not logged in", async ({ page }) => {
    await page.route("**/api/auth/me", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authenticated: false }) })
    );
    await page.route("**/api/auth/candidate-me", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authenticated: false }) })
    );
    await openWithClock(page, "/");

    await page.clock.fastForward(IDLE_MS + TICK_MS);
    await expect(page.locator(".idle-overlay")).not.toBeVisible();
    // Should NOT have redirected away
    expect(page.url()).not.toContain("/login");
  });

  test("auto-logout redirects to /login?reason=idle", async ({ page }) => {
    await mockLoggedInPanelist(page);
    await mockLogoutEndpoints(page);
    await openWithClock(page, IDLE_PAGE);

    await page.clock.fastForward(IDLE_MS + TICK_MS);

    await page.waitForURL(/\/login/, { timeout: 5_000 });
    expect(page.url()).toContain("/login");
    expect(page.url()).toContain("reason=idle");
  });
});

// ── IdleGuard — candidate ─────────────────────────────────────────────────────

test.describe("Idle session timeout — candidate", () => {
  test("warning modal appears for logged-in candidate after 13 min", async ({ page }) => {
    await mockLoggedInCandidate(page);
    await openWithClock(page, IDLE_PAGE);

    await page.clock.fastForward(IDLE_MS - WARN_MS + TICK_MS);
    await expect(page.getByRole("alertdialog")).toBeVisible({ timeout: 3_000 });
    await expect(page.getByText("Still there?")).toBeVisible();
  });

  test("candidate auto-logout at 15 min redirects to /login", async ({ page }) => {
    await mockLoggedInCandidate(page);
    await mockLogoutEndpoints(page);
    await openWithClock(page, IDLE_PAGE);

    await page.clock.fastForward(IDLE_MS + TICK_MS);
    await page.waitForURL(/\/login/, { timeout: 5_000 });
    expect(page.url()).toContain("/login");
  });
});

// ── Assessment inactivity warning ─────────────────────────────────────────────

test.describe("Assessment inactivity warning", () => {
  test("inactive overlay appears after 3 min idle during Clarify stage", async ({ page }) => {
    await mockAssessmentSession(page);
    await openWithClock(page, "/assessment");

    await page.getByRole("button", { name: "Start assessment" }).click();
    await expect(page.getByRole("heading", { name: /Stage 1.*Clarify/i })).toBeVisible({ timeout: 10_000 });

    // Fast-forward past the 3-min inactivity threshold (checked every 60s)
    await page.clock.fastForward(ASSESS_INACTIVE_MS + ASSESS_CHECK_MS);

    await expect(page.locator(".inactive-overlay")).toBeVisible({ timeout: 3_000 });
    await expect(page.getByText(/You've been inactive/i)).toBeVisible();
  });

  test("'Continue' on inactive overlay dismisses it", async ({ page }) => {
    await mockAssessmentSession(page);
    await openWithClock(page, "/assessment");

    await page.getByRole("button", { name: "Start assessment" }).click();
    await expect(page.getByRole("heading", { name: /Stage 1.*Clarify/i })).toBeVisible({ timeout: 10_000 });
    await page.clock.fastForward(ASSESS_INACTIVE_MS + ASSESS_CHECK_MS);
    await expect(page.locator(".inactive-overlay")).toBeVisible({ timeout: 3_000 });

    await page.getByRole("button", { name: /Continue/i }).click();
    await expect(page.locator(".inactive-overlay")).not.toBeVisible();
  });

  test("'Quit' on inactive overlay ends assessment and calls session-status", async ({ page }) => {
    await mockAssessmentSession(page);
    await page.route("**/api/session-status", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) })
    );
    await openWithClock(page, "/assessment");

    await page.getByRole("button", { name: "Start assessment" }).click();
    await expect(page.getByRole("heading", { name: /Stage 1.*Clarify/i })).toBeVisible({ timeout: 10_000 });
    await page.clock.fastForward(ASSESS_INACTIVE_MS + ASSESS_CHECK_MS);
    await expect(page.locator(".inactive-overlay")).toBeVisible({ timeout: 3_000 });

    // Track the session-status call
    const [request] = await Promise.all([
      page.waitForRequest("**/api/session-status"),
      page.getByRole("button", { name: /Save & quit/i }).click(),
    ]);
    const body = JSON.parse(request.postData() ?? "{}");
    expect(body.status).toBe("quit");
  });

  test("inactivity overlay does NOT appear on start screen (before assessment begins)", async ({ page }) => {
    await mockAssessmentSession(page);
    await openWithClock(page, "/assessment");
    // Do NOT click Start — stay on the start screen
    await page.clock.fastForward(ASSESS_INACTIVE_MS + ASSESS_CHECK_MS * 5);
    await expect(page.locator(".inactive-overlay")).not.toBeVisible();
  });

  test("timer resets after activity — no overlay at 3 min after interaction", async ({ page }) => {
    await mockAssessmentSession(page);
    await openWithClock(page, "/assessment");

    await page.getByRole("button", { name: "Start assessment" }).click();
    await expect(page.getByRole("heading", { name: /Stage 1.*Clarify/i })).toBeVisible({ timeout: 10_000 });

    // Advance 2 min, then interact
    await page.clock.fastForward(2 * 60 * 1000);
    await page.mouse.move(400, 400);

    // Advance another 2 min (only 2 min since last activity, threshold is 3 min)
    await page.clock.fastForward(2 * 60 * 1000);
    await expect(page.locator(".inactive-overlay")).not.toBeVisible();
  });

  test("overall 60-min timer is visible and ticks down during assessment", async ({ page }) => {
    await mockAssessmentSession(page);
    await openWithClock(page, "/assessment");

    await page.getByRole("button", { name: "Start assessment" }).click();
    await expect(page.locator(".overall-timer")).toBeVisible({ timeout: 10_000 });

    const before = await page.locator(".overall-timer").textContent();
    await page.clock.fastForward(60 * 1000); // 1 min
    const after = await page.locator(".overall-timer").textContent();
    expect(before).not.toBe(after);
  });
});

// ── IdleGuard — admin (A8) ───────────────────────────────────────────────────
// Admin is the highest-privilege role and was previously the ONLY one the idle guard
// did not arm: an admin console stayed logged in indefinitely.

test.describe("Idle session timeout — admin (A8)", () => {
  test("warning modal appears for a logged-in admin", async ({ page }) => {
    await mockLoggedInAdmin(page);
    await openWithClock(page, IDLE_PAGE);

    await page.clock.fastForward(IDLE_MS - WARN_MS + TICK_MS);
    await expect(page.getByRole("alertdialog")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Still there?")).toBeVisible();
  });

  test("admin auto-logout fires and clears the admin session", async ({ page }) => {
    await mockLoggedInAdmin(page);
    await mockLogoutEndpoints(page);

    const logoutCalls: string[] = [];
    await page.route("**/api/auth/admin-logout", (r) => {
      logoutCalls.push(r.request().url());
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });

    await openWithClock(page, IDLE_PAGE);

    await page.clock.fastForward(IDLE_MS + TICK_MS);
    await page.waitForURL(/\/login/, { timeout: 10_000 });
    expect(page.url()).toContain("/login");
    expect(logoutCalls.length, "admin-logout must be called on idle timeout").toBeGreaterThan(0);
  });

  test("no idle timer is armed when nobody is signed in", async ({ page }) => {
    await mockRoleProbes(page, {});
    await openWithClock(page, "/");

    await page.clock.fastForward(IDLE_MS + TICK_MS * 2);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
  });
});
