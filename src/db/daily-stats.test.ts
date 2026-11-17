// Spec for the daily result's per-image stats (#58): "you did better than X%
// of players" counts only other players' *finished* games of the same daily,
// image by image and in total. Real migrations on PGlite, and real games
// played through the game service with the app's store settings.
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { combineContent } from "@/game/packs";
import { act, puzzleSourceFrom, startGame, startOrResumeDaily, type GameDeps, type GameOwner } from "@/game/server-game";
import type { GameAction, Pack, Puzzle, ScoringConfig } from "@/game/types";

import { seedContent } from "./content";
import { betterThanPercent, getDailyStats } from "./daily-stats";
import { PgGameStore } from "./games";
import type { Db } from "./index";
import * as schema from "./schema";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

let pg: PGlite;
let db: Db;
let deps: GameDeps;

const CONFIG: ScoringConfig = { basePoints: 100, revealPenalty: 20, wrongGuessPenalty: 10, minPoints: 10, skipPoints: 0 };
const puzzle = (id: string, answer: string): Puzzle => ({
  id,
  imageUrl: `https://images.example.com/${id}.jpg`,
  answer,
  acceptedAnswers: [],
  reveal: { focus: { x: 0.5, y: 0.5 }, zoomLevels: [8, 4, 2, 1] },
  credit: { source: "Someone", license: "CC0" },
  aiSolvedLevel: null,
});
const PUZZLES = [puzzle("pz-s1", "Kiwi"), puzzle("pz-s2", "Lychee"), puzzle("pz-o1", "Mango")];
const TODAY: Pack = { id: "pk-today", kind: "daily", title: "Fruit", theme: "Fruit", puzzleIds: ["pz-s1", "pz-s2"] };
const OTHER: Pack = { id: "pk-other", kind: "daily", title: "Fruit", theme: "Fruit", puzzleIds: ["pz-s1", "pz-s2"] };
const owner = (name: string): GameOwner => ({ anonId: createHash("sha256").update(name).digest("hex") });

/** Play a whole daily: per image, the moves before it's over ("correct" = guess the answer). */
async function play(pack: Pack, date: string, who: string, perImage: GameAction["type"][][], finish = true) {
  const me = owner(who);
  let view = await startOrResumeDaily(deps, pack, date, me, CONFIG);
  for (const [i, moves] of perImage.entries()) {
    for (const move of moves) {
      const answer = PUZZLES.find((p) => p.id === pack.puzzleIds[i])!.answer;
      view = await act(deps, view.gameId, me, move === "guess" ? { type: "guess", guess: answer } : ({ type: move } as GameAction), view.revision);
    }
    if (i < perImage.length - 1 || finish) view = await act(deps, view.gameId, me, { type: "next" }, view.revision);
  }
  return view;
}

let alice: string;

beforeAll(async () => {
  pg = new PGlite();
  const pglite = drizzle({ client: pg, schema });
  await migrate(pglite, { migrationsFolder });
  db = pglite as unknown as Db;
  await seedContent(
    pglite,
    combineContent([{ source: "test", content: { puzzles: PUZZLES, packs: [TODAY, OTHER, { ...OTHER, id: "pk-p", kind: "practice", puzzleIds: ["pz-o1"] }], schedule: [] } }]),
  );
  // The app's settings: rounds are recorded for every pack but practice.
  deps = { games: new PgGameStore(db, { recordRounds: (s) => s.pack.kind !== "practice" }), puzzles: puzzleSourceFrom(PUZZLES) };

  // Alice: image 1 at the tightest crop (100), skips image 2 (0). Total 100.
  alice = (await play(TODAY, "2026-11-17", "alice", [["guess"], ["skip"]])).gameId;
  // Bob: one zoom-out then right (80), right at once (100). Total 180.
  await play(TODAY, "2026-11-17", "bob", [["reveal", "guess"], ["guess"]]);
  // Cara: skips image 1 (0), two zoom-outs then right (60). Total 60.
  await play(TODAY, "2026-11-17", "cara", [["skip"], ["reveal", "reveal", "guess"]]);
  // Dan is still playing (image 1 right, not finished): doesn't count.
  await play(TODAY, "2026-11-17", "dan", [["guess"]], false);
  // Someone played a different daily and a practice pack: don't count either.
  await play(OTHER, "2026-11-18", "erin", [["skip"], ["skip"]]);
  // Gus played the SAME pack on another day (a reused pack). He knew nothing
  // Alice didn't, but he isn't one of "the players who finished today", so he
  // must not count (review of #121): he'd add one to every count below.
  await play(TODAY, "2026-11-18", "gus", [["skip"], ["skip"]]);
  await startGame(deps, { ...OTHER, id: "pk-p", kind: "practice", puzzleIds: ["pz-o1"] }, owner("erin"), CONFIG);
}, 60_000);

