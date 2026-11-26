import { createHash, createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { hashIp, IP_KEY_ENV, ipHmacKey } from "./ip-key";

const KEY_VALUE = "k".repeat(40); // a placeholder, not a real key

describe("hashIp", () => {
  const key = Buffer.from(KEY_VALUE);

  it("is a keyed HMAC-SHA-256, not plain SHA-256 of the address", () => {
    const hash = hashIp("203.0.113.7", key);
    expect(hash).toBe(createHmac("sha256", key).update("203.0.113.7").digest("hex"));
    expect(hash).not.toBe(createHash("sha256").update("203.0.113.7").digest("hex"));
    expect(hash).not.toBe(hashIp("203.0.113.7", Buffer.from("x".repeat(40))));
  });

  it("treats case and surrounding spaces as the same address", () => {
    expect(hashIp(" 2001:DB8::1 ", key)).toBe(hashIp("2001:db8::1", key));
  });

  it("counts an IPv4-mapped IPv6 address with its plain IPv4 form", () => {
    expect(hashIp("::FFFF:203.0.113.7", key)).toBe(hashIp("203.0.113.7", key));
  });

  it("counts two IPv6 addresses in one /64 together, however they are written (#167)", () => {
    const a = hashIp("2001:db8:aaaa:1::1", key);
    expect(hashIp("2001:db8:aaaa:1:ffff:ffff:ffff:ffff", key)).toBe(a);
    expect(hashIp("2001:0DB8:AAAA:0001:0:0:0:abcd", key)).toBe(a);
    expect(hashIp("[2001:db8:aaaa:1::2]", key)).toBe(a);
    expect(hashIp("2001:db8:aaaa:1::3%eth0", key)).toBe(a);
  });

  it("counts IPv6 addresses in different /64s separately (#167)", () => {
    const a = hashIp("2001:db8:aaaa:1::1", key);
    expect(hashIp("2001:db8:aaaa:2::1", key)).not.toBe(a);
    expect(hashIp("2001:db8:bbbb:1::1", key)).not.toBe(a);
  });

  it("hashes IPv4 and ::ffff: addresses exactly as before #167", () => {
    // hashIp before #167, so IPv4 counters carry on unchanged.
    const before = (ip: string) =>
      createHmac("sha256", key)
        .update(ip.trim().toLowerCase().replace(/^::ffff:/, ""), "utf8")
        .digest("hex");
    for (const ip of ["203.0.113.7", " 198.51.100.1 ", "10.0.0.1", "::ffff:203.0.113.7", "::FFFF:192.0.2.55"]) {
      expect(hashIp(ip, key), ip).toBe(before(ip));
    }
  });

  it("puts requests without an address in one shared bucket", () => {
    expect(hashIp(null, key)).toBe("unknown");
    expect(hashIp("  ", key)).toBe("unknown");
  });
});

describe("ipHmacKey", () => {
  it(`uses ${IP_KEY_ENV} when set`, () => {
    expect(ipHmacKey({ [IP_KEY_ENV]: KEY_VALUE })).toEqual(Buffer.from(KEY_VALUE));
  });

  it("refuses a short key without printing it", () => {
    expect(() => ipHmacKey({ [IP_KEY_ENV]: "short-key" })).toThrow(/at least 32/);
    expect(() => ipHmacKey({ [IP_KEY_ENV]: "short-key" })).not.toThrow(/short-key/);
  });

  it("is required on Vercel preview and production", () => {
    for (const VERCEL_ENV of ["preview", "production"]) {
      expect(() => ipHmacKey({ VERCEL_ENV })).toThrow(`${IP_KEY_ENV} is not set`);
    }
  });

  it("falls back to one random key per process elsewhere (dev, e2e, CI)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = ipHmacKey({});
    expect(first).toHaveLength(32);
    expect(ipHmacKey({ VERCEL_ENV: "development" })).toBe(first);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
