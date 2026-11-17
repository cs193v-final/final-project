import { expect, test, type Page } from "@playwright/test";

import { contentSecurityPolicy } from "@/server/security-headers";

// Security headers in the real app (#105): every page sends them, and the
// Content-Security-Policy doesn't block anything the app itself needs
// (scripts, fonts, styles, level images, Server Actions).

/** Collects the browser's CSP violation reports for a page. */
function cspViolations(page: Page): string[] {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
  });
  return violations;
}

for (const path of ["/", "/play", "/login"]) {
  test(`${path} sends the security headers and no X-Powered-By`, async ({ request }) => {
    const response = await request.get(path);
    const headers = response.headers();
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["strict-transport-security"]).toMatch(/^max-age=\d+/);
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-powered-by"]).toBeUndefined();
  });
}

test("the policy blocks nothing while playing a practice game", async ({ page }) => {
  const violations = cspViolations(page);
  const response = await page.goto("/");
  const csp = response?.headers()["content-security-policy"] ?? "";
  // CI runs the production build, which must never allow eval; locally the
  // dev server does (playwright.config.ts).
  expect(csp).toBe(contentSecurityPolicy(!process.env.CI));

  await page.getByRole("link", { name: "Start practice" }).click();
  await expect(page.getByText(/^Image 1 of \d+$/)).toBeVisible({ timeout: 10_000 });
  // A Server Action (a move) and the level images it loads.
  await page.getByRole("button", { name: "Skip this image" }).click();
  await expect(page.getByRole("button", { name: /^(Next image|See results)$/ })).toBeVisible();
  // Wait for the level image to actually load: a blocked image only shows up
  // as a violation after the <img> is already in the page.
  const image = page.getByRole("img", { name: /^Mystery image/ });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  expect(violations).toEqual([]);
});
