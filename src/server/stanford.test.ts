// Stanford mode on the server (#65), end to end minus HTTP: the owner cookie
// (next/headers, stubbed), the Stanford pack from the database, per-level
// images (#57), the game service, the rate limits (#85) and the Postgres
// store, on PGlite with the real migrations.
//
// The content is obviously fake: the practice photos stand in for Stanford
// photos, under other ids and with made-up answers and credits, so they're
// treated as private (they must be cut). The real pack is never in the repo.
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { seedContent } from "@/db/content";
import { setPackScoring } from "@/db/pack-scoring";
import * as schema from "@/db/schema";
import { combineContent } from "@/game/packs";
import { SCORING_CONFIG } from "@/game/scoring-config";
import type { GameView, Pack, Puzzle } from "@/game/types";

import { cutPuzzleImages } from "../../scripts/seed-images.ts";

const state = vi.hoisted(() => ({ db: undefined as unknown, jar: new Map<string, string>() }));

// Game states are stored encrypted (#84), so the store needs a key, as in games.test.ts.
vi.stubEnv("DATA_ENCRYPTION_KEY", Buffer.alloc(32, 5).toString("base64"));

vi.mock("@/db", () => ({ getDb: () => state.db }));
vi.mock("next/cache", () => ({ cacheLife: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (state.jar.has(name) ? { name, value: state.jar.get(name)! } : undefined),
    set: (name: string, value: string) => state.jar.set(name, value),
  }),
  headers: async () => new Headers({ "x-forwarded-proto": "https" }),
}));

const { loadStanfordIntro, startStanfordGame } = await import("./stanford");
const { actOnGame, loadGame, startPracticeGame } = await import("./games");
const { GAME_LIMITS } = await import("./limits");

const root = fileURLToPath(new URL("../..", import.meta.url));
let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

const puzzle = (id: string, file: string, answer: string): Puzzle => ({
  id,
  // A private puzzle's original sits next to its content file (images/…), never in public/.
  imageUrl: `images/${file}.jpg`,
  answer,
  acceptedAnswers: [],
  reveal: { focus: { x: 0.5, y: 0.5 }, zoomLevels: [8, 4, 2, 1] },
  credit: { source: "Test Photographer", license: "CC BY 4.0", url: "https://photos.example.com/test" },
  aiSolvedLevel: null,
});
const PUZZLES = [puzzle("pz-s1", "pz-dbdb4dee", "Fake Spot One"), puzzle("pz-s2", "pz-683182e7", "Fake Spot Two")];
const PACK: Pack = {
  id: "pk-s-test",
  kind: "stanford",
  title: "Stanford (test)",
  theme: "Fake campus spots",
  puzzleIds: PUZZLES.map((p) => p.id),
};

function ok(result: { ok: boolean; view?: GameView; error?: string }): GameView {
  if (!result.ok) throw new Error(`expected a game, got ${result.error}`);
  return result.view!;
}
const gameCount = async () => Number((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM games")).rows[0]!.n);

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle({ client: pg, schema });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
  state.db = db;
}, 60_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await pg.close();
});

beforeEach(async () => {
  state.jar = new Map(); // a new player for each test
  await pg.exec("DELETE FROM rate_limits;");
});

describe("Stanford mode before its pack is loaded", () => {
  it("says it isn't loaded (not broken), and starting creates no game", async () => {
    expect(await loadStanfordIntro()).toEqual({ pack: null });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await startStanfordGame()).toEqual({ ok: false, error: "unavailable" });
    log.mockRestore();
    expect(await gameCount()).toBe(0);
  });
});

describe("Stanford mode with a pack loaded", () => {
  beforeAll(async () => {
    await seedContent(db, combineContent([{ source: "t", content: { puzzles: PUZZLES, packs: [PACK], schedule: [] } }]));
    // The stand-in originals are the practice photos in public/puzzles/.
    await cutPuzzleImages(db, PUZZLES, (p) => join(root, "public", "puzzles", p.imageUrl.replace("images/", "")));
  }, 60_000);

  it("shows the pack's title, theme and number of images only", async () => {
    expect(await loadStanfordIntro()).toEqual({
      pack: { title: "Stanford (test)", theme: "Fake campus spots", puzzleCount: 2 },
    });
  });

  it("plays the Stanford pack from level images, with no answer or credit until the round ends, then the credit", async () => {
    let view = ok(await startStanfordGame());
    expect(view.pack).toMatchObject({ kind: "stanford", theme: "Fake campus spots" });
    expect(view.round!.imageSrc).toMatch(/^\/img\/[0-9a-f]{32}\.webp$/u);
    expect(view.round).not.toHaveProperty("credit");
    expect(JSON.stringify(view).toLowerCase()).not.toMatch(/fake spot|test photographer|\/puzzles\/|images\/pz-/u);

    view = ok(await actOnGame(view.gameId, { type: "guess", guess: "fake spot one" }, view.revision));
    expect(view.round).toMatchObject({
      state: "correct",
      answer: "Fake Spot One",
      credit: { source: "Test Photographer", license: "CC BY 4.0", url: "https://photos.example.com/test" },
    });
    expect(ok(await loadGame(view.gameId)).round!.state).toBe("correct");
  }, 60_000);

  it("reuses an untouched game (a refresh) instead of creating a row, and starts a new one after a finished game", async () => {
    let view = ok(await startStanfordGame());
    const rows = await gameCount();
    expect(ok(await startStanfordGame()).gameId).toBe(view.gameId);
    expect(await gameCount()).toBe(rows);

    for (let i = 0; i < PUZZLES.length; i++) {
      view = ok(await actOnGame(view.gameId, { type: "skip" }, view.revision));
      view = ok(await actOnGame(view.gameId, { type: "next" }, view.revision));
    }
    expect(view.finished).toBe(true);
    expect(ok(await startStanfordGame()).gameId).not.toBe(view.gameId); // Play again
  }, 60_000);

  it("doesn't mix with practice: each mode has its own game", async () => {
    const stanford = ok(await startStanfordGame());
    const practice = ok(await startPracticeGame());
    expect(practice.gameId).not.toBe(stanford.gameId);
    expect(practice.pack.kind).toBe("practice");
  }, 60_000);

  it("plays with the pack's own scoring (#64)", async () => {
    try {
      const basePoints = SCORING_CONFIG.basePoints + 50;
      await setPackScoring(db, PACK.id, { basePoints });
      expect(ok(await startStanfordGame()).round!.pointsAvailable).toBe(basePoints);
    } finally {
      await setPackScoring(db, PACK.id, null);
    }
  }, 60_000);

  describe("rate limits (#85)", () => {
    const T0 = new Date("2026-11-17T12:00:00Z");
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"], now: T0 });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("counts Stanford starts toward the same per-player start limit as practice", async () => {
      ok(await startPracticeGame());
      for (let i = 1; i < GAME_LIMITS.startsPerOwner.max; i++) ok(await startStanfordGame());
      expect(await startStanfordGame()).toEqual({ ok: false, error: "rate-limited" });
      expect(await startPracticeGame()).toEqual({ ok: false, error: "rate-limited" });

      vi.setSystemTime(T0.getTime() + GAME_LIMITS.startsPerOwner.windowMs);
      expect((await startStanfordGame()).ok).toBe(true);
    }, 60_000);
  });
});