afterAll(async () => {
  await pg.close();
});

describe("getDailyStats", () => {
  it("compares each image with the other players who finished the same daily", async () => {
    expect(await getDailyStats(db, alice)).toEqual({
      rounds: [
        { position: 1, others: 2, beaten: 2 }, // 100 beats Bob's 80 and Cara's 0
        { position: 2, others: 2, beaten: 0 }, // 0 beats nobody
      ],
      others: 2,
      beatenTotal: 1, // 100 beats Cara's 60, not Bob's 180
    });
  });

  it("counts ties as not beaten", async () => {
    const bob = await play(TODAY, "2026-11-17", "bob2", [["reveal", "guess"], ["guess"]]); // same as Bob: 80 and 100
    const stats = await getDailyStats(db, bob.gameId);
    expect(stats.rounds[0]).toEqual({ position: 1, others: 3, beaten: 1 }); // beats Cara's 0, ties Bob, loses to Alice
    expect(stats.beatenTotal).toBe(2); // beats Alice's 100 and Cara's 60; ties Bob's 180
  });

  it("is empty-handed, not wrong, for the first finisher of a day", async () => {
    // Erin finished the same pack on Nov 18; Fay plays it on Nov 19, so nobody else played her day.
    const first = await play(OTHER, "2026-11-19", "fay", [["guess"], ["guess"]]);
    expect(await getDailyStats(db, first.gameId)).toEqual({ rounds: [{ position: 1, others: 0, beaten: 0 }, { position: 2, others: 0, beaten: 0 }], others: 0, beatenTotal: 0 });
  });

  it("only counts the same day's players, even for the same pack (Gus played it on Nov 18)", async () => {
    const gus = await getDailyStats(db, (await play(TODAY, "2026-11-18", "gus", [])).gameId);
    expect(gus.others).toBe(0); // Alice, Bob, Cara and Dan played Nov 17
  });

  it("keeps the overall count and the per-image counts to the same players", async () => {
    // A finished game with no recorded rounds (e.g. finished before rounds were recorded) counts in neither.
    const { rows } = await pg.query<{ id: string }>(
      "INSERT INTO games (pack_id, anon_owner_hash, state, finished_at, total, daily_date) VALUES ('pk-today', $1, '{}', now(), 500, '2026-11-17') RETURNING id",
      [createHash("sha256").update("hank").digest("hex")],
    );
    expect(rows[0]).toBeDefined();
    const stats = await getDailyStats(db, alice);
    expect(stats.others).toBe(stats.rounds[0]!.others);
    await pg.query("DELETE FROM games WHERE id = $1", [rows[0]!.id]);
  });

  it("writes no game_rounds for practice games, and does for daily ones", async () => {
    const { rows } = await pg.query<{ kind: string; n: number }>(
      `SELECT p.kind, count(r.*)::int AS n FROM games g JOIN packs p ON p.id = g.pack_id
       LEFT JOIN game_rounds r ON r.game_id = g.id GROUP BY p.kind ORDER BY p.kind`,
    );
    expect(rows.find((r) => r.kind === "practice")!.n).toBe(0);
    expect(rows.find((r) => r.kind === "daily")!.n).toBeGreaterThan(0);
  });
});

describe("betterThanPercent", () => {
  it.each([
    [2, 2, 100],
    [1, 2, 50],
    [2, 3, 66],
    [0, 5, 0],
  ])("%i of %i → %i%%", (beaten, others, pct) => {
    expect(betterThanPercent(beaten, others)).toBe(pct);
  });

  it("has no percentage when nobody else has finished", () => {
    expect(betterThanPercent(0, 0)).toBeNull();
  });
});
