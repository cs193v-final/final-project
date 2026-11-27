import { expect, test } from "@playwright/test";
// The same data as SAMPLE_PUZZLES; see practice.spec.ts for why it's a JSON import.
import sample from "@/puzzles/sample.json" with { type: "json" };

// The photo credits page (#239) in a real browser: reachable from home, and it
// credits every practice photo. (CI seeds only the practice pack, so no daily
// is listed; which dailies may be listed is tested in src/db/credits.test.ts.)

test("the home screen links to the photo credits, which credit every practice photo", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Photo credits" }).click();
  await expect(page).toHaveURL(/\/credits$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Photo credits");

  const practice = page.getByRole("region", { name: "Practice" });
  await expect(practice.getByRole("listitem")).toHaveCount(sample.length);
  for (const puzzle of sample) {
    await expect(practice.getByText(puzzle.credit.source, { exact: true })).toBeVisible();
  }
  // Practice answers stay off the page (credits name the photographer, not the subject).
  for (const puzzle of sample) await expect(page.getByText(puzzle.answer, { exact: true })).toHaveCount(0);
});
