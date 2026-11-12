/**
 * Demo capture script — records a walkthrough of StackScore for the buildathon demo video.
 * Run with: npx playwright test tests/demo-capture.spec.ts --config=playwright.demo.config.ts
 *
 * Output: test-results/demo-video/ — contains the .webm recording per step.
 * Voiceover script is in DEMO_VOICEOVER.md alongside this file.
 *
 * v2 additions (2026-11-13):
 *   - Scene 6b: 3-stage judge fallback pipeline (judged/partial/pending banners)
 *   - Scene 11b: Scenario bank admin panel (/admin → Scenario Bank card)
 *   - Scene 11c: Reviewer bias-free flow (/review)
 *   - Scene 15b: Calibration reliability evidence (/benchmarks)
 *   - Voiceover updated throughout — see DEMO_VOICEOVER.md
 */
import { test, expect, Page } from "@playwright/test";
import path from "path";

import * as fs from "fs";

/**
 * demo recording tests are opt-in: they spend real Gemini/Claude budget, write live Firestore
 * documents, and require a candidate session (B2C session creation is authenticated).
 *   RUN_LIVE_AI=1 npx playwright test tests/demo-capture.spec.ts
 */
test.skip(!process.env.RUN_LIVE_AI, "set RUN_LIVE_AI=1 to run demo recording tests");

// B2C assessment requires an authenticated candidate.
const CAND_STATE = path.join(__dirname, ".auth-state-cand.json");
test.use({
  storageState: fs.existsSync(CAND_STATE) ? CAND_STATE : undefined,
});

const AUTH_STATE = path.join(__dirname, ".auth-state.json");
const BASE = "https://stackscore-u3cmakw2zq-uc.a.run.app";

// Slow each action so transitions are visible in the recording
const STEP_PAUSE = 3000;   // ms between major sections
const SCROLL_PAUSE = 1500; // ms after a scroll

