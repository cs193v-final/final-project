// What sign-up and login do after a submit (#132, #134), with the auth logic,
// cookies and request headers stubbed.
import { DrizzleQueryError } from "drizzle-orm/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { loginAction, registerAction } from "./actions";

const { redirect, setSessionCookie, discardSession, login, register } = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  }),
  setSessionCookie: vi.fn<(token: string, expiresAt: Date) => Promise<void>>(async () => {}),
  discardSession: vi.fn<(token: string) => Promise<void>>(async () => {}),
  login: vi.fn(),
  register: vi.fn(),
}));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ getDb: () => ({}) }));
// Only the parts that need a request are stubbed; the log line comes from the
// real errorSummary (#162), which keeps query parameters out of the log.
vi.mock("@/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/auth/session")>()),
  setSessionCookie,
  discardSession,
  endSession: vi.fn(async () => {}),
  requestIp: async () => "203.0.113.7",
}));
vi.mock("@/auth/accounts", () => ({ login, register }));

const form = (username: string, password: string, next?: string) => {
  const data = new FormData();
  data.set("username", username);
  data.set("password", password);
  if (next !== undefined) data.set("next", next);
  return data;
};
const OK = {
  ok: true,
  user: { id: "u1", username: "ethan" },
  session: { token: "t", expiresAt: new Date("2026-12-17T00:00:00Z") },
};
const ACTIONS = [
  ["login", loginAction, login, "login"],
  ["sign-up", registerAction, register, "signup"],
] as const;

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  redirect.mockClear();
  setSessionCookie.mockReset();
  setSessionCookie.mockImplementation(async () => {});
  discardSession.mockClear();
  // A failed test can leave a mockResolvedValueOnce unused; don't let it leak.
  login.mockReset();
  register.mockReset();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  return () => consoleError.mockRestore();
});

describe("after a successful sign-up or login", () => {
  it.each(ACTIONS)("%s sets the session cookie and goes to the home screen (#132)", async (_name, action, run, welcome) => {
    run.mockResolvedValueOnce(OK);
    await expect(action(undefined, form("ethan", "correct horse"))).rejects.toThrow("NEXT_REDIRECT");
    expect(setSessionCookie).toHaveBeenCalledWith("t", OK.session.expiresAt);
    expect(redirect).toHaveBeenCalledWith(`/?welcome=${welcome}`);
  });

  it.each(ACTIONS)("%s goes back to a page on this site from ?next= (#134)", async (_name, action, run, welcome) => {
    run.mockResolvedValueOnce(OK);
    await expect(action(undefined, form("ethan", "correct horse", "/play?game=abc"))).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith(`/play?game=abc&welcome=${welcome}`);
  });

  it.each(["//evil.com", "/\\evil.com", "https://evil.com", "javascript:alert(1)"])(
    "goes home instead of another site's address in next: %j",
    async (next) => {
      login.mockResolvedValueOnce(OK);
      await expect(loginAction(undefined, form("ethan", "correct horse", next))).rejects.toThrow("NEXT_REDIRECT");
      expect(redirect).toHaveBeenCalledWith("/?welcome=login");
    },
  );
});

describe("after a failed sign-up or login", () => {
  it("stays on the form, keeps the username, and never echoes the password", async () => {
    login.mockResolvedValueOnce({ ok: false, reason: "wrong-credentials", message: "That username and password don't match." });
    const state = await loginAction(undefined, form("ethan", "wrong password"));
    expect(state).toEqual({ username: "ethan", errors: {}, message: "That username and password don't match." });
    expect(JSON.stringify(state)).not.toContain("wrong password");
    expect(redirect).not.toHaveBeenCalled();
    expect(setSessionCookie).not.toHaveBeenCalled();
  });

  it.each([
    [
      "invalid",
      { ok: false, reason: "invalid", errors: { username: "Usernames are 3 to 20 characters long." } },
      { username: "et", errors: { username: "Usernames are 3 to 20 characters long." } },
    ],
    [
      "taken",
      { ok: false, reason: "taken", errors: { username: "That username is taken." } },
      { username: "et", errors: { username: "That username is taken." } },
    ],
    [
      "rate-limited",
      { ok: false, reason: "rate-limited", message: "Too many attempts. Wait a few minutes and try again." },
      { username: "et", errors: {}, message: "Too many attempts. Wait a few minutes and try again." },
    ],
  ])("sign-up %s: shows why, keeps the username, and stays on the form", async (_reason, result, expected) => {
    register.mockResolvedValueOnce(result);
    const state = await registerAction(undefined, form("et", "secret password"));
    expect(state).toEqual(expected);
    expect(JSON.stringify(state)).not.toContain("secret password");
    expect(redirect).not.toHaveBeenCalled();
    expect(setSessionCookie).not.toHaveBeenCalled();
  });
});

describe("if the database fails", () => {
  // A failed query, as drizzle throws it: its message includes the
  // parameters (username, password hash), so only names and codes may reach
  // the log (errorSummary, #162).
  const queryError = () =>
    new DrizzleQueryError(
      'insert into "users" ("username", "password_hash") values ($1, $2)',
      ["ethan", "$argon2id$secret-hash"],
      Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" }),
    );

  it.each(ACTIONS)("%s shows a short message, not an error page, and logs no values", async (_name, action, run) => {
    run.mockRejectedValueOnce(queryError());
    const state = await action(undefined, form("ethan", "x"));
    expect(state).toEqual({ username: "ethan", errors: {}, message: expect.stringMatching(/something went wrong/i) });
    expect(redirect).not.toHaveBeenCalled();
    const logged = consoleError.mock.calls.flat().map(String).join("\n");
    expect(logged).toContain("Failed query; caused by Error (ECONNREFUSED)");
    expect(logged).not.toContain("secret-hash");
    expect(logged).not.toContain("ethan");
  });

  it("also while setting the session cookie (it ends the earlier session first)", async () => {
    login.mockResolvedValueOnce(OK);
    setSessionCookie.mockRejectedValueOnce(queryError());
    const state = await loginAction(undefined, form("ethan", "correct horse"));
    expect(state?.message).toMatch(/something went wrong/i);
    expect(redirect).not.toHaveBeenCalled();
    const logged = consoleError.mock.calls.flat().map(String).join("\n");
    expect(logged).toContain("Failed query");
    expect(logged).not.toContain("secret-hash");
    // The session was created but never reached the browser.
    expect(discardSession).toHaveBeenCalledWith("t");
  });

  it("after a sign-up, says the account exists instead of 'try again' (which would say 'taken')", async () => {
    register.mockResolvedValueOnce(OK);
    setSessionCookie.mockRejectedValueOnce(queryError());
    const state = await registerAction(undefined, form("ethan", "correct horse"));
    expect(state).toEqual({ username: "ethan", errors: {}, message: expect.stringMatching(/account was created.*please log in/i) });
    expect(redirect).not.toHaveBeenCalled();
    expect(discardSession).toHaveBeenCalledWith("t");
  });
});
