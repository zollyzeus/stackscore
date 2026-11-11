/**
 * Real E2E tests — no API mocking.
 * Calls live /api/session, /api/stakeholder-chat, etc.
 * Requires the dev server and all env vars (ANTHROPIC_API_KEY, Firebase, Vertex AI).
 */
import { test, expect } from "@playwright/test";
import path from "path";

import * as fs from "fs";

/**
 * live AI tests are opt-in: they spend real Gemini/Claude budget, write live Firestore
 * documents, and require a candidate session (B2C session creation is authenticated).
 *   RUN_LIVE_AI=1 npx playwright test tests/assessment-real.spec.ts
 */
test.skip(!process.env.RUN_LIVE_AI, "set RUN_LIVE_AI=1 to run live AI tests");

// B2C assessment requires an authenticated candidate.
const CAND_STATE = path.join(__dirname, ".auth-state-cand.json");
test.use({
  storageState: fs.existsSync(CAND_STATE) ? CAND_STATE : undefined,
});

const AUTH_STATE = path.join(__dirname, ".auth-state.json");

// Generous timeout — real AI calls can take 10-20s
test.setTimeout(60_000);

// ── B2C: direct user (random cell) ─────────────────────────────────────────

test.describe("B2C real — random problem selection with live AI", () => {
  test("start screen loads", async ({ page }) => {
    await page.goto("/assessment");
    await expect(page.getByRole("heading", { name: "StackScore Assessment" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start assessment" })).toBeEnabled();
  });

  test("clicking Start calls /api/session and shows Clarify stage with real brief", async ({ page }) => {
    // Listen for the real API response
    const sessionResponse = page.waitForResponse("**/api/session", { timeout: 30_000 });

    await page.goto("/assessment");
    await page.getByRole("button", { name: "Start assessment" }).click();

    const response = await sessionResponse;
    expect(response.status()).toBe(200);

    const body = await response.json();
    console.log("Session response:", JSON.stringify(body, null, 2));

    expect(body.sessionId).toBeTruthy();
    expect(body.brief).toBeTruthy();
    expect(body.cell).toBeTruthy();

    // Clarify stage heading should appear
    await expect(page.getByRole("heading", { name: /Stage 1.*Clarify/i })).toBeVisible({ timeout: 15_000 });

    // Brief appears in the chat window
    await expect(page.locator(".chat-window")).toContainText(body.brief.slice(0, 40), { timeout: 15_000 });
  });

  test("candidate sends a clarifying question and gets real stakeholder reply", async ({ page }) => {
    await page.goto("/assessment");
    await page.getByRole("button", { name: "Start assessment" }).click();

    // Wait for Clarify stage
    await expect(page.getByRole("heading", { name: /Clarify/i })).toBeVisible({ timeout: 30_000 });

    // Send a question
    const input = page.getByPlaceholder("Ask a clarifying question…");
    await input.fill("What is the expected scale of the system in terms of users per day?");
    await page.getByRole("button", { name: "Send" }).click();

    // Candidate message appears immediately
    await expect(page.locator(".chat-turn.candidate").last()).toContainText("expected scale", { timeout: 5_000 });

    // Stakeholder reply comes from real AI
    const chatTurnCount = await page.locator(".chat-turn.stakeholder").count();
    await expect(page.locator(".chat-turn.stakeholder")).toHaveCount(chatTurnCount + 1, { timeout: 30_000 });
  });

  test("'I have enough context' advances to Propose stage", async ({ page }) => {
    await page.goto("/assessment");
    await page.getByRole("button", { name: "Start assessment" }).click();

    await expect(page.getByRole("heading", { name: /Clarify/i })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: /I have enough context/i }).click();

    await expect(page.getByRole("heading", { name: /Stage 2.*Propose/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByPlaceholder(/My proposed architecture/i)).toBeVisible();
  });
});

// ── B2B: panelist flow ──────────────────────────────────────────────────────

test.describe("B2B real — panelist selects cell, session created with live AI", () => {
  test.use({ storageState: AUTH_STATE });

  test("panel page loads and matrix is visible", async ({ page }) => {
    await page.goto("/panel");
    await expect(page.getByRole("heading", { name: /Panelist/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Generate assessment link/i })).toBeDisabled();
  });

  test("panelist selects cell, generates link, and brief is stored", async ({ page }) => {
    await page.goto("/panel");

    // Select R2×C1
    await page.getByTitle("User-Facing Workflow × Scale & Performance").click();
    await expect(page.getByRole("button", { name: /Generate assessment link/i })).toBeEnabled();

    // Capture API call
    const sessionResponse = page.waitForResponse("**/api/session", { timeout: 30_000 });
    await page.getByRole("button", { name: /Generate assessment link/i }).click();

    const response = await sessionResponse;
    expect(response.status()).toBe(200);

    const body = await response.json();
    console.log("B2B session response:", JSON.stringify(body, null, 2));

    expect(body.sessionId).toBeTruthy();

    // Shareable link appears on the page (new panel: URL in .link-url span + Preview link)
    const urlSpan = page.locator(".link-url");
    await expect(urlSpan).toBeVisible({ timeout: 10_000 });
    await expect(urlSpan).toContainText(body.sessionId);
  });
});
