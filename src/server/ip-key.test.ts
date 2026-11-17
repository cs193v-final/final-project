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
