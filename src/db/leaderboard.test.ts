// Spec for the daily leaderboard (#62): per day, the top players by their
// server-calculated total, plus your own rank. Only logged-in players' finished
// games of that day's daily count, one per player (the database allows only
// one). Shows usernames only. Real migrations on PGlite, and real games played
// through the game service with the app's store settings.
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { newUserRow } from "@/auth/user-row";
import { Vault } from "@/crypto/vault";
import { combineContent } from "@/game/packs";
import { START_GRACE_SECONDS } from "@/game/round";
import { act, getGame, puzzleSourceFrom, startGame, startOrResumeDaily, type GameDeps, type GameOwner } from "@/game/server-game";
import type { Pack, Puzzle, TimedScoringConfig } from "@/game/types";

import { seedContent } from "./content";
import { PgGameStore } from "./games";
import type { Db } from "./index";
import { getDailyRank, getDailyTop, LEADERBOARD_SIZE } from "./leaderboard";
import * as schema from "./schema";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

let pg: PGlite;
let db: Db;
let deps: GameDeps;
const vault = new Vault(Buffer.alloc(32, 6));

const CONFIG: TimedScoringConfig = { maxPoints: 10_000, minPoints: 100, revealSeconds: 25, limitSeconds: 30, curve: 2 };
const AT_0 = 10_000; // a correct guess at 0 s
const AT_2 = 8_479; // at 2 s: 100 + 9,900 × (1 − 2/25)²

/** The server's clock, moved by hand (ms). */
let now = Date.UTC(2026, 10, 17, 12);
const puzzle = (id: string, answer: string, aiSolvedLevel: number | null): Puzzle => ({
  id,
  imageUrl: `https://images.example.com/${id}.jpg`,
  answer,
  acceptedAnswers: [],
  reveal: { focus: { x: 0.5, y: 0.5 }, zoomLevels: [8, 4, 2, 1] },
  credit: { source: "Someone", license: "CC0" },
  aiSolvedLevel,
});
// The AI got image 1 at level 1 (one zoom-out) and never got image 2.
const PUZZLES = [puzzle("lb-1", "Kiwi", 1), puzzle("lb-2", "Lychee", null), puzzle("lb-p", "Mango", null)];
const DAILY: Pack = { id: "lb-daily", kind: "daily", title: "Fruit", theme: "Fruit", puzzleIds: ["lb-1", "lb-2"] };
const PRACTICE: Pack = { id: "lb-practice", kind: "practice", title: "Practice", theme: "Practice", puzzleIds: ["lb-p"] };
const DAY = "2026-11-17";

const userIds = new Map<string, string>();
async function user(name: string): Promise<GameOwner> {
  const row = newUserRow(vault, name, "not-a-real-hash");
  await db.insert(schema.users).values(row);
  userIds.set(name, row.id);
  return { userId: row.id };
}
const anon = (name: string): GameOwner => ({ anonId: createHash("sha256").update(name).digest("hex") });

/** Play a whole daily: per image, the seconds to the right answer, or "out" for a time-out. */
async function play(owner: GameOwner, date: string, perImage: (number | "out")[], finish = true) {
  let view = await startOrResumeDaily(deps, DAILY, date, owner, CONFIG);
  for (const [i, move] of perImage.entries()) {
    view = await act(deps, view.gameId, owner, { type: "start" }, view.revision);
    if (move === "out") {
      now += (CONFIG.limitSeconds + 1) * 1000;
      view = await getGame(deps, view.gameId, owner);
    } else {
      now += (move + START_GRACE_SECONDS) * 1000;
      const answer = PUZZLES.find((p) => p.id === DAILY.puzzleIds[i])!.answer;
      view = await act(deps, view.gameId, owner, { type: "guess", guess: answer }, view.revision);
    }
    if (i < perImage.length - 1 || finish) view = await act(deps, view.gameId, owner, { type: "next" }, view.revision);
  }
  return view;
}

beforeAll(async () => {
  pg = new PGlite();
  const pglite = drizzle({ client: pg, schema });
  await migrate(pglite, { migrationsFolder });
  db = pglite as unknown as Db;
  await seedContent(pglite, combineContent([{ source: "test", content: { puzzles: PUZZLES, packs: [DAILY, PRACTICE], schedule: [] } }]));
  deps = { games: new PgGameStore(db, vault, { recordRounds: (s) => s.pack.kind !== "practice" }), puzzles: puzzleSourceFrom(PUZZLES), now: () => now };

  // Bob: right at once on both. Total 2 × AT_0.
  await play(await user("Bob"), DAY, [0, 0]);
  // Alice and Cara tie: right at 2 s, then right at once. Total AT_2 + AT_0.
  await play(await user("Alice"), DAY, [2, 0]);
  await play(await user("cara_99"), DAY, [2, 0]);
  // Dan: both time out. Total 0.
  await play(await user("Dan"), DAY, ["out", "out"]);
  // Not on the board: Erin is still playing, an anonymous player, Gus on another
  // day, and Hal only played practice.
  await play(await user("Erin"), DAY, [0], false);
  await play(anon("anon"), DAY, [0, 0]);
  await play(await user("Gus"), "2026-11-18", [0, 0]);
  const hal = await user("Hal");
  let practice = await startGame(deps, PRACTICE, hal, CONFIG);
  practice = await act(deps, practice.gameId, hal, { type: "start" }, practice.revision);
  await act(deps, practice.gameId, hal, { type: "guess", guess: "Mango" }, practice.revision);
}, 60_000);

