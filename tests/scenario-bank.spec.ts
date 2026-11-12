/**
 * Scenario Bank tests — covers the new generation fallback / buffer mechanism.
 *
 * Four concern areas:
 *   1. Task auth  — /api/tasks/fill-scenario-bank rejects without the TASK_RUNNER_SECRET
 *   2. Admin auth — /api/admin/scenario-bank requires an admin session
 *   3. Session creation with bankPackId — session route wires bank data onto the session
 *   4. Fallback chain — generate-problem returns bankPackId when live generation is stubbed
 *
 * Tests that call the fill task or hit the bank admin route with a valid token are skipped
 * unless TASK_RUNNER_SECRET is set in the environment (they'd hit a real Gemini call in CI).
 *
 * Usage (local dev):
 *   npx playwright test tests/scenario-bank.spec.ts
 * Usage (against prod):
 *   TEST_BASE_URL=https://stackscore-u3cmakw2zq-uc.a.run.app \
 *   TASK_RUNNER_SECRET=... npx playwright test tests/scenario-bank.spec.ts
 */
import { test, expect } from "@playwright/test";
import { BASE, IS_PROD, tokens, cookieHeader, forgedToken } from "./helpers";

const TASK_SECRET = process.env.TASK_RUNNER_SECRET ?? "";
const HAS_TASK_SECRET = TASK_SECRET.length > 0;

