import { expect, test, type Page } from "@playwright/test";
import { MODES } from "@/components/modes";
import { GAME_NAME } from "@/site";

// The home screen and navigation in a real browser (#50): the mode picker,
// and a way home from every screen, by mouse, keyboard and the Back button.
// Modes come from `MODES`, so marking a mode available doesn't need a test change.

const homeLink = (page: Page) =>
  page.getByRole("navigation", { name: "Site" }).getByRole("link", { name: `${GAME_NAME} home` });
const picker = (page: Page) => page.getByRole("region", { name: "Choose a mode" });

async function finishPractice(page: Page) {
  // Skip every image to reach the final score screen.
  for (;;) {
    await page.getByRole("button", { name: "Skip this image" }).click();
    const results = page.getByRole("button", { name: "See results" });
    if (await results.isVisible()) {
      await results.click();
      break;
    }
    await page.getByRole("button", { name: "Next image" }).click();
  }
  await expect(page.getByRole("button", { name: "Play again" })).toBeVisible();
}

test("the home screen lists every mode, and only playable ones are links", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(GAME_NAME);

  const cards = picker(page).getByRole("listitem");
  await expect(cards).toHaveCount(MODES.length);
  for (const [i, mode] of MODES.entries()) {
    const card = cards.nth(i);
    await expect(card.getByRole("heading")).toHaveText(mode.title);
    if (mode.status === "available") {
      await expect(card.getByRole("link", { name: mode.cta })).toHaveAttribute("href", mode.href);
      await expect(card.getByText("Coming soon")).toHaveCount(0);
    } else {
      await expect(card.getByText("Coming soon")).toBeVisible();
      await expect(card.getByRole("link")).toHaveCount(0);
    }
  }
});

test("the header links home from the game and the final score screen", async ({ page }) => {
  await page.goto("/");
  await expect(homeLink(page)).toHaveAttribute("aria-current", "page");

  await picker(page).getByRole("link", { name: "Start practice" }).click();
  await expect(page).toHaveURL(/\/play$/);
  await expect(homeLink(page)).not.toHaveAttribute("aria-current", "page");

  // Mid-game: home and back again.
  await homeLink(page).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(GAME_NAME);

  // From the final score screen.
  await page.goto("/play");
  await finishPractice(page);
  await homeLink(page).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(picker(page)).toBeVisible();
});

test("the whole trip works from the keyboard alone", async ({ page }) => {
  await page.goto("/");
  // Tab order: the home link, then the only playable mode. Coming-soon cards are skipped.
  await page.keyboard.press("Tab");
  await expect(homeLink(page)).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Start practice" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/play$/);

  // The game puts focus in the guess box. Shift+Tab back to the header link.
  await expect(page.getByRole("textbox", { name: "What is it?" })).toBeFocused();
  for (let i = 0; i < 10 && !(await homeLink(page).evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press("Shift+Tab");
  }
  await expect(homeLink(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/$/);
});

test("the browser's Back and Forward buttons move between home and the game", async ({ page }) => {
  await page.goto("/");
  await picker(page).getByRole("link", { name: "Start practice" }).click();
  await expect(page).toHaveURL(/\/play$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(picker(page)).toBeVisible();
  await page.goForward();
  await expect(page.getByRole("textbox", { name: "What is it?" })).toBeVisible();
});

test("a page that doesn't exist still has the way home", async ({ page }) => {
  const response = await page.goto("/no-such-page");
  expect(response?.status()).toBe(404);
  await homeLink(page).click();
  await expect(page).toHaveURL(/\/$/);
});

test("nothing scrolls sideways on the home screen or in the game", async ({ page }) => {
  for (const path of ["/", "/play"]) {
    await page.goto(path);
    await expect(page.getByRole("banner")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `horizontal overflow on ${path}`).toBe(0);
  }
});