async function pause(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function smoothScroll(page: Page, y: number) {
  await page.evaluate((target) => window.scrollTo({ top: target, behavior: "smooth" }), y);
  await pause(SCROLL_PAUSE);
}

test.describe("Demo recording", () => {
  test.use({ storageState: AUTH_STATE });

  test("Full product walkthrough", async ({ page }) => {
    // ── SCENE 1: Landing page ────────────────────────────────────────────
    // VO: "Meet StackScore — the first AI-powered assessment platform that scores not just what a candidate codes, but how they think."
    await page.goto(BASE, { waitUntil: "networkidle" });
    await pause(STEP_PAUSE * 2);

    // Scroll to hero
    await smoothScroll(page, 0);
    await pause(STEP_PAUSE);

    // ── SCENE 2: Scroll to axes ──────────────────────────────────────────
    // VO: "Every submission is judged across eleven axes — five design thinking axes and six code quality axes — producing a single holistic StackScore."
    await smoothScroll(page, 600);
    await pause(STEP_PAUSE);
    await smoothScroll(page, 1200);
    await pause(STEP_PAUSE);

    // ── SCENE 3: Score card preview on landing ───────────────────────────
    // VO: "Here's what a real StackScore looks like — a score out of 100, design and code sub-scores, and a radar chart mapping every axis."
    await smoothScroll(page, 1800);
    await pause(STEP_PAUSE * 1.5);

    // ── SCENE 4: Comparison table ────────────────────────────────────────
    // VO: "Unlike HackerRank or LeetCode, StackScore evaluates design thinking, adaptability, and AI collaboration — not just algorithm correctness."
    await smoothScroll(page, 2600);
    await pause(STEP_PAUSE * 1.5);

    // ── SCENE 5: Navigate to /why ────────────────────────────────────────
    // VO: "Let's see why engineering teams choose StackScore."
    await page.goto(`${BASE}/why`, { waitUntil: "networkidle" });
    await pause(STEP_PAUSE);
    await smoothScroll(page, 400);
    await pause(STEP_PAUSE);
    await smoothScroll(page, 1000);
    await pause(STEP_PAUSE);

    // ── SCENE 6: Assessment — start page ────────────────────────────────
    // VO: "Starting an assessment is simple. Choose your experience level — Junior, Mid, or Senior — and hit Start."
    await page.goto(`${BASE}/assessment`, { waitUntil: "networkidle" });
    await pause(STEP_PAUSE);
    // Click Mid level
    await page.click("button.role-btn:has-text('Mid')");
    await pause(800);
    // Fill name
    await page.fill("input[placeholder='Your name (optional)']", "Ravi Shankar");
    await pause(600);
    await page.fill("input[placeholder='Your email (optional)']", "ravi@example.com");
    await pause(STEP_PAUSE);

    // ── SCENE 7: Clarify stage ───────────────────────────────────────────
    // VO: "The assessment generates a fresh engineering problem. Stage one: Clarify — ask the AI stakeholder to scope the problem before you design."
    await page.click("button:has-text('Start assessment')");
    await page.waitForSelector(".chat-window", { timeout: 30_000 });
    await pause(STEP_PAUSE);
    // Show the brief
    await page.waitForSelector(".chat-turn.stakeholder");
    await pause(STEP_PAUSE);
    // Show desktop brief panel
    await expect(page.locator(".brief-side")).toBeVisible();
    await pause(STEP_PAUSE);
    // Type a question
    const chatInput = page.locator("input[placeholder='Ask a clarifying question…']");
    await chatInput.fill("What is the expected scale — how many concurrent users?");
    await pause(600);
    await page.click("button:has-text('Send')");
    await page.waitForFunction(
      () => document.querySelectorAll(".chat-turn").length >= 3,
      { timeout: 30_000 }
    );
    await pause(STEP_PAUSE);

    // ── SCENE 8: Hints toggle ────────────────────────────────────────────
    // VO: "Candidates can toggle contextual hints for each stage."
    await page.click("button.hints-toggle");
    await pause(STEP_PAUSE);
    await expect(page.locator(".hints-panel")).toBeVisible();
    await pause(STEP_PAUSE);
    await page.click("button.hints-toggle");
    await pause(800);

    // ── SCENE 9: Move to Propose ─────────────────────────────────────────
    // VO: "Once satisfied, the candidate locks in their design proposal."
    await page.click("button:has-text('I have enough context')");
    await pause(STEP_PAUSE);
    await page.waitForSelector("h2:has-text('Stage 2')");
    await pause(STEP_PAUSE);

    // Fill design text
    await page.fill(
      "textarea[placeholder*='My proposed architecture']",
      "I would use a Redis cache with write-through invalidation, backed by PostgreSQL for durability. API layer: Node.js with Express. Load balancer handles 10k RPS. Tradeoffs: eventual consistency on reads accepted for throughput."
    );
    await pause(STEP_PAUSE);

    // ── SCENE 10: Build stage overview ───────────────────────────────────
    // VO: "Stage three: Build — write a working implementation. The in-browser runner executes JavaScript live."
    await page.click("button:has-text('Lock in design')");
    await page.waitForSelector("h2:has-text('Stage 3')");
    await pause(STEP_PAUSE);
    await page.fill(
      "textarea.code-editor",
      [
        "const cache = new Map();",
        "",
        "function get(key) {",
        "  if (cache.has(key)) { console.log('cache hit', key); return cache.get(key); }",
        "  const val = db.query(key); // simulate DB read",
        "  cache.set(key, val);",
        "  return val;",
        "}",
        "",
        "function set(key, value) {",
        "  db.write(key, value);",
        "  cache.set(key, value);",
        "}",
        "",
        "console.log('Cache initialized. Testing...');",
        "set('user:1', { name: 'Ravi', role: 'engineer' });",
        "console.log(get('user:1'));",
      ].join("\n")
    );
    await pause(STEP_PAUSE);

    // ── SCENE 11: Mobile brief banner ────────────────────────────────────
    // VO: "On mobile, the brief collapses into a banner that candidates can expand at any time."
    await page.setViewportSize({ width: 390, height: 844 });
    await pause(STEP_PAUSE);
    await expect(page.locator(".brief-banner-mobile")).toBeVisible();
    await page.click(".brief-banner-toggle");
    await pause(STEP_PAUSE);
    await page.click(".brief-banner-toggle");
    await pause(600);
    await page.setViewportSize({ width: 1280, height: 800 });
    await pause(600);

    // ── SCENE 12: Overall timer ───────────────────────────────────────────
    // VO: "A countdown tracks the full 60-minute window. Inactivity is monitored and candidates are prompted to continue or save and quit."
    await expect(page.locator(".overall-timer")).toBeVisible();
    await pause(STEP_PAUSE);

    // ── SCENE 13: Navigate to a sample score card ─────────────────────────
    // VO: "Once submitted, an AI judge with extended reasoning evaluates every axis and generates a verifiable score card."
    await page.goto(`${BASE}/score`, { waitUntil: "networkidle" }).catch(() => {});
    // Try to reach a real score card via the dashboard
    await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
    await pause(STEP_PAUSE);
    // Click first score link if visible
    const firstScoreLink = page.locator("a[href*='/score/']").first();
    if (await firstScoreLink.isVisible()) {
      const href = await firstScoreLink.getAttribute("href");
      if (href) {
        await page.goto(`${BASE}${href}`, { waitUntil: "networkidle" });
        await pause(STEP_PAUSE);
        // ── SCENE 14: Score card ─────────────────────────────────────────
        // VO: "The score card shows the overall StackScore, design and code sub-scores, the radar chart, and per-axis judge feedback with improvement tips."
        await smoothScroll(page, 400);
        await pause(STEP_PAUSE);
        await smoothScroll(page, 900);
        await pause(STEP_PAUSE);
        await smoothScroll(page, 1600);
        await pause(STEP_PAUSE);
        // Share widget
        await smoothScroll(page, 2400);
        await pause(STEP_PAUSE);
      }
    }

    // ── SCENE 13b: Score provenance banners ──────────────────────────────
    // VO: "Every score card carries a provenance banner. Green means fully judged by the calibrated AI. Amber means a fallback judge ran and a re-score is queued. The system never silently fails."
    // (Already on score card page from Scene 14 — scroll to provenance banner)
    await smoothScroll(page, 0);
    await expect(page.locator(".provenance-badge")).toBeVisible().catch(() => {});
    await pause(STEP_PAUSE);

    // ── SCENE 14b: Calibration evidence (/benchmarks) ────────────────────
    // VO: "StackScore's AI judge is verified — not just trusted. The benchmarks page shows rank stability across independent runs, confirmed by a second model."
    await page.goto(`${BASE}/benchmarks`, { waitUntil: "networkidle" });
    await pause(STEP_PAUSE);
    await smoothScroll(page, 400);
    await pause(STEP_PAUSE);
    await smoothScroll(page, 1000);
    await pause(STEP_PAUSE);

    // ── SCENE 15: Dashboard ───────────────────────────────────────────────
    // VO: "Hiring teams get a live dashboard — shortlist, hold, or reject candidates, add notes, and export to CSV."
    await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
    await pause(STEP_PAUSE);
    await smoothScroll(page, 400);
    await pause(STEP_PAUSE);

    // ── SCENE 16: Kanban ─────────────────────────────────────────────────
    // VO: "Or switch to Kanban view for a visual pipeline."
    await page.goto(`${BASE}/dashboard/kanban`, { waitUntil: "networkidle" });
    await pause(STEP_PAUSE);

    // ── SCENE 17: Panel ──────────────────────────────────────────────────
    // VO: "Panelists create custom assessments — their own brief, assigned to a specific candidate, with an expiry window. The assessment is locked to that candidate and expires automatically."
    await page.goto(`${BASE}/panel`, { waitUntil: "networkidle" });
    await pause(STEP_PAUSE);
    await smoothScroll(page, 400);
    await pause(STEP_PAUSE);

    // ── SCENE 17b: Reviewer bias-free flow ───────────────────────────────
    // VO: "Human reviewers see only the submission and rubric — not the AI scores. This eliminates anchoring bias. The reviewer's decision is recorded separately and updates the provenance banner."
    await page.goto(`${BASE}/review`, { waitUntil: "networkidle" });
    await pause(STEP_PAUSE);
    await smoothScroll(page, 400);
    await pause(STEP_PAUSE);

    // ── SCENE 18: My Scores ───────────────────────────────────────────────
    // VO: "Candidates track their own improvement trajectory — multiple attempts, axis-level trends, and a shareable portfolio link."
    await page.goto(`${BASE}/me`, { waitUntil: "networkidle" });
    await pause(STEP_PAUSE);

    // ── SCENE 19: Compare ────────────────────────────────────────────────
    // VO: "Side-by-side radar comparison lets teams see exactly which candidate is stronger on which axis — for fair, defensible hiring decisions."
    await page.goto(`${BASE}/compare`, { waitUntil: "networkidle" });
    await pause(STEP_PAUSE);

    // ── SCENE 20: Reliability at a glance ────────────────────────────────
    // VO: "Under the hood: Gemini generates fresh problems every session. If Gemini is unavailable, a pre-generated scenario bank ensures the assessment always starts. Zero candidate-facing downtime."
    // (Show landing page with the architecture tagline or the why page resilience section)
    await page.goto(`${BASE}/why`, { waitUntil: "networkidle" });
    await pause(STEP_PAUSE);
    await smoothScroll(page, 800);
    await pause(STEP_PAUSE);

    // ── END ───────────────────────────────────────────────────────────────
    // VO: "StackScore — the full picture of an engineer, in one number. Not what they memorised. How they think."
    await page.goto(BASE, { waitUntil: "networkidle" });
    await smoothScroll(page, 0);
    await pause(STEP_PAUSE * 2);
  });
});
