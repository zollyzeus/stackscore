import { defineConfig, devices } from "@playwright/test";
import path from "path";

const AUTH_STATE = path.join(__dirname, "tests/.auth-state.json");

export default defineConfig({
  testDir: "./tests",
  testMatch: "demo-capture.spec.ts",
  timeout: 300_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  globalSetup: "./tests/auth-setup.ts",
  use: {
    baseURL: "https://stackscore-u3cmakw2zq-uc.a.run.app",
    viewport: { width: 1280, height: 800 },
    // Record full video of the test
    video: { mode: "on", size: { width: 1280, height: 800 } },
    // Slow down actions so transitions are readable
    launchOptions: { slowMo: 120 },
    storageState: AUTH_STATE,
  },
  projects: [
    {
      name: "demo",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  outputDir: "test-results/demo-video",
});
