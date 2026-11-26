import { defineConfig, devices } from "@playwright/test";

// Smoke test of a deployed site (#223): `BASE_URL=<url> npm run test:smoke`.
// No dev server: it only visits the site at BASE_URL, on a desktop and a phone.
// Read-only unless SMOKE_WRITE=1 (see e2e/smoke/production.spec.ts).
const baseURL = process.env.BASE_URL;
if (!baseURL) throw new Error("Set BASE_URL to the site to smoke test, e.g. BASE_URL=https://example.vercel.app npm run test:smoke");

// A preview behind Vercel Deployment Protection takes the project's automation
// bypass secret. It comes from the shell only, never a file. Playwright prints
// this header in the error of a request that fails on the network (and keeps it
// in error-context.md and the trace under test-results/), so set it on the
// command line for a preview run only, don't export it, and never paste the
// output or traces of a run that used it (e.g. into #223).
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

export default defineConfig({
  testDir: "./e2e/smoke",
  forbidOnly: !!process.env.CI,
  // A deployed site is reached over the network: allow one retry for a blip.
  retries: 1,
  reporter: "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    extraHTTPHeaders: bypass ? { "x-vercel-protection-bypass": bypass } : undefined,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
});