afterAll(async () => {
  await pg.close();
});

describe("getDailyTop", () => {
  it("ranks the day's finished, logged-in games by score; a tie shares a rank and the next rank skips", async () => {
    const { top, players } = await getDailyTop(db, vault, DAY);
    expect(top.map(({ rank, username, score }) => ({ rank, username, score }))).toEqual([
      { rank: 1, username: "Bob", score: 2 * AT_0 },
      { rank: 2, username: "Alice", score: AT_2 + AT_0 },
      { rank: 2, username: "cara_99", score: AT_2 + AT_0 },
      { rank: 4, username: "Dan", score: 0 },
    ]);
    expect(players).toBe(4);
  });

  it("returns only LeaderboardEntry fields: no user ids or other user data", async () => {
    const { top } = await getDailyTop(db, vault, DAY);
    for (const entry of top) expect(Object.keys(entry).sort()).toEqual(["beatAiCount", "rank", "score", "username"]);
    expect(JSON.stringify(top)).not.toContain(userIds.get("Bob"));
  });

  it("counts no Beat the AI wins for timed rounds, which have no zoom level, until it compares solve times (#257)", async () => {
    const { top } = await getDailyTop(db, vault, DAY);
    // Bob got image 1 at once, but a timed round has no reveal_level_reached to compare with the AI's level.
    expect(Object.fromEntries(top.map((e) => [e.username, e.beatAiCount]))).toEqual({ Bob: 0, Alice: 0, cara_99: 0, Dan: 0 });
  });

  it(`shows at most ${LEADERBOARD_SIZE} players`, async () => {
    const day = "2026-11-20";
    for (let i = 0; i < LEADERBOARD_SIZE + 2; i++) await play(await user(`p${i}`), day, i % 2 ? [0, "out"] : ["out", "out"]);
    const { top, players } = await getDailyTop(db, vault, day);
    expect(top).toHaveLength(LEADERBOARD_SIZE);
    expect(players).toBe(LEADERBOARD_SIZE + 2);
    expect(top[0]).toMatchObject({ rank: 1, score: AT_0 });
    // The cut can fall inside a tie (intended): six players share rank 1 and six
    // share rank 7, so only the first four rank-7 players to finish are listed.
    // The others still get "Your rank: 7" from getDailyRank.
    expect(top.map((e) => e.rank)).toEqual([1, 1, 1, 1, 1, 1, 7, 7, 7, 7]);
    expect(top.map((e) => e.username)).not.toContain("p10");
    expect(await getDailyRank(db, vault, day, userIds.get("p10")!)).toMatchObject({ entry: { rank: 7, username: "p10" }, players: LEADERBOARD_SIZE + 2 });
  });

  it("has one entry per player: starting the day's daily again resumes it, not adds one", async () => {
    const bob = { userId: userIds.get("Bob")! };
    const again = await startOrResumeDaily(deps, DAILY, DAY, bob, CONFIG);
    expect(again.finished).toBe(true);
    const { top, players } = await getDailyTop(db, vault, DAY);
    expect(players).toBe(4);
    expect(top.filter((e) => e.username === "Bob")).toHaveLength(1);
  });

  it("is empty for a day nobody finished", async () => {
    expect(await getDailyTop(db, vault, "2026-01-01")).toEqual({ top: [], players: 0 });
  });

  it("shows a name that doesn't decrypt (another tier's key) as unknown, and doesn't throw", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { top } = await getDailyTop(db, new Vault(Buffer.alloc(32, 7)), DAY);
    expect(top.map((e) => e.username)).toEqual(Array(4).fill("Unknown player"));
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });
});

describe("getDailyRank", () => {
  it("is your own entry, ranked the same way as the top list, and the day's player count", async () => {
    expect(await getDailyRank(db, vault, DAY, userIds.get("cara_99")!)).toEqual({
      entry: { rank: 2, username: "cara_99", score: AT_2 + AT_0, beatAiCount: 0 },
      players: 4,
    });
    expect(await getDailyRank(db, vault, DAY, userIds.get("Dan")!)).toEqual({
      entry: { rank: 4, username: "Dan", score: 0, beatAiCount: 0 },
      players: 4,
    });
  });

  it("counts the players fresh, so it never disagrees with your own rank", async () => {
    // The top list is cached for about a minute; this count isn't. A player who
    // just finished is counted at once.
    const day = "2026-11-21";
    expect((await getDailyTop(db, vault, day)).players).toBe(0);
    await play(await user("Ivy"), day, [0, 0]);
    expect(await getDailyRank(db, vault, day, userIds.get("Ivy")!)).toMatchObject({ entry: { rank: 1 }, players: 1 });
  });

  it("is null without a finished game that day", async () => {
    expect(await getDailyRank(db, vault, DAY, userIds.get("Erin")!)).toBeNull(); // still playing
    expect(await getDailyRank(db, vault, DAY, userIds.get("Gus")!)).toBeNull(); // another day
    expect(await getDailyRank(db, vault, DAY, userIds.get("Hal")!)).toBeNull(); // practice only
  });

  it("is null for an id that isn't a uuid, without a database error", async () => {
    expect(await getDailyRank(db, vault, DAY, "not-a-uuid")).toBeNull();
  });
});
