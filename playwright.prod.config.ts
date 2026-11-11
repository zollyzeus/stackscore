import { defineConfig, devices } from "@playwright/test";
import path from "path";

const AUTH_STATE = path.join(__dirname, "tests/.auth-state.json");

export default defineConfig({
  testDir: "./tests",
  timeout: 45_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 1,
  reporter: "list",
  globalSetup: "./tests/auth-setup.ts",
  use: {
    baseURL: "https://stackscore-u3cmakw2zq-uc.a.run.app",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // Don't mock API routes against prod — only structural/UI assertions apply
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium-auth",
      use: { ...devices["Desktop Chrome"], storageState: AUTH_STATE },
    },
  ],
  // No webServer — prod is already running
});
