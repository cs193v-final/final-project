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
    vi.stubEnv("DATABASE_URL", "postgresql://USER:PASSWORD@example.invalid/db");
    const { getDb } = await import("@/db");
    expect(getDb()).toBe(getDb());
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
    vi.stubEnv("DATABASE_URL", "postgresql://USER:PASSWORD@example.invalid/a");
    const { getDb } = await import("@/db");
    const a = getDb();
    vi.stubEnv("DATABASE_URL", "postgresql://USER:PASSWORD@example.invalid/b");
    expect(getDb()).not.toBe(a);
  });

  it("keeps the client in the module, not on globalThis, in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "postgresql://USER:PASSWORD@example.invalid/db");
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
    vi.stubEnv("DATABASE_URL", "postgresql://USER:PASSWORD@example.invalid/db");
    const remote = (await import("@/db")).getDb() as unknown as { $client: unknown };
    expect(remote.$client).not.toBeInstanceOf(Pool);
    expect(typeof remote.$client).toBe("function"); // neon()'s query function
  });

  it("recognizes loopback hosts only", async () => {
    const { isLoopbackDatabaseUrl, isLoopbackHost } = await import("@/db");
    for (const host of ["localhost", "LOCALHOST", "127.0.0.1", "127.1.2.3", "::1", "[::1]"]) {
      expect(isLoopbackHost(host), host).toBe(true);
    }
    for (const host of ["example.com", "localhost.example.com", "10.0.0.1", "128.0.0.1", "ep-x-pooler.neon.tech"]) {
      expect(isLoopbackHost(host), host).toBe(false);
    }
    expect(isLoopbackDatabaseUrl("postgresql://USER:PASSWORD@[::1]:5432/db")).toBe(true);
    expect(isLoopbackDatabaseUrl("postgresql://USER:PASSWORD@localhost/db")).toBe(true);
    expect(isLoopbackDatabaseUrl("postgresql://USER:PASSWORD@ep-x.neon.tech/db?sslmode=require")).toBe(false);
    expect(() => isLoopbackDatabaseUrl("not a url with a s3cret")).toThrow("DATABASE_URL is not a valid connection URL.");
  });
});
