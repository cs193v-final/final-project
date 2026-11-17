import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A stand-in for the request's cookies and headers (next/headers only works inside a request).
const jar = new Map<string, { value: string; options?: unknown }>();
let requestHeaders: Record<string, string> = {};

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)!.value } : undefined),
    set: (name: string, value: string, options: unknown) => jar.set(name, { value, options }),
  }),
  headers: async () => new Headers(requestHeaders),
}));

const { currentOrNewOwner, currentOwner, hashOwnerToken, isHttpsRequest, isOwnerToken, newOwnerToken, OWNER_COOKIE, ownerCookieOptions } =
  await import("./owner");

afterEach(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  // Tests run as if locally unless they say otherwise.
  vi.stubEnv("VERCEL", "");
  jar.clear();
  // What Next passes on for a deployed site behind Vercel's proxy.
  requestHeaders = { host: "zoom-out.example.com", "x-forwarded-proto": "https" };
});

describe("owner tokens", () => {
  it("are 32 random bytes as base64url, different every time", () => {
    const a = newOwnerToken();
    const b = newOwnerToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(a, "base64url")).toHaveLength(32);
    expect(a).not.toBe(b);
    expect(isOwnerToken(a)).toBe(true);
  });

  it("are hashed with SHA-256 for the owner id", () => {
    const token = newOwnerToken();
    expect(hashOwnerToken(token)).toBe(createHash("sha256").update(token).digest("hex"));
    expect(hashOwnerToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects values we didn't issue", () => {
    for (const bad of [undefined, "", "short", "a".repeat(44), `${"a".repeat(42)}=`, `${"a".repeat(42)}/`]) {
      expect(isOwnerToken(bad), String(bad)).toBe(false);
    }
  });
});

describe("ownerCookieOptions", () => {
  it("is httpOnly, SameSite=Lax, Path=/ and Secure over https", () => {
    expect(ownerCookieOptions("https")).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 365 * 24 * 60 * 60,
    });
  });

  it("decides Secure from the protocol, using the first X-Forwarded-Proto value", () => {
    expect(isHttpsRequest("https")).toBe(true);
    expect(isHttpsRequest("HTTPS")).toBe(true);
    expect(isHttpsRequest("http")).toBe(false);
    expect(isHttpsRequest("https, http")).toBe(true); // client → proxy was https
    expect(isHttpsRequest("http,https")).toBe(false);
    expect(isHttpsRequest(null)).toBe(true); // unknown: the safe default
    expect(isHttpsRequest("")).toBe(true);
  });
});

describe("currentOwner / currentOrNewOwner", () => {
  it("has no owner until the first game, then sets the cookie once and keeps the same owner", async () => {
    expect(await currentOwner()).toBeNull();

    const owner = await currentOrNewOwner();
    const cookie = jar.get(OWNER_COOKIE)!;
    expect(isOwnerToken(cookie.value)).toBe(true);
    expect(cookie.options).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/" });
    // The owner id is the hash, never the token itself.
    expect(owner).toEqual({ anonId: hashOwnerToken(cookie.value) });

    expect(await currentOwner()).toEqual(owner);
    expect(await currentOrNewOwner()).toEqual(owner);
    expect(jar.get(OWNER_COOKIE)!.value).toBe(cookie.value);
  });

  it.each([
    ["https on a deployed site", { host: "zoom-out.example.com", "x-forwarded-proto": "https" }, true],
    ["http from another device on the LAN", { host: "192.168.1.20:3000", "x-forwarded-proto": "http" }, false],
    ["http on localhost", { host: "localhost:3000", "x-forwarded-proto": "http" }, false],
    ["https through a proxy chain", { host: "127.0.0.1:3000", "x-forwarded-proto": "https,http" }, true],
  ])("sets a cookie the browser keeps: %s", async (_name, headers, secure) => {
    requestHeaders = headers;
    await currentOrNewOwner();
    expect(jar.get(OWNER_COOKIE)!.options).toMatchObject({ secure });
  });

  it("sets a Secure cookie on Vercel even when the request says http (shares isHttpsRequest's rule, #155)", async () => {
    vi.stubEnv("VERCEL", "1");
    requestHeaders = { host: "zoom-out.vercel.app", "x-forwarded-proto": "http" };
    await currentOrNewOwner();
    expect(jar.get(OWNER_COOKIE)!.options).toMatchObject({ secure: true });
  });

  it("ignores a tampered cookie and replaces it on the next start", async () => {
    jar.set(OWNER_COOKIE, { value: "not-a-token" });
    expect(await currentOwner()).toBeNull();
    const owner = await currentOrNewOwner();
    expect(jar.get(OWNER_COOKIE)!.value).not.toBe("not-a-token");
    expect(owner).toEqual({ anonId: hashOwnerToken(jar.get(OWNER_COOKIE)!.value) });
  });
});
