// The daily on the server (#58), end to end minus HTTP: the owner cookie
// (next/headers, stubbed), today's pack from the schedule, per-level images
// (#57, #126), the game service and the Postgres store, on PGlite with the
// real migrations. The practice photos stand in for a private daily, under
// other ids, so they're treated as private (they must be cut).
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { seedContent } from "@/db/content";
import { setPackScoring } from "@/db/pack-scoring";
import { SCORING_CONFIG } from "@/game/scoring-config";
import * as schema from "@/db/schema";
import { combineContent } from "@/game/packs";
import type { GameView, Pack, Puzzle } from "@/game/types";

import { cutPuzzleImages } from "../../scripts/seed-images.ts";

const state = vi.hoisted(() => ({
  db: undefined as unknown,
  jar: new Map<string, string>(),
  /** Request headers besides x-forwarded-proto, e.g. x-forwarded-for. */
  headers: {} as Record<string, string>,
}));

// Daily games are stored encrypted (#84), so the store needs a key, as in games.test.ts.
vi.stubEnv("DATA_ENCRYPTION_KEY", Buffer.alloc(32, 5).toString("base64"));

vi.mock("@/db", () => ({ getDb: () => state.db }));
vi.mock("next/cache", () => ({ cacheLife: () => {} }));
// Request time, as in a real request (games.ts awaits it before its rate limits, #169).
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (state.jar.has(name) ? { name, value: state.jar.get(name)! } : undefined),
    set: (name: string, value: string) => state.jar.set(name, value),
  }),
  headers: async () => new Headers({ "x-forwarded-proto": "https", ...state.headers }),
}));

const { startTodaysDaily, loadTodaysDailyGame, loadDailyIntro, loadDailyStats } = await import("./daily");
const { actOnGame, startPracticeGame } = await import("./games");
const { GAME_LIMITS } = await import("./limits");

const root = fileURLToPath(new URL("../..", import.meta.url));
let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

const puzzle = (id: string, file: string, answer: string): Puzzle => ({
  id,
  // A private daily's original sits next to its content file (images/…), never in public/.
  imageUrl: `images/${file}.jpg`,
  answer,
  acceptedAnswers: [],
  reveal: { focus: { x: 0.5, y: 0.5 }, zoomLevels: [8, 4, 2, 1] },
  credit: { source: "Someone", license: "CC BY-SA 4.0" },
  aiSolvedLevel: null,
});
const PUZZLES = [puzzle("pz-d1", "pz-dbdb4dee", "Giraffe"), puzzle("pz-d2", "pz-683182e7", "Strawberry")];
const daily = (id: string, theme: string): Pack => ({ id, kind: "daily", title: theme, theme, puzzleIds: PUZZLES.map((p) => p.id) });

// Two days around the 2026 fall daylight-saving change (Nov 1, clocks go back
// at 2 am PDT). Midnight Nov 2 is PST: 08:00 UTC.
const NOV1 = "2026-11-01";
const NOV2 = "2026-11-02";
const BEFORE_MIDNIGHT = new Date("2026-11-02T07:59:59Z"); // 23:59:59 PST on Nov 1
const AFTER_MIDNIGHT = new Date("2026-11-02T08:00:01Z"); // 00:00:01 PST on Nov 2
const NOTHING_SCHEDULED = new Date("2026-11-10T20:00:00Z");

function ok(result: { ok: boolean; view?: GameView; error?: string } | null): GameView {
  if (!result?.ok) throw new Error(`expected a game, got ${result ? result.error : "null"}`);
  return result.view!;
}
const gameCount = async () => Number((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM games")).rows[0]!.n);

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle({ client: pg, schema });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
  state.db = db;
  await seedContent(
    db,
    combineContent([
      {
        source: "t",
        content: {
          puzzles: PUZZLES,
          packs: [daily("pk-n1", "Mixed bag"), daily("pk-n2", "Next day")],
          schedule: [
            { date: NOV1, packId: "pk-n1" },
            { date: NOV2, packId: "pk-n2" },
          ],
        },
      },
    ]),
  );
}, 60_000);

afterAll(async () => {
  await pg.close();
});

beforeEach(() => {
  state.jar = new Map(); // a new player for each test
  state.headers = {};
});

