import { defineConfig, devices } from "@playwright/test";
import path from "path";

const AUTH_STATE = path.join(__dirname, "tests/.auth-state.json");
const CAND_STATE = path.join(__dirname, "tests/.auth-state-cand.json");
const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000";
// Manage a dev server only when no explicit target was given.
const IS_REMOTE = Boolean(process.env.TEST_BASE_URL);
const IS_HTTPS = /^https:\/\//.test(BASE_URL);

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  // One retry absorbs cold-start flake on Cloud Run without hiding real failures.
  retries: IS_HTTPS ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["json", { outputFile: "test-results/results.json" }]] : "list",
  globalSetup: "./tests/auth-setup.ts",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    ignoreHTTPSErrors: false,
  },
  projects: [
    // Library-level tests — no server, no cookies.
    {
      name: "unit",
      testMatch: /unit\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    // Anonymous / attacker perspective. The audit, lifecycle and security suites assert
    // what an UNAUTHENTICATED caller can reach, so they must only run here — a stored
    // panelist cookie would invalidate every "refuses anonymous" assertion.
    {
      name: "chromium",
      testIgnore: /unit\.spec\.ts|sandbox\.spec\.ts|calibration\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    // Judge calibration. Its own project because it calls the real Anthropic API, costs
    // money per run, and takes minutes per judge call -- it must never be swept up by a
    // normal `npx playwright test`. The spec also self-skips unless RUN_CALIBRATION=1, so
    // the project existing is not enough to bill anything.
    {
      name: "calibration",
      testMatch: /calibration\.spec\.ts/,
      // One judge call at effort high can take minutes; the sweep sets its own timeout.
      timeout: 90 * 60_000,
      retries: 0,
      use: { ...devices["Desktop Chrome"] },
    },
    // Authenticated panelist — dashboard / panel / assessment flows only.
    {
      name: "chromium-auth",
      testIgnore: /unit\.spec\.ts|sandbox\.spec\.ts|calibration\.spec\.ts|audit-regression\.spec\.ts|session-lifecycle\.spec\.ts|security\.spec\.ts|admin\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], storageState: AUTH_STATE },
    },
    // Authenticated candidate — needed by the sandbox suite.
    {
      name: "chromium-candidate",
      testMatch: /sandbox\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], storageState: CAND_STATE },
    },
  ],
  // Only manage a dev server when testing locally.
  ...(IS_REMOTE
    ? {}
    : {
        webServer: {
          command: "npm run dev",
          url: "http://localhost:3000",
          reuseExistingServer: true,
          timeout: 120_000,
        },
      }),
});
