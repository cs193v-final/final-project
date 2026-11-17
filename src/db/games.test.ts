// The Postgres GameStore (#54) on an in-memory Postgres (PGlite) with the
// committed migrations applied, so it runs against the real `games` and
// `game_rounds` tables. No network.
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CONTRACT_PUZZLES, describeGameStoreContract } from "@/game/game-store-contract";
import { act, getGame, puzzleSourceFrom, startGame, type GameDeps, type GameOwner } from "@/game/server-game";
import type { GameAction } from "@/game/types";
import type { Pack, ScoringConfig } from "@/game/types";

import { ensurePackRow, PgGameStore } from "./games";
import type { Db } from "./index";
import * as schema from "./schema";

/** Plays a move on the game as it is now (reads its current revision first), for tests about other things than stale tabs. */
async function playNow(deps: GameDeps, gameId: string, owner: GameOwner, action: GameAction) {
  const { revision } = await getGame(deps, gameId, owner);
  return act(deps, gameId, owner, action, revision);
}


const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

let pg: PGlite;
let db: Db;
let alice: GameOwner;
const anon = (token: string): GameOwner => ({ anonId: createHash("sha256").update(token).digest("hex") });
const bob = anon("bob's cookie token");

const PACK: Pack = {
  id: "pk_test_practice",
  kind: "practice",
  title: "Practice",
  theme: "Mixed",
  puzzleIds: CONTRACT_PUZZLES.map((p) => p.id),
};
const CONFIG: ScoringConfig = { basePoints: 100, revealPenalty: 20, wrongGuessPenalty: 10, minPoints: 10, skipPoints: 0 };

beforeAll(async () => {
  pg = new PGlite();
  const pglite = drizzle({ client: pg, schema });
  await migrate(pglite, { migrationsFolder });
  db = pglite as unknown as Db;
  const { rows } = await pg.query<{ id: string }>(
    "INSERT INTO users (username, password_hash) VALUES ('alice', 'hash') RETURNING id",
  );
  alice = { userId: rows[0]!.id };
  await ensurePackRow(db, PACK);
  // The contract puzzles, so game_rounds rows (foreign key to puzzles) can be written.
  for (const p of CONTRACT_PUZZLES) {
    await pg.query(
      `INSERT INTO puzzles (id, answer, image_url, focus_x, focus_y, zoom_levels, credit_source, credit_license)
       VALUES ($1, $2, $3, $4, $5, $6, 'Source', 'License')`,
      [p.id, p.answer, p.imageUrl, p.reveal.focus.x, p.reveal.focus.y, p.reveal.zoomLevels],
    );
  }
}, 60_000);

afterAll(async () => {
  await pg.close();
});

describeGameStoreContract("PgGameStore (PGlite)", async () => ({
  store: new PgGameStore(db),
  alice,
  bob,
  packId: PACK.id,
  missingId: "00000000-0000-4000-8000-000000000000",
}));

type GameColumns = {
  user_id: string | null;
  anon_owner_hash: string | null;
  revision: number;
  total: number;
  finished_at: Date | null;
};

async function columns(id: string): Promise<GameColumns> {
  const { rows } = await pg.query<GameColumns>(
    "SELECT user_id, anon_owner_hash, revision, total, finished_at FROM games WHERE id = $1",
    [id],
  );
  return rows[0]!;
}

type RoundRow = { position: number; puzzle_id: string; outcome: string; points: number };

async function roundRows(id: string) {
  const { rows } = await pg.query<RoundRow>(
    `SELECT position, puzzle_id, outcome, reveal_level_reached, wrong_guesses, points,
            base_points, reveal_penalty, wrong_guess_penalty
     FROM game_rounds WHERE game_id = $1 ORDER BY position`,
    [id],
  );
  return rows;
}

function deps(store: PgGameStore): GameDeps {
  return { games: store, puzzles: puzzleSourceFrom(CONTRACT_PUZZLES) };
}