describe("the daily on the server", () => {
  it("shows the day's intro, with the theme and count only", async () => {
    expect(await loadDailyIntro(BEFORE_MIDNIGHT)).toEqual({ date: NOV1, pack: { theme: "Mixed bag", puzzleCount: 2 } });
    expect(await loadDailyIntro(AFTER_MIDNIGHT)).toEqual({ date: NOV2, pack: { theme: "Next day", puzzleCount: 2 } });
  });

  it("refuses a private daily whose images aren't cut, rather than send the full photo", async () => {
    expect(await startTodaysDaily(NOV1, BEFORE_MIDNIGHT)).toEqual({ ok: false, error: "unavailable" });
    expect(await gameCount()).toBe(0);
  });

  it("once cut: plays from the level image only, resumes, and never starts a second game", async () => {
    // The stand-in originals are the practice photos in public/puzzles/.
    await cutPuzzleImages(db, PUZZLES, (p) => join(root, "public", "puzzles", p.imageUrl.replace("images/", "")));

    let view = ok(await startTodaysDaily(NOV1, BEFORE_MIDNIGHT));
    expect(view.round!.imageSrc).toMatch(/^\/img\/[0-9a-f]{32}\.webp$/u);
    expect(view.round).not.toHaveProperty("reveal");
    expect(JSON.stringify(view).toLowerCase()).not.toMatch(/giraffe|strawberry|\/puzzles\/|images\/pz-/u);

    view = ok(await actOnGame(view.gameId, { type: "reveal" }, view.revision));
    expect(ok(await loadTodaysDailyGame(BEFORE_MIDNIGHT)).round!.imageSrc).toBe(view.round!.imageSrc);
    expect(ok(await startTodaysDaily(NOV1, BEFORE_MIDNIGHT)).gameId).toBe(view.gameId);
  }, 60_000);

  it("plays with the day's pack scoring (#64), or the default (logged) if the stored value is invalid", async () => {
    await cutPuzzleImages(db, PUZZLES, (p) => join(root, "public", "puzzles", p.imageUrl.replace("images/", "")));
    try {
      const basePoints = SCORING_CONFIG.basePoints + 50;
      await setPackScoring(db, "pk-n1", { basePoints });
      expect(ok(await startTodaysDaily(NOV1, BEFORE_MIDNIGHT)).round!.pointsAvailable).toBe(basePoints);

      state.jar = new Map(); // another player
      await pg.query("UPDATE packs SET scoring = $1::jsonb WHERE id = 'pk-n1'", [JSON.stringify({ basePoints: 1.5 })]);
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(ok(await startTodaysDaily(NOV1, BEFORE_MIDNIGHT)).round!.pointsAvailable).toBe(SCORING_CONFIG.basePoints);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('pack "pk-n1" has an invalid scoring override'));
      log.mockRestore();
    } finally {
      await setPackScoring(db, "pk-n1", null);
    }
  }, 60_000);

  it("at midnight (a daylight-saving night): the intro's day is over, so Start says so instead of playing tomorrow", async () => {
    const before = ok(await startTodaysDaily(NOV1, BEFORE_MIDNIGHT));
    expect(ok(await loadTodaysDailyGame(BEFORE_MIDNIGHT)).gameId).toBe(before.gameId);

    // The page showed Nov 1; Start is pressed one second after midnight.
    const games = await gameCount();
    expect(await startTodaysDaily(NOV1, AFTER_MIDNIGHT)).toEqual({ ok: false, error: "day-over" });
    expect(await gameCount()).toBe(games);

    // Nov 2 is a new day: no game yet, then its own game.
    expect(await loadTodaysDailyGame(AFTER_MIDNIGHT)).toBeNull();
    const next = ok(await startTodaysDaily(NOV2, AFTER_MIDNIGHT));
    expect(next.gameId).not.toBe(before.gameId);
    expect(next.pack.theme).toBe("Next day");
  }, 60_000);

  it("says nothing is scheduled (not 'another browser') on an empty day", async () => {
    expect(await startTodaysDaily("2026-11-10", NOTHING_SCHEDULED)).toEqual({ ok: false, error: "no-daily" });
  });

  it("refuses a day that isn't today, and junk", async () => {
    for (const date of ["2026-10-31", "2026-11-03", "", null, 42, { date: NOV1 }]) {
      expect(await startTodaysDaily(date, BEFORE_MIDNIGHT)).toEqual({ ok: false, error: "day-over" });
    }
  });

  it("a player with no cookie has no daily game yet", async () => {
    expect(await loadTodaysDailyGame(BEFORE_MIDNIGHT)).toBeNull();
  });

  it("gives stats for a daily started before midnight and finished after it, for its own day only", async () => {
    let view = ok(await startTodaysDaily(NOV1, BEFORE_MIDNIGHT));
    expect(await loadDailyStats(NOV1)).toBeNull(); // still playing
    // The moves go by game id, so the clock passing midnight doesn't matter.
    for (let i = 0; i < PUZZLES.length; i++) {
      view = ok(await actOnGame(view.gameId, { type: "skip" }, view.revision));
      view = ok(await actOnGame(view.gameId, { type: "next" }, view.revision));
    }
    expect(view.finished).toBe(true);
    const stats = await loadDailyStats(NOV1); // the day it was played, from the intro
    expect(stats).not.toBeNull();
    expect(stats!.rounds).toHaveLength(PUZZLES.length);
    expect(await loadDailyStats(NOV2)).toBeNull(); // not this player's game for that day
  }, 60_000);

  it("gives no stats for junk dates or a player with no cookie", async () => {
    for (const date of [null, 42, "", "tomorrow", "2026-11-1"]) expect(await loadDailyStats(date)).toBeNull();
    expect(await loadDailyStats(NOV1)).toBeNull(); // a new player
  });
});

