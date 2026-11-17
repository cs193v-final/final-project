import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("getDb", () => {
  it("doesn't connect at import time, and explains a missing DATABASE_URL", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const { getDb } = await import("@/db");
    expect(() => getDb()).toThrow(/DATABASE_URL is not set/);
  });

  it("creates one client lazily and reuses it", async () => {
    // A syntactically valid placeholder; nothing is sent until a query runs.
    vi.stubEnv("DATABASE_URL", "postgresql://USER:PASSWORD@example.invalid/db?sslmode=require");
    const { getDb } = await import("@/db");
    expect(getDb()).toBe(getDb());
  });

  it("refuses a connection string that doesn't require TLS, without echoing it (#60)", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://USER:PASSWORD@example.invalid/db?sslmode=prefer");
    const { getDb } = await import("@/db");
    expect(() => getDb()).toThrow(/DATABASE_URL must require TLS: sslmode=prefer/);
    expect(() => getDb()).not.toThrow(/PASSWORD|example\.invalid/);
  });
});
