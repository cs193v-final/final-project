import { expect, test } from "@playwright/test";

// The log-in and sign-up forms (#53) in a real browser. These checks are
// answered before the server touches the database, so they run without one.
// Creating an account and logging in end to end needs a database; that's the
// full-flow spec (#61).

test("sign-up refuses an email address as a username and keeps what was typed", async ({ page }) => {
  await page.goto("/register");
  await expect(page.getByRole("heading", { name: "Create an account" })).toBeVisible();

  await page.getByLabel("Username").fill("someone@example.com");
  await page.getByLabel("Password").fill("long enough password");
  await page.getByRole("button", { name: "Create account" }).click();

  const username = page.getByLabel("Username");
  await expect(username).toHaveAttribute("aria-invalid", "true");
  await expect(username).toHaveAccessibleDescription(/not an email address/i);
  await expect(username).toHaveValue("someone@example.com");
  // The password is never sent back to the page.
  await expect(page.getByLabel("Password")).toHaveValue("");
});

test("sign-up explains a short password", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("Username").fill("tester");
  await page.getByLabel("Password").fill("short");
  await page.getByRole("button", { name: "Create account" }).click();
  const password = page.getByLabel("Password");
  await expect(password).toHaveAttribute("aria-invalid", "true");
  await expect(password).toHaveAccessibleDescription(/passwords need at least 8 characters/i);
});

test("log-in asks for both fields, and links to sign-up and back to start", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByLabel("Username")).toHaveAccessibleDescription("Enter your username.");
  await expect(page.getByLabel("Password")).toHaveAccessibleDescription("Enter your password.");

  await page.getByRole("link", { name: "Create an account" }).click();
  await expect(page).toHaveURL(/\/register$/);
  await page.getByRole("link", { name: "← Back to start" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("the header offers Log in on every screen when nobody is logged in", async ({ page }) => {
  for (const path of ["/", "/play", "/register"]) {
    await page.goto(path);
    const site = page.getByRole("navigation", { name: "Site" });
    await expect(site.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
    await expect(site.getByRole("button", { name: "Log out" })).toHaveCount(0);
  }
});

// A session cookie that matches no session (expired, logged out elsewhere, or
// the database can't be reached, as in CI): every page still works, and the
// header offers Log in.
test("a stale session cookie still shows the pages, with Log in in the header", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "zo_session", value: "not-a-real-session", url: baseURL! }]);
  for (const path of ["/", "/play"]) {
    await page.goto(path);
    const site = page.getByRole("navigation", { name: "Site" });
    await expect(site.getByRole("link", { name: "Log in" })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Zoom out" })).toBeVisible();
});