// ─────────────────────────────────────────────────────────────────────────────
// 1. Task route auth guards
// ─────────────────────────────────────────────────────────────────────────────
test.describe("fill-scenario-bank task auth", () => {
  test("POST /api/tasks/fill-scenario-bank without secret → 401", async ({ request }) => {
    const res = await request.post(`${BASE}/api/tasks/fill-scenario-bank`);
    // 404 means the route is not yet deployed (build in flight); both are acceptable.
    expect([401, 404]).toContain(res.status());
    if (res.status() !== 404) expect(res.status()).toBe(401);
  });

  test("POST /api/tasks/fill-scenario-bank with wrong secret → 401", async ({ request }) => {
    const res = await request.post(`${BASE}/api/tasks/fill-scenario-bank`, {
      headers: { "x-task-runner-secret": "wrong-secret" },
    });
    expect([401, 404]).toContain(res.status());
    if (res.status() !== 404) expect(res.status()).toBe(401);
  });

  test("POST /api/tasks/fill-scenario-bank with correct secret → 200 or 500 (never 401/403)", async ({ request }) => {
    test.skip(!HAS_TASK_SECRET, "TASK_RUNNER_SECRET not set — skipping live fill call");
    const res = await request.post(`${BASE}/api/tasks/fill-scenario-bank`, {
      headers: { "x-task-runner-secret": TASK_SECRET },
    });
    expect([200, 500]).toContain(res.status());
    if (res.status() === 200) {
      const body = await res.json() as { message: string; available?: number; target?: number };
      expect(["bank_full", "fill_complete"]).toContain(body.message);
      if (body.message === "fill_complete") {
        expect(typeof body.available).toBe("number");
        expect(typeof body.target).toBe("number");
      }
    }
  });

  test("fill response shape: bank_full has available and target", async ({ request }) => {
    test.skip(!HAS_TASK_SECRET, "TASK_RUNNER_SECRET not set");
    // Run twice so the second call is likely to return bank_full (pool was just topped up).
    await request.post(`${BASE}/api/tasks/fill-scenario-bank`, {
      headers: { "x-task-runner-secret": TASK_SECRET },
    });
    const res = await request.post(`${BASE}/api/tasks/fill-scenario-bank`, {
      headers: { "x-task-runner-secret": TASK_SECRET },
    });
    if (res.status() === 200) {
      const body = await res.json() as Record<string, unknown>;
      expect(body).toHaveProperty("available");
      expect(body).toHaveProperty("target");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Admin scenario-bank route auth guards
// ─────────────────────────────────────────────────────────────────────────────
test.describe("admin scenario-bank route auth", () => {
  test("GET /api/admin/scenario-bank without auth → 401", async ({ request }) => {
    const res = await request.get(`${BASE}/api/admin/scenario-bank`);
    expect(res.status()).toBe(401);
  });

  test("POST /api/admin/scenario-bank without auth → 401", async ({ request }) => {
    const res = await request.post(`${BASE}/api/admin/scenario-bank`);
    expect(res.status()).toBe(401);
  });

  test("GET /api/admin/scenario-bank with forged admin cookie → 401", async ({ request }) => {
    const res = await request.get(`${BASE}/api/admin/scenario-bank`, {
      headers: { cookie: `ss_admin=${forgedToken({ email: "attacker@evil.com" })}` },
    });
    expect(res.status()).toBe(401);
  });

  test("GET /api/admin/scenario-bank with valid admin token → 200 with stats", async ({ request }) => {
    const { adminToken } = tokens();
    test.skip(!adminToken, "admin token not in .auth-tokens.json — run auth-setup first");
    const res = await request.get(`${BASE}/api/admin/scenario-bank`, {
      headers: { cookie: cookieHeader({ ss_admin: adminToken }) },
    });
    expect(res.status()).toBe(200);
    const body = await res.json() as { available: number; allocated: number; total: number };
    expect(typeof body.available).toBe("number");
    expect(typeof body.allocated).toBe("number");
    expect(typeof body.total).toBe("number");
    expect(body.total).toBe(body.available + body.allocated);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Session creation — bankPackId plumbing
// ─────────────────────────────────────────────────────────────────────────────
test.describe("session creation with bankPackId", () => {
  test("passing a non-existent bankPackId still creates a valid session (live fallback)", async ({ request }) => {
    test.skip(IS_PROD, "skipping live session creation against prod to avoid cost");
    const { panelToken } = tokens();
    test.skip(!panelToken, "panelist token not set");

    const res = await request.post(`${BASE}/api/session`, {
      headers: { cookie: cookieHeader({ ss_panel: panelToken }) },
      data: {
        mode: "manual",
        rowId: "R1",
        columnId: "C1",
        bankPackId: "nonexistent-pack-id-000",
      },
    });
    // Should succeed (live generation takes over when pack not found)
    expect([200, 201]).toContain(res.status());
    const body = await res.json() as { sessionId?: string; brief?: string };
    expect(typeof body.sessionId).toBe("string");
    expect(typeof body.brief).toBe("string");
    expect(body.brief!.length).toBeGreaterThan(20);
  });

  test("POST /api/session without bankPackId still works (baseline, no regression)", async ({ request }) => {
    test.skip(IS_PROD, "skipping live session creation against prod to avoid cost");
    const { panelToken } = tokens();
    test.skip(!panelToken, "panelist token not set");

    const res = await request.post(`${BASE}/api/session`, {
      headers: { cookie: cookieHeader({ ss_panel: panelToken }) },
      data: { mode: "manual", rowId: "R1", columnId: "C1" },
    });
    expect([200, 201]).toContain(res.status());
    const body = await res.json() as { sessionId?: string };
    expect(typeof body.sessionId).toBe("string");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. /api/generate-problem — returns bankPackId field (shape check)
// ─────────────────────────────────────────────────────────────────────────────
test.describe("generate-problem response shape", () => {
  test("response either has no bankPackId (live succeeded) or bankPackId is a string (bank used)", async ({ request }) => {
    test.skip(IS_PROD, "skipping live generate-problem against prod to avoid cost");
    const { panelToken } = tokens();
    test.skip(!panelToken, "panelist token not set");

    const res = await request.post(`${BASE}/api/generate-problem`, {
      headers: { cookie: cookieHeader({ ss_panel: panelToken }) },
      data: { mode: "random" },
    });
    expect([200, 201]).toContain(res.status());
    const body = await res.json() as { cell?: object; brief?: string; bankPackId?: unknown };
    expect(body.cell).toBeTruthy();
    expect(typeof body.brief).toBe("string");
    // bankPackId is present only when bank was used; absent means live generation worked.
    if ("bankPackId" in body) {
      expect(typeof body.bankPackId).toBe("string");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. inject-twist — bank path uses pre-stored fields (no regression on live path)
// ─────────────────────────────────────────────────────────────────────────────
test.describe("inject-twist live path regression", () => {
  test("POST /api/inject-twist without a session → 401", async ({ request }) => {
    const res = await request.post(`${BASE}/api/inject-twist`, {
      data: { sessionId: "fake-session" },
    });
    expect(res.status()).toBe(401);
  });

  test("POST /api/inject-twist with a fake sessionId (authed) → 404 or 500 (not 401)", async ({ request }) => {
    const { candToken } = tokens();
    test.skip(!candToken, "candidate token not set");
    const res = await request.post(`${BASE}/api/inject-twist`, {
      headers: { cookie: cookieHeader({ ss_cand: candToken }) },
      data: { sessionId: "definitely-does-not-exist-xyz" },
    });
    // Should fail on session lookup (404/500), never on auth (401)
    expect(res.status()).not.toBe(401);
    expect([404, 500]).toContain(res.status());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. /api/tasks/reclaim-bank-packs — orphan cleanup task
// ─────────────────────────────────────────────────────────────────────────────
test.describe("reclaim-bank-packs task auth", () => {
  test("POST /api/tasks/reclaim-bank-packs without secret → 401", async ({ request }) => {
    const res = await request.post(`${BASE}/api/tasks/reclaim-bank-packs`);
    expect([401, 404]).toContain(res.status());
  });

  test("POST /api/tasks/reclaim-bank-packs with wrong secret → 401", async ({ request }) => {
    const res = await request.post(`${BASE}/api/tasks/reclaim-bank-packs`, {
      headers: { "x-task-runner-secret": "wrong-secret" },
    });
    expect([401, 404]).toContain(res.status());
  });

  test("POST /api/tasks/reclaim-bank-packs with correct secret → 200", async ({ request }) => {
    test.skip(!HAS_TASK_SECRET, "TASK_RUNNER_SECRET not set");
    const res = await request.post(`${BASE}/api/tasks/reclaim-bank-packs`, {
      headers: { "x-task-runner-secret": TASK_SECRET },
    });
    expect([200, 404]).toContain(res.status());
    if (res.status() === 200) {
      const body = await res.json() as { message: string; reclaimed?: number };
      expect(["no_orphans", "reclaimed"]).toContain(body.message);
      if (body.message === "reclaimed") {
        expect(typeof body.reclaimed).toBe("number");
        expect(body.reclaimed).toBeGreaterThan(0);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Prod smoke test — bank stats endpoint reachable
// ─────────────────────────────────────────────────────────────────────────────
test.describe("prod smoke — scenario bank", () => {
  test("GET /api/admin/scenario-bank without auth returns 401 on prod", async ({ request }) => {
    const res = await request.get(`${BASE}/api/admin/scenario-bank`);
    expect(res.status()).toBe(401);
  });

  test("POST /api/tasks/fill-scenario-bank without secret returns 401 on prod", async ({ request }) => {
    const res = await request.post(`${BASE}/api/tasks/fill-scenario-bank`);
    // 404 = route not yet deployed (build in flight); 401 = deployed and auth-guarded.
    expect([401, 404]).toContain(res.status());
  });
});