describe("PgGameStore columns", () => {
  it("maps a user owner to user_id and an anonymous owner to anon_owner_hash", async () => {
    const store = new PgGameStore(db);
    const mine = await startGame(deps(store), PACK, alice, CONFIG);
    const theirs = await startGame(deps(store), PACK, bob, CONFIG);
    expect(await columns(mine.gameId)).toMatchObject({ user_id: "userId" in alice && alice.userId, anon_owner_hash: null });
    expect(await columns(theirs.gameId)).toMatchObject({
      user_id: null,
      anon_owner_hash: "anonId" in bob && bob.anonId,
    });
  });

  it("refuses an anonymous id that isn't a SHA-256 hex digest, so a raw cookie token is never stored", async () => {
    const store = new PgGameStore(db);
    await expect(startGame(deps(store), PACK, { anonId: "raw-cookie-token" }, CONFIG)).rejects.toThrow(/SHA-256/);
    await expect(startGame(deps(store), PACK, { userId: "alice" }, CONFIG)).rejects.toThrow(/uuid/);
  });

  it("keeps total and finished_at in sync with the state, and writes each finished round once", async () => {
    const store = new PgGameStore(db);
    const d = deps(store);
    let view = await startGame(d, PACK, alice, CONFIG);
    const id = view.gameId;
    expect(await columns(id)).toMatchObject({ revision: 0, total: 0, finished_at: null });

    view = await playNow(d, id, alice, { type: "reveal" });
    view = await playNow(d, id, alice, { type: "guess", guess: "zzz wrong" });
    view = await playNow(d, id, alice, { type: "guess", guess: CONTRACT_PUZZLES[0]!.answer });
    expect(view.total).toBe(70);
    expect(await columns(id)).toMatchObject({ revision: 3, total: 70, finished_at: null });
    expect(await roundRows(id)).toEqual([
      {
        position: 1,
        puzzle_id: "p1",
        outcome: "correct",
        reveal_level_reached: 1,
        wrong_guesses: 1,
        points: 70,
        base_points: 100,
        reveal_penalty: 20,
        wrong_guess_penalty: 10,
      },
    ]);

    for (let i = 1; i < CONTRACT_PUZZLES.length; i++) {
      await playNow(d, id, alice, { type: "next" });
      view = await playNow(d, id, alice, { type: "skip" });
    }
    expect(await columns(id)).toMatchObject({ total: 70, finished_at: null });
    view = await playNow(d, id, alice, { type: "next" });
    expect(view.finished).toBe(true);

    const finished = await columns(id);
    expect(finished.finished_at).toBeInstanceOf(Date);
    expect((await roundRows(id)).map((r) => [r.position, r.puzzle_id, r.outcome, r.points])).toEqual([
      [1, "p1", "correct", 70],
      [2, "p2", "skipped", 0],
      [3, "p3", "skipped", 0],
    ]);
  });

  it("writes no game_rounds rows when recordRounds is off (puzzles not in the database yet, #52)", async () => {
    const store = new PgGameStore(db, { recordRounds: false });
    const d = deps(store);
    const { gameId } = await startGame(d, PACK, bob, CONFIG);
    const view = await playNow(d, gameId, bob, { type: "skip" });
    expect(view.results).toHaveLength(1);
    expect(await roundRows(gameId)).toEqual([]);
    expect(await columns(gameId)).toMatchObject({ revision: 1, total: 0 });
  });

  it("stores no answers in the games table", async () => {
    const store = new PgGameStore(db);
    const d = deps(store);
    const { gameId } = await startGame(d, PACK, alice, CONFIG);
    await playNow(d, gameId, alice, { type: "guess", guess: "zzz wrong" });
    const { rows } = await pg.query<{ row: string }>("SELECT row_to_json(g)::text AS row FROM games g WHERE id = $1", [gameId]);
    const json = rows[0]!.row.toLowerCase();
    for (const p of CONTRACT_PUZZLES) {
      for (const answer of [p.answer, ...p.acceptedAnswers]) expect(json).not.toContain(answer.toLowerCase());
    }
  });
});

describe("ensurePackRow", () => {
  it("inserts a code-defined pack once and never overwrites it", async () => {
    const pack = { ...PACK, id: "pk_ensure_test" };
    await ensurePackRow(db, pack);
    await ensurePackRow(db, { ...pack, title: "Changed" });
    const { rows } = await pg.query("SELECT id, kind, title, theme FROM packs WHERE id = $1", [pack.id]);
    expect(rows).toEqual([{ id: "pk_ensure_test", kind: "practice", title: "Practice", theme: "Mixed" }]);
  });
});
