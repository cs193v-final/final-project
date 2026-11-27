import { expect, test, type Page } from "@playwright/test";

import { MODES } from "@/components/modes";
import { parsePuzzles } from "@/game/puzzles";
import { contentSecurityPolicy } from "@/server/security-headers";
// The practice pack, as in practice.spec.ts (the JSON import attribute is for Playwright's ES modules).
import sample from "@/puzzles/sample.json" with { type: "json" };

import { cspViolations, expectSecurityHeaders, guess, guessBox, siteNav, waitForAccountLinks } from "../helpers";

// Smoke test of a deployed site (#223, checklist item 4), on a desktop and a
// phone: `BASE_URL=<url> npm run test:smoke` (playwright.smoke.config.ts).
//
// Read-only by default: pages are visited, but nothing that creates a game,
// an account or any other row is clicked. /play and /stanford start a game in
// the browser as soon as they load, so by default they're fetched without a
// browser (the server-rendered page only). SMOKE_WRITE=1 also plays the first
// practice image, opens Stanford in a browser (each starts an anonymous game),
// and signs up a throwaway account with a random username and password, then
// logs out and back in, then deletes it through /account (#251) and checks it
// can't log in anymore. Never daily games, so the leaderboard is untouched.
//
// Not covered, because there's no public way to see it (and we don't add
// one): whether the daily is scheduled for the coming days, and whether Vercel
// actually runs the cron. Check those in the database and the Vercel dashboard.

const WRITE = process.env.SMOKE_WRITE === "1";

const puzzles = parsePuzzles(sample);
const firstPuzzle = puzzles[0];

// Stanford is checked once src/components/modes.ts marks it available (#65).
const stanford = MODES.find((m) => m.id === "stanford");
const stanfordHref = stanford?.status === "available" ? stanford.href : undefined;
const stanfordCta = stanford?.status === "available" ? stanford.cta : undefined;

/** A local server may be the dev server, whose policy also allows eval; a deployed site never does. */
function isLocal(baseURL: string | undefined): boolean {
  const host = baseURL ? new URL(baseURL).hostname : "";
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

/** The page's own alerts (not Next's route announcer, which also has role="alert"). */
const alerts = (page: Page) => page.getByRole("main").getByRole("alert");

test.describe("read-only", () => {
  test("home lists the ways to play and the header links", async ({ page }) => {
    const violations = cspViolations(page);
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    await waitForAccountLinks(page);
    await expect(siteNav(page).getByRole("link", { name: "Leaderboard" })).toBeVisible();
    for (const m of MODES) {
      if (m.status === "available") {
        await expect(page.getByRole("link", { name: m.cta })).toHaveAttribute("href", m.href);
      } else {
        await expect(page.getByText(m.title, { exact: true })).toBeVisible();
      }
    }
    expect(violations).toEqual([]);
  });

  test("practice's page is served", async ({ request }) => {
    const response = await request.get("/play");
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain("Practice");
  });

  test("Stanford's page is served", async ({ request }) => {
    test.skip(!stanfordHref, "Stanford is still 'coming soon' in src/components/modes.ts (#65)");
    const response = await request.get(stanfordHref!);
    expect(response.status()).toBe(200);
    // The page says so when the pack isn't seeded or can't be read (src/app/stanford/page.tsx).
    const html = await response.text();
    expect(html).toContain("Stanford");
    expect(html).not.toContain("Stanford mode is coming soon");
    expect(html).not.toContain("load Stanford mode");
  });

  test("today's daily is scheduled", async ({ page }) => {
    const violations = cspViolations(page);
    const response = await page.goto("/daily");
    expect(response?.status()).toBe(200);
    // A new browser has no game today, so this is the intro: "Today: <theme>".
    await expect(page.getByRole("heading", { name: /^Today: \S/ })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "No daily challenge today" })).toHaveCount(0);
    await expect(alerts(page)).toHaveCount(0);
    expect(violations).toEqual([]);
  });

  test("the leaderboard loads", async ({ page }) => {
    const violations = cspViolations(page);
    const response = await page.goto("/leaderboard");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Leaderboard", level: 1 })).toBeVisible();
    await expect(page.getByText("Loading the leaderboard…")).toHaveCount(0, { timeout: 15_000 });
    await expect(alerts(page)).toHaveCount(0);
    expect(violations).toEqual([]);
  });

  for (const { path, heading, button } of [
    { path: "/login", heading: "Log in", button: "Log in" },
    { path: "/register", heading: "Create an account", button: "Create account" },
  ]) {
    test(`${path} shows its form`, async ({ page }) => {
      const violations = cspViolations(page);
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      const main = page.getByRole("main");
      await expect(main.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
      await expect(main.getByLabel("Username")).toBeVisible();
      await expect(main.getByLabel("Password")).toBeVisible();
      await expect(main.getByRole("button", { name: button, exact: true })).toBeVisible();
      expect(violations).toEqual([]);
    });
  }

  const pages = ["/", "/play", "/daily", "/leaderboard", "/login", "/register", ...(stanfordHref ? [stanfordHref] : [])];
  for (const path of pages) {
    test(`${path} sends the security headers`, async ({ request, baseURL }) => {
      const response = await request.get(path);
      expect(response.status()).toBe(200);
      const headers = response.headers();
      expectSecurityHeaders(headers);
      const allowed = isLocal(baseURL) ? [contentSecurityPolicy(false), contentSecurityPolicy(true)] : [contentSecurityPolicy(false)];
      expect(allowed).toContain(headers["content-security-policy"]);
    });
  }

  test("the cron sweep is deployed and refuses a call without its secret", async ({ request }) => {
    // Refused before the database is touched (src/server/sweep.ts).
    const response = await request.get("/api/cron/sweep");
    expect(response.status()).toBe(401);
  });
});

