import { defineConfig, devices } from "@playwright/test";

// End-to-end tests (#44): play the real app in a headless browser.
// Run with `npm run test:e2e`. Vitest ignores the `e2e/` folder.
const PORT = 3100;
const CI = !!process.env.CI;

export default defineConfig({
  testDir: "./e2e",
  // Removes the daily spec's test data once every project has finished.
  globalTeardown: "./e2e/global-teardown.ts",
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    // CI tests the production build (`npm run build` runs first); locally the
    // dev server is quicker to start and picks up edits.
    command: CI ? `npm run start -- -H 127.0.0.1 -p ${PORT}` : `npm run dev -- -H 127.0.0.1 -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !CI,
    timeout: 120_000,
  },
});
