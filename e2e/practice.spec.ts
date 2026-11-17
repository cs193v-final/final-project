import { expect, test, type Page } from "@playwright/test";
import { parsePuzzles } from "@/game/puzzles";
import { SCORING_CONFIG } from "@/game/scoring-config";
import { pointsIfCorrect } from "@/game/scoring";
// The same data as SAMPLE_PUZZLES (`@/puzzles`). Playwright runs specs as
// native ES modules, which need the JSON import attribute that Next adds for us.
import sample from "@/puzzles/sample.json" with { type: "json" };

// The whole practice game in a real browser (#44): start screen → /play →
// wrong guess, zoom out, correct guess, skip → final score → Play again.
// Answers and points come from the puzzle data and SCORING_CONFIG, so tuning
// values or swapping puzzles doesn't need a test change.

const puzzles = parsePuzzles(sample);
const count = puzzles.length;

function puzzleAt(i: number) {
  const p = puzzles[i];
  if (!p) throw new Error(`The practice game needs at least ${i + 1} puzzles`);
  return p;
}

const guessBox = (page: Page) => page.getByRole("textbox", { name: "What is it?" });
const status = (page: Page) => page.getByRole("status");
const score = (page: Page) => page.getByText(/^Score \d+$/);

async function guess(page: Page, text: string) {
  await guessBox(page).fill(text);
  await page.getByRole("button", { name: "Guess", exact: true }).click();
}

test("plays the practice game from the start screen to the final score and again", async ({ page }) => {
  test.skip(count < 3, "the flow below uses three images");

  // Start screen.
  await page.goto("/");
  await page.getByRole("link", { name: "Start practice" }).click();
  await expect(page).toHaveURL(/\/play$/);
  await expect(page.getByText(`Image 1 of ${count}`)).toBeVisible();
  await expect(score(page)).toHaveText("Score 0");
  await expect(page.getByText(`Worth ${SCORING_CONFIG.basePoints} points now`)).toBeVisible();

  // Image 1: a wrong guess, one zoom-out, then the right answer.
  const first = puzzleAt(0);
  await guess(page, "definitely not the answer");
  await expect(status(page)).toContainText("isn't it (1 wrong guess)");
  await page.getByRole("button", { name: "Zoom out" }).click();
  const firstPoints = pointsIfCorrect(1, 1);
  await expect(page.getByText(`Worth ${firstPoints} points now`)).toBeVisible();
  // Case and extra spaces don't matter.
  await guess(page, `  ${first.answer.toUpperCase()} `);
  await expect(status(page)).toHaveText(`Correct! It's ${first.answer}.`);
  await expect(page.getByText(`+${firstPoints} points for this image`)).toBeVisible();
  await expect(score(page)).toHaveText(`Score ${firstPoints}`);
  // The image credit only appears once the round is over.
  await expect(page.getByText(/^Photo:/)).toBeVisible();
  await page.getByRole("button", { name: "Next image" }).click();

  // Image 2: skip it.
  const second = puzzleAt(1);
  await expect(page.getByText(`Image 2 of ${count}`)).toBeVisible();
  await expect(page.getByText(/^Photo:/)).toBeHidden();
  await page.getByRole("button", { name: "Skip this image" }).click();
  await expect(status(page)).toHaveText(`Skipped. It was ${second.answer}.`);
  await expect(score(page)).toHaveText(`Score ${firstPoints}`);
  await page.getByRole("button", { name: count === 2 ? "See results" : "Next image" }).click();

  // The remaining images: guess right away, using an alternate answer if there is one.
  let total = firstPoints;
  for (let i = 2; i < count; i++) {
    const p = puzzleAt(i);
    await expect(page.getByText(`Image ${i + 1} of ${count}`)).toBeVisible();
    await guess(page, p.acceptedAnswers[0] ?? p.answer);
    await expect(status(page)).toContainText(`Correct! It's ${p.answer}`);
    total += pointsIfCorrect(0, 0);
    await expect(score(page)).toHaveText(`Score ${total}`);
    await page.getByRole("button", { name: i === count - 1 ? "See results" : "Next image" }).click();
  }

  // Final score screen.
  await expect(page.getByRole("heading", { name: "Practice complete" })).toBeFocused();
  await expect(page.getByText(/^You scored/)).toHaveText(
    `You scored ${total} out of ${SCORING_CONFIG.basePoints * count}`,
  );
  const rows = page.getByRole("listitem");
  await expect(rows).toHaveCount(count);
  await expect(rows.nth(0)).toContainText(`1. ${first.answer} ✓ correct`);
  await expect(rows.nth(0)).toContainText("1 zoom-out, 1 wrong guess");
  await expect(rows.nth(1)).toContainText(`2. ${second.answer} skipped`);

  // Play again starts over from image 1 with no points.
  await page.getByRole("button", { name: "Play again" }).click();
  await expect(page.getByText(`Image 1 of ${count}`)).toBeVisible();
  await expect(score(page)).toHaveText("Score 0");
  await expect(guessBox(page)).toBeVisible();
});

test("Zoom out stops at the full image", async ({ page }) => {
  const first = puzzleAt(0);
  const steps = first.reveal.zoomLevels.length - 1;

  await page.goto("/play");
  const zoom = page.getByRole("button", { name: "Zoom out" });
  for (let i = 0; i < steps; i++) await zoom.click();
  await expect(zoom).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByText("Showing the full image")).toBeVisible();
  await expect(page.getByText(`Worth ${pointsIfCorrect(steps, 0)} points now`)).toBeVisible();

  // Pressing it again from the keyboard does nothing, and focus stays on it
  // (why it's aria-disabled rather than disabled).
  await zoom.press("Enter");
  await expect(zoom).toBeFocused();
  await expect(page.getByText(`Worth ${pointsIfCorrect(steps, 0)} points now`)).toBeVisible();
});
