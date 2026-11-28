import { expect, test } from "@playwright/test";
import { siteNav } from "./helpers";

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
  await expect(username).toHaveAccessibleDescription(/pick a username, not an email address/i);
  await expect(username).toHaveValue("someone@example.com");
  // The password is never sent back to the page.
  await expect(page.getByLabel("Password")).toHaveValue("");
});

test("sign-up says up front that usernames have no spaces, and explains a full name (#133)", async ({ page }) => {
  await page.goto("/register");
  const username = page.getByLabel("Username");
  await expect(username).toHaveAccessibleDescription(/no spaces/i);

  await username.fill("Jane Doe");
  await page.getByLabel("Password").fill("long enough password");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(username).toHaveAttribute("aria-invalid", "true");
  await expect(username).toHaveAccessibleDescription(/can't contain spaces/i);
  // The error is added to the hint, not shown instead of it.
  await expect(username).toHaveAccessibleDescription(/with no spaces/i);
  await expect(username).toHaveValue("Jane Doe");
});

test("log-in says usernames have no spaces, instead of a wrong password (#133)", async ({ page }) => {
  await page.goto("/login");
  const username = page.getByLabel("Username");
  await username.fill("Jane Doe");
  await page.getByLabel("Password").fill("some password");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(username).toHaveAttribute("aria-invalid", "true");
  await expect(username).toHaveAccessibleDescription(/usernames don't have spaces/i);
  await expect(page.getByText(/don't match/)).toHaveCount(0);
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

test("log-in asks for both fields, and links to sign-up and back home", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByLabel("Username")).toHaveAccessibleDescription("Enter your username.");
  await expect(page.getByLabel("Password")).toHaveAccessibleDescription("Enter your password.");

  await page.getByRole("link", { name: "Create an account" }).click();
  await expect(page).toHaveURL(/\/register$/);
  // "Home", like /daily and /leaderboard; `exact`, or it would also match the header's "<name> home".
  await page.getByRole("navigation", { name: "Back" }).getByRole("link", { name: "Home", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("the header offers Log in on every screen when nobody is logged in, coming back to the page after (#134)", async ({ page }) => {
  for (const [path, href] of [
    ["/", /^\/login$/],
    // /play puts the game's id in the URL, so logging in comes back to that game.
    ["/play", /^\/login\?next=%2Fplay%3Fgame%3D/],
    ["/register", /^\/login$/],
  ] as const) {
    await page.goto(path);
    const site = siteNav(page);
    await expect(site.getByRole("link", { name: "Log in" })).toHaveAttribute("href", href);
    await expect(site.getByRole("button", { name: "Log out" })).toHaveCount(0);
  }
});

test("the account page sends a logged-out visitor to log in, and back (#134)", async ({ page }) => {
  await page.goto("/account");
  await expect(page).toHaveURL(/\/login\?next=%2Faccount$/);
  await page.getByRole("link", { name: "Create an account" }).click();
  await expect(page).toHaveURL(/\/register\?next=%2Faccount$/);
});

// A session cookie that matches no session (expired, logged out elsewhere, or
// the database can't be reached, as in CI): every page still works, and the
// header offers Log in.
test("a stale session cookie still shows the pages, with Log in in the header", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "zo_session", value: "not-a-real-session", url: baseURL! }]);
  for (const path of ["/", "/play"]) {
    await page.goto(path);
    const site = siteNav(page);
    await expect(site.getByRole("link", { name: "Log in" })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Zoom out" })).toBeVisible();
});

// The full flow needs a database (CI has one; locally, set DATABASE_URL for
// this process too). Each run signs up a fresh username.
test.describe("with a database", () => {
  test.skip(!process.env.DATABASE_URL, "needs DATABASE_URL and a migrated database");

  const freshUsername = () => `e2e_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const password = "e2e test password";

  test("sign-up goes home and says who you're logged in as, once (#132, #134)", async ({ page }) => {
    const username = freshUsername();
    await page.goto("/register");
    await page.getByLabel("Username").fill(username);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByRole("status").filter({ hasText: "Logged in" })).toHaveText(
      `Account created. Logged in as ${username}.`,
    );
    // The one-time flag is gone from the URL, so a reload doesn't repeat it.
    await expect(page).toHaveURL(/\/$/);
    const site = page.getByRole("navigation", { name: "Site" });
    await expect(site.getByRole("link", { name: username })).toBeVisible();
    await page.reload();
    await expect(site.getByRole("link", { name: username })).toBeVisible();
    await expect(page.getByText(/Logged in as/)).toHaveCount(0);
  });

  test("logging in from the account page comes back to it (#134)", async ({ page }) => {
    const username = freshUsername();
    await page.goto("/register");
    await page.getByLabel("Username").fill(username);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("navigation", { name: "Site" }).getByRole("link", { name: username })).toBeVisible();
    await page.getByRole("navigation", { name: "Site" }).getByRole("button", { name: "Log out" }).click();
    await expect(page.getByRole("navigation", { name: "Site" }).getByRole("link", { name: "Log in" })).toBeVisible();

    await page.goto("/account");
    await expect(page).toHaveURL(/\/login\?next=%2Faccount$/);
    await page.getByLabel("Username").fill(username);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Log in" }).click();

    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByRole("heading", { name: "Your account", exact: true })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Logged in" })).toHaveText(`Logged in as ${username}.`);
  });

  test("the one-time ?welcome= flag doesn't come back on the next router update (#134)", async ({ page }) => {
    const username = freshUsername();
    await page.goto("/register");
    await page.getByLabel("Username").fill(username);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    const site = page.getByRole("navigation", { name: "Site" });
    await expect(site.getByRole("link", { name: username })).toBeVisible();
    await site.getByRole("button", { name: "Log out" }).click();
    await expect(site.getByRole("link", { name: "Log in" })).toBeVisible();

    // /account, not /play: the game rewrites the URL itself (`?game=`), which
    // would hide the bug.
    await page.goto("/login?next=%2Faccount");
    await page.getByLabel("Username").fill(username);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Logged in" })).toHaveText(`Logged in as ${username}.`);
    await expect(page).toHaveURL(/\/account$/);

    // A router update (here router.refresh(); a Server Action that revalidates
    // does the same) makes Next write its own idea of the URL back. If Next
    // never learned the flag was removed, `?welcome=` comes back here.
    const refreshed = page.waitForResponse((response) => response.request().headers()["rsc"] === "1");
    await page.evaluate(() => (window as unknown as { next: { router: { refresh(): void } } }).next.router.refresh());
    await refreshed;
    await page.waitForLoadState("networkidle");
    expect(new URL(page.url()).searchParams.has("welcome")).toBe(false);
    await page.reload();
    await expect(site.getByRole("link", { name: username })).toBeVisible();
    await expect(page.getByText(/Logged in as/)).toHaveCount(0);
  });
});
