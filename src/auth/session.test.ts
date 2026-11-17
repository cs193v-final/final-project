// The session cookie, the request's address and error logging (#53), with
// stand-ins for next/headers and the database.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("next/server", () => ({ connection: async () => {} }));

const deleteSession = vi.fn<(db: unknown, hash: string) => Promise<void>>(async () => {});
const findSessionUser = vi.fn<(db: unknown, hash: string, now: Date) => Promise<unknown>>(async () => null);
vi.mock("@/db", () => ({ getDb: () => ({}) }));
vi.mock("@/db/accounts", () => ({ deleteSession, findSessionUser }));
// The real sessionUser decrypts the stored username (#84); here the lookup
// itself is what's under test, so it passes the row straight through.
vi.mock("@/crypto/vault", () => ({ getVault: () => ({}) }));
vi.mock("./accounts", () => ({
  sessionUser: (db: unknown, _vault: unknown, hash: string, now: Date) => findSessionUser(db, hash, now),
}));

const { describeError, getCurrentUser, getCurrentUserOrLoggedOut, requestIp, SessionLookupError, SESSION_COOKIE, sessionCookieOptions, setSessionCookie } =
  await import("./session");
const { newToken, sha256Hex } = await import("./crypto");

const OLD_TOKEN = newToken();
const NEW_TOKEN = newToken();

const EXPIRES = new Date("2026-12-17T12:00:00Z");

afterEach(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  // Tests run as if locally unless they say otherwise.
  vi.stubEnv("VERCEL", "");
  jar.clear();
  requestHeaders = {};
  deleteSession.mockReset();
  findSessionUser.mockReset();
  findSessionUser.mockResolvedValue(null);
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

  it("off Vercel, is Secure over https or when the protocol is unknown, and not over plain http (like the owner cookie)", () => {
    expect(sessionCookieOptions(EXPIRES, "https", false).secure).toBe(true);
    expect(sessionCookieOptions(EXPIRES, null, false).secure).toBe(true);
    expect(sessionCookieOptions(EXPIRES, "http", false).secure).toBe(false);
  });

  it("on Vercel, is always Secure, even when the request says http or says nothing (#155)", () => {
    for (const proto of ["https", "http", "HTTP", "http, https", null]) {
      expect(sessionCookieOptions(EXPIRES, proto, true).secure, String(proto)).toBe(true);
    }
  });

  it("is set Secure on Vercel even when the request says http (#155)", async () => {
    vi.stubEnv("VERCEL", "1");
    requestHeaders = { "x-forwarded-proto": "http" };
    await setSessionCookie(NEW_TOKEN, EXPIRES);
    expect(jar.get(SESSION_COOKIE)?.options).toMatchObject({ secure: true });
  });

  it("is set without Secure locally over plain http, so testing from a phone on the LAN works", async () => {
    requestHeaders = { "x-forwarded-proto": "http" };
    await setSessionCookie(NEW_TOKEN, EXPIRES);
    expect(jar.get(SESSION_COOKIE)?.options).toMatchObject({ secure: false });
  });

  it("is set with those options for the request's protocol", async () => {
    requestHeaders = { "x-forwarded-proto": "https" };
    await setSessionCookie(NEW_TOKEN, EXPIRES);
    expect(jar.get(SESSION_COOKIE)).toEqual({ value: NEW_TOKEN, options: sessionCookieOptions(EXPIRES, "https") });
    expect(deleteSession).not.toHaveBeenCalled();
  });

  it("logging in again ends the browser's old session, so it isn't left valid", async () => {
    jar.set(SESSION_COOKIE, { value: OLD_TOKEN });
    await setSessionCookie(NEW_TOKEN, EXPIRES);
    expect(deleteSession).toHaveBeenCalledWith({}, sha256Hex(OLD_TOKEN));
    expect(jar.get(SESSION_COOKIE)?.value).toBe(NEW_TOKEN);
  });

  it("still logs in if ending the old session fails, and logs only the error's type", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    deleteSession.mockRejectedValueOnce(new Error(`Failed query: delete ... params: ${sha256Hex(OLD_TOKEN)}`));
    jar.set(SESSION_COOKIE, { value: OLD_TOKEN });
    await setSessionCookie(NEW_TOKEN, EXPIRES);
    expect(jar.get(SESSION_COOKIE)?.value).toBe(NEW_TOKEN);
    expect(error).toHaveBeenCalledWith("Couldn't end the previous session: Error");
    error.mockRestore();
  });
});

describe("getCurrentUser", () => {
  it("never queries for a cookie that isn't shaped like a token we issue", async () => {
    for (const value of ["not-a-real-session", "x".repeat(5000)]) {
      jar.set(SESSION_COOKIE, { value });
      expect(await getCurrentUser()).toBeNull();
    }
    expect(findSessionUser).not.toHaveBeenCalled();
  });

  it("looks up the token's hash, never the token", async () => {
    findSessionUser.mockResolvedValueOnce({ id: "u1", username: "ethan" });
    jar.set(SESSION_COOKIE, { value: NEW_TOKEN });
    expect(await getCurrentUser()).toEqual({ id: "u1", username: "ethan" });
    expect(findSessionUser.mock.calls[0]?.[1]).toBe(sha256Hex(NEW_TOKEN));
  });

  it("turns a failed lookup into an error that carries no query or token hash", async () => {
    findSessionUser.mockRejectedValueOnce(
      new Error(`Failed query: select ... params: ${sha256Hex(OLD_TOKEN)}`, { cause: Object.assign(new Error("x"), { code: "57P01" }) }),
    );
    jar.set(SESSION_COOKIE, { value: OLD_TOKEN });
    const thrown = await getCurrentUser().catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(SessionLookupError);
    expect(String((thrown as Error).message)).toBe("Couldn't check the session: Error (57P01)");
    expect((thrown as Error).cause).toBeUndefined();
  });

  it("counts a failed lookup as logged out for the header", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    findSessionUser.mockRejectedValueOnce(new Error("Failed query: ..."));
    jar.set(SESSION_COOKIE, { value: NEW_TOKEN });
    expect(await getCurrentUserOrLoggedOut()).toBeNull();
    expect(error).toHaveBeenCalledWith("Couldn't check the session: Error; showing the user as logged out");
    error.mockRestore();
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
