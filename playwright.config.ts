import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  fullyParallel: false,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    trace: "on-first-retry"
  },
  webServer: {
    command: "npm run dev:all",
    url: "http://localhost:3101",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } }
  ]
});
