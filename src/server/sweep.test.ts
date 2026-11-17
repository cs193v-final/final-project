// Spec for the scheduled sweep (#154, security audit M2): GET /api/cron/sweep
// deletes expired sessions and rate-limit rows, only for a request carrying the
// CRON_SECRET bearer token, and never when CRON_SECRET isn't set. The database
// functions are mocked here; what they delete is specified in
// src/auth/accounts.test.ts, and sweep.db.test.ts runs the sweep on PGlite.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RATE_LIMITS } from "@/auth/accounts";
import type { PgDb } from "@/db/accounts";

const { deleteExpiredSessions, deleteExpiredRateLimits, getDb } = vi.hoisted(() => ({
  deleteExpiredSessions: vi.fn(),
  deleteExpiredRateLimits: vi.fn(),
  getDb: vi.fn(),
}));
vi.mock("@/db/accounts", () => ({ deleteExpiredSessions, deleteExpiredRateLimits }));
vi.mock("@/db", () => ({ getDb }));

const { isAuthorizedCron, RATE_LIMIT_MAX_AGE_MS, sweepExpired, sweepResponse } = await import("./sweep");
const { GET } = await import("@/app/api/cron/sweep/route");

// A placeholder, not a real token.
const SECRET = "x".repeat(32);
const NOW = new Date("2026-11-17T12:00:00Z");
const fakeDb = { fake: true } as unknown as PgDb;

beforeEach(() => {
  deleteExpiredSessions.mockReset().mockResolvedValue(3);
  deleteExpiredRateLimits.mockReset().mockResolvedValue(7);
  getDb.mockReset().mockReturnValue(fakeDb);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("isAuthorizedCron", () => {
  it("accepts exactly `Bearer <secret>`", () => {
    expect(isAuthorizedCron(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it("refuses a missing, wrong, partial or differently formatted token", () => {
    expect(isAuthorizedCron(null, SECRET)).toBe(false);
    expect(isAuthorizedCron("", SECRET)).toBe(false);
    expect(isAuthorizedCron("Bearer wrong", SECRET)).toBe(false);
    expect(isAuthorizedCron(`Bearer ${SECRET.slice(0, -1)}`, SECRET)).toBe(false);
    expect(isAuthorizedCron(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(isAuthorizedCron(SECRET, SECRET)).toBe(false);
    expect(isAuthorizedCron(`bearer ${SECRET}`, SECRET)).toBe(false);
  });

  it("refuses everything when no secret is configured", () => {
    expect(isAuthorizedCron("Bearer ", "")).toBe(false);
    expect(isAuthorizedCron("Bearer undefined", undefined)).toBe(false);
    expect(isAuthorizedCron("Bearer ", undefined)).toBe(false);
    expect(isAuthorizedCron(null, undefined)).toBe(false);
  });
});

describe("sweepExpired", () => {
  it("sweeps sessions expired by now and rate-limit rows older than the longest window", async () => {
    expect(await sweepExpired(fakeDb, NOW)).toEqual({ sessions: 3, rateLimits: 7 });
    expect(deleteExpiredSessions).toHaveBeenCalledWith(fakeDb, NOW);
    expect(deleteExpiredRateLimits).toHaveBeenCalledWith(fakeDb, new Date(NOW.getTime() - RATE_LIMIT_MAX_AGE_MS));
  });

  it("keeps every rate-limit row whose window could still be open", () => {
    for (const limit of Object.values(RATE_LIMITS)) expect(RATE_LIMIT_MAX_AGE_MS).toBeGreaterThanOrEqual(limit.windowMs);
    expect(RATE_LIMIT_MAX_AGE_MS).toBe(Math.max(...Object.values(RATE_LIMITS).map((l) => l.windowMs)));
  });
});

describe("sweepResponse", () => {
  const connect = vi.fn(() => fakeDb);
  beforeEach(() => connect.mockClear());

  async function expectRefused(response: Response) {
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(connect).not.toHaveBeenCalled();
    expect(deleteExpiredSessions).not.toHaveBeenCalled();
    expect(deleteExpiredRateLimits).not.toHaveBeenCalled();
  }

  it("refuses without touching the database when CRON_SECRET isn't set", async () => {
    await expectRefused(await sweepResponse(`Bearer ${SECRET}`, undefined, connect, NOW));
    await expectRefused(await sweepResponse("Bearer ", "", connect, NOW));
  });

  it("refuses a wrong or missing token without touching the database", async () => {
    await expectRefused(await sweepResponse("Bearer nope", SECRET, connect, NOW));
    await expectRefused(await sweepResponse(null, SECRET, connect, NOW));
  });

  it("sweeps and returns only the counts for the right token", async () => {
    const response = await sweepResponse(`Bearer ${SECRET}`, SECRET, connect, NOW);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ deleted: { sessions: 3, rateLimits: 7 } });
    expect(connect).toHaveBeenCalledOnce();
    expect(deleteExpiredSessions).toHaveBeenCalledWith(fakeDb, NOW);
    expect(deleteExpiredRateLimits).toHaveBeenCalledWith(fakeDb, new Date(NOW.getTime() - RATE_LIMIT_MAX_AGE_MS));
  });

  it("never writes the secret to the log", async () => {
    const warn = vi.mocked(console.warn);
    await sweepResponse("Bearer guess", SECRET, connect, NOW);
    await sweepResponse(`Bearer ${SECRET}`, undefined, connect, NOW);
    for (const call of warn.mock.calls) expect(JSON.stringify(call)).not.toContain(SECRET);
  });
});

describe("GET /api/cron/sweep", () => {
  const get = (authorization?: string) =>
    GET(new Request("http://localhost/api/cron/sweep", authorization ? { headers: { authorization } } : {}));

  it("is refused when CRON_SECRET isn't set", async () => {
    vi.stubEnv("CRON_SECRET", undefined);
    expect((await get(`Bearer ${SECRET}`)).status).toBe(401);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("is refused with a wrong or missing token", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    expect((await get("Bearer wrong")).status).toBe(401);
    expect((await get()).status).toBe(401);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("sweeps with the token Vercel Cron sends", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const response = await get(`Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: { sessions: 3, rateLimits: 7 } });
    expect(deleteExpiredSessions).toHaveBeenCalledOnce();
    expect(deleteExpiredRateLimits).toHaveBeenCalledOnce();
  });
});
