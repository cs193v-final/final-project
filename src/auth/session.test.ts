// The session cookie, the request's address and error logging (#53), with
// stand-ins for next/headers and the database.
import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, { value: string; options?: unknown }>();
let requestHeaders: Record<string, string> = {};

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)!.value } : undefined),
    set: (name: string, value: string, options: unknown) => jar.set(name, { value, options }),
    delete: (name: string) => jar.delete(name),
  }),
  headers: async () => new Headers(requestHeaders),
}));

const deleteSession = vi.fn(async () => {});
vi.mock("@/db", () => ({ getDb: () => ({}) }));
vi.mock("@/db/accounts", () => ({ deleteSession, findSessionUser: vi.fn() }));

const { describeError, requestIp, SESSION_COOKIE, sessionCookieOptions, setSessionCookie } = await import("./session");
const { sha256Hex } = await import("./crypto");

const EXPIRES = new Date("2026-12-17T12:00:00Z");

beforeEach(() => {
  jar.clear();
  requestHeaders = {};
  deleteSession.mockClear();
});

describe("the session cookie", () => {
  it("is HttpOnly, SameSite=Lax, for the whole site, and expires with the session", () => {
    expect(sessionCookieOptions(EXPIRES, "https")).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      expires: EXPIRES,
    });
  });

  it("is Secure over https or when the protocol is unknown, and not over plain http (like the owner cookie)", () => {
    expect(sessionCookieOptions(EXPIRES, "https").secure).toBe(true);
    expect(sessionCookieOptions(EXPIRES, null).secure).toBe(true);
    expect(sessionCookieOptions(EXPIRES, "http").secure).toBe(false);
  });

  it("is set with those options for the request's protocol", async () => {
    requestHeaders = { "x-forwarded-proto": "https" };
    await setSessionCookie("new-token", EXPIRES);
    expect(jar.get(SESSION_COOKIE)).toEqual({ value: "new-token", options: sessionCookieOptions(EXPIRES, "https") });
    expect(deleteSession).not.toHaveBeenCalled();
  });

  it("logging in again ends the browser's old session, so it isn't left valid", async () => {
    jar.set(SESSION_COOKIE, { value: "old-token" });
    await setSessionCookie("new-token", EXPIRES);
    expect(deleteSession).toHaveBeenCalledWith({}, sha256Hex("old-token"));
    expect(jar.get(SESSION_COOKIE)?.value).toBe("new-token");
  });
});

describe("requestIp", () => {
  it("prefers Vercel's own header, then the first x-forwarded-for entry, then x-real-ip", async () => {
    requestHeaders = { "x-vercel-forwarded-for": "203.0.113.1", "x-forwarded-for": "198.51.100.1, 10.0.0.1" };
    expect(await requestIp()).toBe("203.0.113.1");
    requestHeaders = { "x-forwarded-for": "198.51.100.1, 10.0.0.1", "x-real-ip": "192.0.2.1" };
    expect(await requestIp()).toBe("198.51.100.1");
    requestHeaders = { "x-real-ip": "192.0.2.1" };
    expect(await requestIp()).toBe("192.0.2.1");
    requestHeaders = {};
    expect(await requestIp()).toBeNull();
  });
});

describe("describeError", () => {
  it("logs only the error's type and code, never its message (which can hold query parameters)", () => {
    const failed = new Error('Failed query: insert into "users" params: ethan,$argon2id$v=19$...', {
      cause: Object.assign(new Error("duplicate key"), { code: "23505" }),
    });
    expect(describeError(failed)).toBe("Error (23505)");
    expect(describeError(new TypeError("secret detail"))).toBe("TypeError");
    expect(describeError("a string")).toBe("string");
  });
});
