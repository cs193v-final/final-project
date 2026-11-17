// Where sign-up and login send you (#132), with the auth logic and cookies stubbed.
import { beforeEach, describe, expect, it, vi } from "vitest";

const redirect = vi.fn((url: string) => {
  throw Object.assign(new Error("NEXT_REDIRECT"), { url });
});
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/db", () => ({ getDb: () => ({}) }));
const setSessionCookie = vi.fn(async () => {});
vi.mock("@/auth/session", () => ({
  setSessionCookie,
  endSession: vi.fn(async () => {}),
  requestIp: async () => "203.0.113.7",
  describeError: (e: unknown) => String(e),
}));
const login = vi.fn();
const register = vi.fn();
vi.mock("@/auth/accounts", () => ({ login, register }));

const { loginAction, registerAction } = await import("./actions");

const form = (username: string, password: string) => {
  const data = new FormData();
  data.set("username", username);
  data.set("password", password);
  return data;
};
const OK = {
  ok: true,
  user: { id: "u1", username: "ethan" },
  session: { token: "t", expiresAt: new Date("2026-12-17T00:00:00Z") },
};

beforeEach(() => {
  redirect.mockClear();
  setSessionCookie.mockClear();
});

describe("after a successful sign-up or login", () => {
  it.each([
    ["login", loginAction, login],
    ["sign-up", registerAction, register],
  ] as const)("%s sets the session cookie and goes to the home screen (#132)", async (_name, action, run) => {
    run.mockResolvedValueOnce(OK);
    await expect(action(undefined, form("ethan", "correct horse"))).rejects.toThrow("NEXT_REDIRECT");
    expect(setSessionCookie).toHaveBeenCalledWith("t", OK.session.expiresAt);
    expect(redirect).toHaveBeenCalledWith("/");
  });
});

describe("after a failed login", () => {
  it("stays on the form, keeps the username, and never echoes the password", async () => {
    login.mockResolvedValueOnce({ ok: false, reason: "wrong-credentials", message: "That username and password don't match." });
    const state = await loginAction(undefined, form("ethan", "wrong password"));
    expect(state).toEqual({ username: "ethan", errors: {}, message: "That username and password don't match." });
    expect(JSON.stringify(state)).not.toContain("wrong password");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("shows a short message, not an error page, if the database fails", async () => {
    login.mockRejectedValueOnce(new Error("connection refused"));
    const state = await loginAction(undefined, form("ethan", "x"));
    expect(state?.message).toMatch(/something went wrong/i);
    expect(redirect).not.toHaveBeenCalled();
  });
});
