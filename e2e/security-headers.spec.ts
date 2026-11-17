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

for (const path of ["/", "/play"]) {
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
  // In dev the policy also allows eval; either way it's the one from security-headers.ts.
  expect([contentSecurityPolicy(false), contentSecurityPolicy(true)]).toContain(csp);

  await page.getByRole("link", { name: "Start practice" }).click();
  await expect(page.getByText(/^Image 1 of \d+$/)).toBeVisible({ timeout: 10_000 });
  // A Server Action (a move) and the level images it loads.
  await page.getByRole("button", { name: "Skip this image" }).click();
  await expect(page.getByRole("button", { name: /^(Next image|See results)$/ })).toBeVisible();
  await expect(page.getByRole("img").first()).toBeVisible();
  expect(violations).toEqual([]);
});
