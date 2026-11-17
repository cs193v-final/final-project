// The daily on the server (#58), end to end minus HTTP: the owner cookie
// (next/headers, stubbed), today's pack from the schedule, the cut images
// (#57 follow-up), the game service, the Postgres store and the stats, on
// PGlite with the real migrations. Uses the practice photos under other ids
// as stand-ins for a private daily.
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { seedContent } from "@/db/content";
import * as schema from "@/db/schema";
import { dailyDateFor } from "@/game/daily-date";
import { combineContent } from "@/game/packs";
import type { GameView, Pack, Puzzle } from "@/game/types";

import { cutPuzzleImages } from "../../scripts/cut-images-core.ts";

const state = vi.hoisted(() => ({ db: undefined as unknown, jar: new Map<string, string>() }));

vi.mock("@/db", () => ({ getDb: () => state.db }));
vi.mock("next/cache", () => ({ cacheLife: () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (state.jar.has(name) ? { name, value: state.jar.get(name)! } : undefined),
    set: (name: string, value: string) => state.jar.set(name, value),
  }),
  headers: async () => new Headers({ "x-forwarded-proto": "https" }),
}));

const { startTodaysDaily, loadTodaysDailyGame, loadTodaysDailyStats, loadDailyIntro } = await import("./daily");
const { actOnGame } = await import("./games");

const root = fileURLToPath(new URL("../..", import.meta.url));
let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

const puzzle = (id: string, file: string, answer: string): Puzzle => ({
  id,
  imageUrl: `/puzzles/${file}.jpg`,
  answer,
  acceptedAnswers: [],
  reveal: { focus: { x: 0.5, y: 0.5 }, zoomLevels: [8, 4, 2, 1] },
  credit: { source: "Someone", license: "CC BY-SA 4.0" },
  aiSolvedLevel: null,
});
const PUZZLES = [puzzle("pz-d1", "pz-dbdb4dee", "Giraffe"), puzzle("pz-d2", "pz-683182e7", "Strawberry")];
const today = dailyDateFor(new Date());
const PACK: Pack = { id: "pk-d", kind: "daily", title: "Mixed", theme: "Mixed bag", puzzleIds: PUZZLES.map((p) => p.id) };

async function asPlayer(cookies: Map<string, string>) {
  state.jar = cookies;
}
function ok(result: { ok: boolean; view?: GameView; error?: string }): GameView {
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`);
  return result.view!;
}

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle({ client: pg, schema });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
  state.db = db;
  await seedContent(db, combineContent([{ source: "t", content: { puzzles: PUZZLES, packs: [PACK], schedule: [{ date: today, packId: PACK.id }] } }]));
}, 60_000);

afterAll(async () => {
  await pg.close();
});

beforeEach(() => {
  state.jar = new Map();
});

describe("the daily on the server", () => {
  it("shows today's intro, with the theme and count only", async () => {
    expect(await loadDailyIntro()).toMatchObject({ date: today, pack: { theme: "Mixed bag", puzzleCount: 2 } });
  });

  it("refuses to start a private daily whose images aren't cut yet, rather than send the full photo", async () => {
    const result = await startTodaysDaily();
    expect(result).toEqual({ ok: false, error: "unavailable" });
    expect(Number((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM games")).rows[0]!.n)).toBe(0);
  });

  it("once cut: plays from the level-0 image only, resumes, and never starts a second game", async () => {
    const report = await cutPuzzleImages(db, { root });
    expect(report.failed).toEqual([]);

    const alice = new Map<string, string>();
    await asPlayer(alice);
    let view = ok(await startTodaysDaily());
    expect(view.round!.imageSrc).toMatch(/^\/img\/[0-9a-f]{32}\.webp$/u);
    expect(view.round).not.toHaveProperty("reveal");
    expect(JSON.stringify(view).toLowerCase()).not.toMatch(/giraffe|strawberry|\/puzzles\//u);

    view = ok(await actOnGame(view.gameId, { type: "reveal" }));
    const level1 = view.round!.imageSrc;
    expect(level1).toMatch(/^\/img\//u);

    // Coming back: the same game, where it was. Starting again resumes it.
    expect(ok((await loadTodaysDailyGame())!).round!.imageSrc).toBe(level1);
    expect(ok(await startTodaysDaily()).gameId).toBe(view.gameId);
  }, 60_000);

  it("gives stats only for your own finished game, against other finished players", async () => {
    const play = async (cookies: Map<string, string>, guessFirst: boolean) => {
      await asPlayer(cookies);
      let view = ok(await startTodaysDaily());
      view = ok(await actOnGame(view.gameId, guessFirst ? { type: "guess", guess: "Giraffe" } : { type: "skip" }));
      view = ok(await actOnGame(view.gameId, { type: "next" }));
      view = ok(await actOnGame(view.gameId, { type: "skip" }));
      return ok(await actOnGame(view.gameId, { type: "next" }));
    };
    const bob = new Map<string, string>();
    const cara = new Map<string, string>();
    expect((await play(bob, true)).finished).toBe(true);

    await asPlayer(cara);
    expect(await loadTodaysDailyStats()).toBeNull(); // hasn't played
    await play(cara, false);
    expect(await loadTodaysDailyStats()).toEqual({
      rounds: [
        { position: 1, others: 1, beaten: 0 }, // skipped vs Bob's 100
        { position: 2, others: 1, beaten: 0 }, // both skipped: a tie
      ],
      others: 1,
      beatenTotal: 0,
    });
    await asPlayer(bob);
    expect((await loadTodaysDailyStats())!.rounds[0]).toEqual({ position: 1, others: 1, beaten: 1 });
  }, 60_000);
});
