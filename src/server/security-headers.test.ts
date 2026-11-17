import { describe, expect, it } from "vitest";

import { contentSecurityPolicy, securityHeaders } from "./security-headers";

const header = (isDev: boolean, key: string) => securityHeaders(isDev).find((h) => h.key === key)?.value;

describe("security headers (#105)", () => {
  it("forbid framing, MIME sniffing and full-URL referrers, and pin https", () => {
    expect(header(false, "X-Content-Type-Options")).toBe("nosniff");
    expect(header(false, "Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(header(false, "X-Frame-Options")).toBe("DENY");
    expect(header(false, "Strict-Transport-Security")).toBe("max-age=63072000");
    expect(header(false, "Content-Security-Policy")).toContain("frame-ancestors 'none'");
  });

  it("allow scripts, fonts, images and requests only from our own origin", () => {
    const csp = contentSecurityPolicy(false);
    for (const directive of ["default-src 'self'", "font-src 'self'", "connect-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'"]) {
      expect(csp).toContain(directive);
    }
    expect(csp).toMatch(/script-src 'self' 'unsafe-inline'(;|$)/);
    expect(csp).not.toMatch(/https?:|\*/);
  });

  it("allow eval only in development, for React's dev tooling", () => {
    expect(contentSecurityPolicy(false)).not.toContain("unsafe-eval");
    expect(contentSecurityPolicy(true)).toContain("'unsafe-eval'");
  });
});