// Starting the daily counts toward the same start limits as practice (#85,
// #210). Runs after the tests above, which cut the daily's images.
describe("rate limits on starting the daily", () => {
  beforeEach(async () => {
    await pg.exec("DELETE FROM rate_limits;");
  });

  // Starts are counted per player across packs, so practice starts use up the
  // limit here (on the daily's clock, so both share one window).
  const useUpStarts = async (n: number) => {
    for (let i = 0; i < n; i++) ok(await startPracticeGame());
    expect(await startPracticeGame()).toEqual({ ok: false, error: "rate-limited" });
  };

  it("returns `rate-limited` for a new daily over the owner limit, without creating a game", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: BEFORE_MIDNIGHT });
    try {
      await useUpStarts(GAME_LIMITS.startsPerOwner.max);
      const games = await gameCount();
      expect(await startTodaysDaily(NOV1, BEFORE_MIDNIGHT)).toEqual({ ok: false, error: "rate-limited" });
      expect(await gameCount()).toBe(games);
      expect(await loadTodaysDailyGame(BEFORE_MIDNIGHT)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  }, 60_000);

  it("still resumes today's game at the limit: pressing Start again doesn't count", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: BEFORE_MIDNIGHT });
    try {
      const view = ok(await startTodaysDaily(NOV1, BEFORE_MIDNIGHT));
      await useUpStarts(GAME_LIMITS.startsPerOwner.max - 1);
      for (let i = 0; i < 3; i++) expect(ok(await startTodaysDaily(NOV1, BEFORE_MIDNIGHT)).gameId).toBe(view.gameId);
      expect(ok(await loadTodaysDailyGame(BEFORE_MIDNIGHT)).gameId).toBe(view.gameId);
    } finally {
      vi.useRealTimers();
    }
  }, 60_000);

  it("stops a client that drops its cookie each time at the per-IP limit, without creating a game", async () => {
    state.headers = { "x-forwarded-for": "203.0.113.7" };
    for (let i = 0; i < GAME_LIMITS.startsPerIp.max; i++) {
      state.jar = new Map(); // a new anonymous player each time
      ok(await startTodaysDaily(NOV1, BEFORE_MIDNIGHT));
    }
    const games = await gameCount();
    state.jar = new Map();
    expect(await startTodaysDaily(NOV1, BEFORE_MIDNIGHT)).toEqual({ ok: false, error: "rate-limited" });
    expect(await gameCount()).toBe(games);
    // Another address is counted on its own.
    state.headers = { "x-forwarded-for": "198.51.100.20" };
    expect((await startTodaysDaily(NOV1, BEFORE_MIDNIGHT)).ok).toBe(true);
  }, 120_000);
});
