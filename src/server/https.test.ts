// When a cookie may be Secure (#77, #155).
import { afterEach, describe, expect, it, vi } from "vitest";

import { isHttpsRequest } from "./https";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isHttpsRequest", () => {
  it("off Vercel, follows the client's X-Forwarded-Proto", () => {
    expect(isHttpsRequest("https", false)).toBe(true);
    expect(isHttpsRequest("HTTPS", false)).toBe(true);
    expect(isHttpsRequest("http", false)).toBe(false);
    expect(isHttpsRequest("HTTP", false)).toBe(false);
    expect(isHttpsRequest("https, http", false)).toBe(true); // client → proxy was https
    expect(isHttpsRequest("http,https", false)).toBe(false);
    expect(isHttpsRequest(null, false)).toBe(true); // unknown: the safe default
    expect(isHttpsRequest("", false)).toBe(true);
    expect(isHttpsRequest(" http , https", false)).toBe(false);
  });

  it("off Vercel, only an explicit http turns Secure off (#108)", () => {
    for (const proto of ["ftp", "wss", "h2", "unknown"]) {
      expect(isHttpsRequest(proto, false), proto).toBe(true);
    }
  });

  it("on Vercel, is always https, whatever the header says (#155)", () => {
    for (const proto of ["https", "http", "HTTP", "http, https", "ftp", "", null]) {
      expect(isHttpsRequest(proto, true), String(proto)).toBe(true);
    }
  });

  it("knows it's on Vercel from the VERCEL variable", () => {
    vi.stubEnv("VERCEL", "1");
    expect(isHttpsRequest("http")).toBe(true);
    vi.stubEnv("VERCEL", "");
    expect(isHttpsRequest("http")).toBe(false);
  });
});
