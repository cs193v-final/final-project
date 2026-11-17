import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  // getDb keeps its client on globalThis outside production; start each test fresh.
  const global = globalThis as { __zoomOutDb?: { db: { $client?: { end?: () => Promise<void> } } } };
  await global.__zoomOutDb?.db.$client?.end?.();
  delete global.__zoomOutDb;
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

describe("client cache", () => {
  it("keeps one client across module reloads in development, so hot reload doesn't leak pools", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", "postgresql://postgres@127.0.0.1:5432/zoomout");
    const first = (await import("@/db")).getDb();
    vi.resetModules(); // what a hot reload does to this module
    const second = (await import("@/db")).getDb();
    expect(second).toBe(first);
  });

  it("makes a new client when DATABASE_URL changes", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://USER:PASSWORD@example.invalid/a?sslmode=require");
    const { getDb } = await import("@/db");
    const a = getDb();
    vi.stubEnv("DATABASE_URL", "postgresql://USER:PASSWORD@example.invalid/b?sslmode=require");
    expect(getDb()).not.toBe(a);
  });

  it("keeps the client in the module, not on globalThis, in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "postgresql://USER:PASSWORD@example.invalid/db?sslmode=require");
    const { getDb } = await import("@/db");
    expect(getDb()).toBe(getDb());
    expect((globalThis as { __zoomOutDb?: unknown }).__zoomOutDb).toBeUndefined();
  });
});

describe("driver choice", () => {
  it("uses node-postgres for a database on this machine and Neon HTTP for anything else", async () => {
    const { Pool } = await import("pg");
    vi.stubEnv("DATABASE_URL", "postgresql://postgres@127.0.0.1:5432/zoomout");
    const local = (await import("@/db")).getDb() as unknown as { $client: unknown };
    expect(local.$client).toBeInstanceOf(Pool);
    await (local.$client as InstanceType<typeof Pool>).end();

    vi.resetModules();
    vi.stubEnv("DATABASE_URL", "postgresql://USER:PASSWORD@example.invalid/db?sslmode=require");
    const remote = (await import("@/db")).getDb() as unknown as { $client: unknown };
    expect(remote.$client).not.toBeInstanceOf(Pool);
    expect(typeof remote.$client).toBe("function"); // neon()'s query function
  });

  it("uses node-postgres for any 127.0.0.0/8 address, which also passes the TLS exemption", async () => {
    const { Pool } = await import("pg");
    vi.stubEnv("DATABASE_URL", "postgresql://postgres@127.0.0.2:5432/zoomout");
    const db = (await import("@/db")).getDb() as unknown as { $client: unknown };
    expect(db.$client).toBeInstanceOf(Pool);
  });

  it("checks TLS before choosing a driver, so a remote URL without TLS gets no client at all", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://USER:PASSWORD@ep-x.neon.tech/db");
    const { getDb } = await import("@/db");
    expect(() => getDb()).toThrow(/must require TLS/);
    expect((globalThis as { __zoomOutDb?: unknown }).__zoomOutDb).toBeUndefined();
  });
});
