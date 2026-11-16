import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A stand-in for the request's cookies and headers (next/headers only works inside a request).
const jar = new Map<string, { value: string; options?: unknown }>();
let host: string | null = "zoom-out.example.com";

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)!.value } : undefined),
    set: (name: string, value: string, options: unknown) => jar.set(name, { value, options }),
  }),
  headers: async () => new Headers(host ? { host } : {}),
}));

const { currentOrNewOwner, currentOwner, hashOwnerToken, hostnameOf, isOwnerToken, newOwnerToken, OWNER_COOKIE, ownerCookieOptions } =
  await import("./owner");

beforeEach(() => {
  jar.clear();
  host = "zoom-out.example.com";
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
  it("is httpOnly, SameSite=Lax, Path=/ and Secure on a real host", () => {
    expect(ownerCookieOptions("zoom-out.example.com")).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 365 * 24 * 60 * 60,
    });
    expect(ownerCookieOptions(null).secure).toBe(true);
  });

  it("drops Secure only for plain-http development on this machine", () => {
    for (const h of ["localhost:3000", "127.0.0.1:3100", "[::1]:3000", "localhost"]) {
      expect(ownerCookieOptions(h).secure, h).toBe(false);
    }
    expect(ownerCookieOptions("localhost.example.com").secure).toBe(true);
  });

  it("reads the hostname from a Host header", () => {
    expect(hostnameOf("127.0.0.1:3100")).toBe("127.0.0.1");
    expect(hostnameOf("[::1]:3000")).toBe("[::1]");
    expect(hostnameOf("example.com")).toBe("example.com");
    expect(hostnameOf(null)).toBe("");
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

  it("ignores a tampered cookie and replaces it on the next start", async () => {
    jar.set(OWNER_COOKIE, { value: "not-a-token" });
    expect(await currentOwner()).toBeNull();
    host = "127.0.0.1:3100";
    const owner = await currentOrNewOwner();
    expect(jar.get(OWNER_COOKIE)!.value).not.toBe("not-a-token");
    expect(jar.get(OWNER_COOKIE)!.options).toMatchObject({ secure: false });
    expect(owner).toEqual({ anonId: hashOwnerToken(jar.get(OWNER_COOKIE)!.value) });
  });
});
