import { describe, expect, it } from "vitest";

import { loginPath, parseWelcome, safeNextPath, withWelcome } from "./next-path";

describe("safeNextPath", () => {
  it.each([
    ["/", "/"],
    ["/account", "/account"],
    ["/play?game=abc123", "/play?game=abc123"],
    ["/play?game=..", "/play?game=.."],
    ["/play?game=a%2Fb#top", "/play?game=a%2Fb#top"],
    ["/%2F%2Fevil.com", "/%2F%2Fevil.com"],
  ])("keeps a path on this site: %j", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each([
    ["another host, protocol-relative", "//evil.com"],
    ["another host, three slashes", "///evil.com"],
    ["a backslash read as a slash", "/\\evil.com"],
    ["a backslash first", "\\\\evil.com"],
    ["an absolute URL", "https://x"],
    ["an http URL", "http://evil.com/account"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["a data: URL", "data:text/html,hi"],
    ["no leading slash", "evil.com/account"],
    ["a relative path", "account"],
    ["empty", ""],
    ["a tab browsers drop", "/\t/evil.com"],
    ["a newline browsers drop", "/\n/evil.com"],
    ["a space", "/ /evil.com"],
    ["a non-breaking space", "/\u00a0/evil.com"],
    ["a null byte", "/acc\u0000ount"],
    ["dot segments that become //", "/..//evil.com"],
    ["dot segments that become //, deeper", "/a/../..//evil.com"],
    ["the login page", "/login?next=/account"],
    ["the sign-up page", "/register"],
    ["the login page with a trailing slash", "/login/"],
    ["the sign-up page with trailing slashes", "/register//?next=/account"],
    ["too long", `/${"a".repeat(600)}`],
  ])("goes home instead of %s", (_name, input) => {
    expect(safeNextPath(input)).toBe("/");
  });

  it.each([[undefined], [null], [42], [["/account"]], [{}]])("goes home for a non-string %j", (input) => {
    expect(safeNextPath(input)).toBe("/");
  });
});

describe("loginPath", () => {
  it("adds a safe next path, encoded", () => {
    expect(loginPath("/account")).toBe("/login?next=%2Faccount");
    expect(loginPath("/play?game=abc")).toBe("/login?next=%2Fplay%3Fgame%3Dabc");
  });

  it("leaves next out for home, nothing, or an unsafe path", () => {
    expect(loginPath()).toBe("/login");
    expect(loginPath("/")).toBe("/login");
    expect(loginPath("//evil.com")).toBe("/login");
  });
});

describe("withWelcome", () => {
  it("adds ?welcome= and keeps the rest of the path", () => {
    expect(withWelcome("/", "login")).toBe("/?welcome=login");
    expect(withWelcome("/play?game=abc", "signup")).toBe("/play?game=abc&welcome=signup");
    expect(withWelcome("/account#top", "login")).toBe("/account?welcome=login#top");
  });
});

describe("parseWelcome", () => {
  it("accepts only login and signup", () => {
    expect(parseWelcome("login")).toBe("login");
    expect(parseWelcome("signup")).toBe("signup");
    expect(parseWelcome("admin")).toBeNull();
    expect(parseWelcome(null)).toBeNull();
    expect(parseWelcome(undefined)).toBeNull();
  });
});