test.describe("writes (SMOKE_WRITE=1)", () => {
  test.skip(!WRITE, "set SMOKE_WRITE=1 to start games and create a throwaway account");
  // No retry: a retried sign-up would make a second throwaway account on the real site.
  test.describe.configure({ retries: 0 });

  test("practice starts and the first image can be guessed", async ({ page }) => {
    if (!firstPuzzle) throw new Error("The practice pack has no puzzles");
    const violations = cspViolations(page);
    await page.goto("/");
    await page.getByRole("link", { name: "Start practice" }).click();
    await expect(page.getByText(`Image 1 of ${puzzles.length}`)).toBeVisible({ timeout: 15_000 });
    const image = page.getByRole("img", { name: /^Mystery image/ });
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    // The points come from the page's own "Worth N points now", not the default
    // config: production's practice pack may have a stored scoring override (#204).
    const worth = page.getByText(/^Worth \d+ points? now$/);
    await expect(worth).toBeVisible();
    const points = Number((await worth.textContent())?.match(/\d+/)?.[0]);
    expect(points).toBeGreaterThan(0);
    await guess(page, firstPuzzle.answer);
    await expect(page.getByRole("main").getByRole("status")).toContainText(`Correct! It's ${firstPuzzle.answer}.`);
    await expect(page.getByText(/^Score \d+$/)).toHaveText(`Score ${points}`);
    expect(violations).toEqual([]);
  });

  test("Stanford starts a game", async ({ page }) => {
    test.skip(!stanfordCta, "Stanford is still 'coming soon' in src/components/modes.ts (#65)");
    await page.goto("/");
    await page.getByRole("link", { name: stanfordCta! }).click();
    await expect(guessBox(page)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("img", { name: /^Mystery image/ })).toBeVisible();
  });

  test("a throwaway account signs up, logs out and back in, then deletes itself", async ({ page }) => {
    // 3–20 characters of [A-Za-z0-9_-], random so desktop and phone don't collide.
    const username = `smoke-${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 8)}`.slice(0, 20);
    const password = `smoke ${crypto.randomUUID()}`;
    const site = siteNav(page);
    // The test deletes this account at the end. Its username is printed in case
    // a failure stops it before then, so it can be deleted by hand. Not the
    // password: this output may be pasted into a public comment (#223).
    console.log(`[smoke] ${test.info().project.name}: signing up throwaway account "${username}"`);
    test.info().annotations.push({ type: "throwaway account", description: username });

    await page.goto("/register");
    await page.getByLabel("Username").fill(username);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).not.toHaveURL(/\/register$/);
    await expect(site.getByRole("link", { name: username, exact: true })).toBeVisible();

    await site.getByRole("button", { name: "Log out" }).click();
    await expect(site.getByRole("link", { name: "Log in" })).toBeVisible();

    await page.goto("/login");
    await page.getByLabel("Username").fill(username);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("main").getByRole("button", { name: "Log in", exact: true }).click();
    await expect(site.getByRole("link", { name: username, exact: true })).toBeVisible();
    await expect(site.getByRole("button", { name: "Log out" })).toBeVisible();

    // Delete it (#251), so a smoke run leaves no account behind.
    await page.goto("/account");
    const remove = page.getByRole("region", { name: "Delete your account" });
    await remove.getByLabel("Current password").fill(password);
    await remove.getByLabel("Type your username to confirm").fill(username);
    await remove.getByRole("button", { name: "Delete my account" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(site.getByRole("link", { name: "Log in" })).toBeVisible();

    // And it's gone: the same username and password no longer log in.
    await page.goto("/login");
    await page.getByLabel("Username").fill(username);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("main").getByRole("button", { name: "Log in", exact: true }).click();
    await expect(alerts(page)).toHaveText("That username and password don't match.");
    await expect(site.getByRole("link", { name: username, exact: true })).toHaveCount(0);
  });
});
