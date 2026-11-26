// The daily's Server Actions (#58) with the server side stubbed: a failed
// stats query is logged without its parameters (#60).
import { DrizzleQueryError } from "drizzle-orm/errors";
import { afterEach, describe, expect, it, vi } from "vitest";

const { loadDailyStats } = vi.hoisted(() => ({ loadDailyStats: vi.fn() }));
vi.mock("@/server/daily", () => ({ loadDailyStats, startTodaysDaily: vi.fn() }));

const { dailyStatsAction } = await import("./actions");

const OWNER_HASH = "b".repeat(64);
const GAME_ID = "0b6f5c1e-3d2a-4c7b-9e8f-1a2b3c4d5e6f";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("dailyStatsAction", () => {
  it("returns the player's stats", async () => {
    loadDailyStats.mockResolvedValueOnce({ rounds: [] });
    expect(await dailyStatsAction("2026-11-01")).toEqual({ rounds: [] });
  });

  it("returns null when the query fails, and logs one line without the query's parameters", async () => {
    const postgres = Object.assign(new Error(`invalid input syntax for type uuid: "${GAME_ID}"`), {
      name: "NeonDbError",
      code: "22P02",
    });
    loadDailyStats.mockRejectedValueOnce(
      new DrizzleQueryError('select "id" from "games" where "anon_owner_hash" = $1 and "id" = $2', [OWNER_HASH, GAME_ID], postgres),
    );
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await dailyStatsAction("2026-11-01")).toBeNull();

    expect(log).toHaveBeenCalledOnce();
    const printed = log.mock.calls.flat().map(String).join("\n");
    expect(printed).toMatch(/^Couldn't load the daily stats: .*Failed query/);
    expect(printed).toContain("22P02");
    for (const value of [OWNER_HASH, GAME_ID]) expect(printed).not.toContain(value);
  });
});
