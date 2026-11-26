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
import { act, GameConflictError, GameNotFoundError, GameUnreadableError, getGame, puzzleSourceFrom, startGame, type GameDeps, type GameOwner, type GameState } from "@/game/server-game";
import type { GameAction } from "@/game/types";
import type { Pack, TimedScoringConfig } from "@/game/types";
import { START_GRACE_SECONDS } from "@/game/round";
import { scoreAt } from "@/game/scoring";

import { Vault } from "@/crypto/vault";

import { ensurePackRow, PgGameStore, STATE_FIELD, stateKeyId } from "./games";
import type { Db } from "./index";
import * as schema from "./schema";

const vault = new Vault(Buffer.alloc(32, 7));

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
const CONFIG: TimedScoringConfig = { maxPoints: 10_000, minPoints: 100, revealSeconds: 25, limitSeconds: 30, curve: 2 };

/** The server's clock for these games, moved by hand (ms). */
let now = Date.UTC(2030, 0, 1, 12);
const advance = (seconds: number) => (now += seconds * 1000);

beforeAll(async () => {
  pg = new PGlite();
  const pglite = drizzle({ client: pg, schema });
  await migrate(pglite, { migrationsFolder });
  db = pglite as unknown as Db;
  const { rows } = await pg.query<{ id: string }>(
    // Usernames are stored encrypted with a keyed-hash index (#84); placeholders are enough here.
    "INSERT INTO users (username_encrypted, username_index, password_hash) VALUES ('v1.encrypted', 'index-alice', 'hash') RETURNING id",
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
  store: new PgGameStore(db, vault),
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

type RoundRow = { position: number; puzzle_id: string; outcome: string; seconds: number | null; points: number };

async function roundRows(id: string) {
  const { rows } = await pg.query<RoundRow>(
    `SELECT position, puzzle_id, outcome, seconds, wrong_guesses, points,
            reveal_level_reached, base_points, reveal_penalty, wrong_guess_penalty
     FROM game_rounds WHERE game_id = $1 ORDER BY position`,
    [id],
  );
  return rows;
}

function deps(store: PgGameStore): GameDeps {
  return { games: store, puzzles: puzzleSourceFrom(CONTRACT_PUZZLES), now: () => now };
}

describe("PgGameStore columns", () => {
  it("maps a user owner to user_id and an anonymous owner to anon_owner_hash", async () => {
    const store = new PgGameStore(db, vault);
    const mine = await startGame(deps(store), PACK, alice, CONFIG);
    const theirs = await startGame(deps(store), PACK, bob, CONFIG);
    expect(await columns(mine.gameId)).toMatchObject({ user_id: "userId" in alice && alice.userId, anon_owner_hash: null });
    expect(await columns(theirs.gameId)).toMatchObject({
      user_id: null,
      anon_owner_hash: "anonId" in bob && bob.anonId,
    });
  });

  it("refuses an anonymous id that isn't a SHA-256 hex digest, so a raw cookie token is never stored", async () => {
    const store = new PgGameStore(db, vault);
    await expect(startGame(deps(store), PACK, { anonId: "raw-cookie-token" }, CONFIG)).rejects.toThrow(/SHA-256/);
    await expect(startGame(deps(store), PACK, { userId: "alice" }, CONFIG)).rejects.toThrow(/uuid/);
  });

  it("keeps total and finished_at in sync with the state, and writes each finished round once", async () => {
    const store = new PgGameStore(db, vault);
    const d = deps(store);
    let view = await startGame(d, PACK, alice, CONFIG);
    const id = view.gameId;
    expect(await columns(id)).toMatchObject({ revision: 0, total: 0, finished_at: null });

    view = await playNow(d, id, alice, { type: "start" });
    advance(START_GRACE_SECONDS + 2);
    view = await playNow(d, id, alice, { type: "guess", guess: "zzz wrong" });
    advance(4.25);
    view = await playNow(d, id, alice, { type: "guess", guess: CONTRACT_PUZZLES[0]!.answer });
    const points = scoreAt(6.25, CONFIG);
    expect(view.total).toBe(points);
    expect(await columns(id)).toMatchObject({ revision: 3, total: points, finished_at: null });
    // A timed round: its time and points, and none of the old zoom-out values (#255).
    expect(await roundRows(id)).toEqual([
      {
        position: 1,
        puzzle_id: "p1",
        outcome: "correct",
        seconds: 6.25,
        wrong_guesses: 1,
        points,
        reveal_level_reached: null,
        base_points: null,
        reveal_penalty: null,
        wrong_guess_penalty: null,
      },
    ]);

    // The other rounds time out; the next request ends each one.
    for (let i = 1; i < CONTRACT_PUZZLES.length; i++) {
      await playNow(d, id, alice, { type: "next" });
      await playNow(d, id, alice, { type: "start" });
      advance(31);
      view = await getGame(d, id, alice);
    }
    expect(await columns(id)).toMatchObject({ total: points, finished_at: null });
    view = await playNow(d, id, alice, { type: "next" });
    expect(view.finished).toBe(true);

    const finished = await columns(id);
    expect(finished.finished_at).toBeInstanceOf(Date);
    expect((await roundRows(id)).map((r) => [r.position, r.puzzle_id, r.outcome, r.seconds, r.points])).toEqual([
      [1, "p1", "correct", 6.25, points],
      [2, "p2", "timedOut", 30, 0],
      [3, "p3", "timedOut", 30, 0],
    ]);
  });

  it("writes no game_rounds rows when recordRounds is off (puzzles not in the database yet, #52)", async () => {
    const store = new PgGameStore(db, vault, { recordRounds: false });
    const d = deps(store);
    const { gameId } = await startGame(d, PACK, bob, CONFIG);
    await playNow(d, gameId, bob, { type: "start" });
    const view = await playNow(d, gameId, bob, { type: "guess", guess: CONTRACT_PUZZLES[0]!.answer });
    expect(view.results).toHaveLength(1);
    expect(await roundRows(gameId)).toEqual([]);
    expect(await columns(gameId)).toMatchObject({ revision: 2, total: view.total });
  });

  it("stores no answers in the games table", async () => {
    const store = new PgGameStore(db, vault);
    const d = deps(store);
    const { gameId } = await startGame(d, PACK, alice, CONFIG);
    await playNow(d, gameId, alice, { type: "start" });
    await playNow(d, gameId, alice, { type: "guess", guess: "zzz wrong" });
    const { rows } = await pg.query<{ row: string }>("SELECT row_to_json(g)::text AS row FROM games g WHERE id = $1", [gameId]);
    const json = rows[0]!.row.toLowerCase();
    for (const p of CONTRACT_PUZZLES) {
      for (const answer of [p.answer, ...p.acceptedAnswers]) expect(json).not.toContain(answer.toLowerCase());
    }
  });
});

describe("PgGameStore encryption (#84)", () => {
  type StateColumns = { state: unknown; state_encrypted: string | null };
  const stateColumns = async (id: string) =>
    (await pg.query<StateColumns>("SELECT state, state_encrypted FROM games WHERE id = $1", [id])).rows[0]!;

  it("stores the state only encrypted: no plain state, and no guess anywhere in the row", async () => {
    const store = new PgGameStore(db, vault);
    const d = deps(store);
    const { gameId } = await startGame(d, PACK, alice, CONFIG);
    expect(await stateColumns(gameId)).toMatchObject({ state: null, state_encrypted: expect.stringMatching(/^v1\./) });
    await playNow(d, gameId, alice, { type: "start" });
    await playNow(d, gameId, alice, { type: "guess", guess: "zzz wrong" });
    const cols = await stateColumns(gameId);
    expect(cols.state).toBeNull();
    // What the player did (a wrong guess on the first puzzle) is only in the encrypted copy.
    // Every other column is searched; the ciphertext itself is left out, because it's
    // random base64url and would contain a short string like a puzzle id by chance.
    const { rows } = await pg.query<{ row: string }>(
      "SELECT (to_jsonb(g) - 'state_encrypted')::text AS row FROM games g WHERE id = $1",
      [gameId],
    );
    for (const leak of ["wrongGuess", "events", "zzz wrong", CONTRACT_PUZZLES[0]!.id]) expect(rows[0]!.row).not.toContain(leak);
    // And the ciphertext is the vault's format, not JSON with the state in it.
    expect(cols.state_encrypted).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    const state = vault.decryptJson<{ events: unknown[] }>(stateKeyId(gameId), STATE_FIELD, cols.state_encrypted!);
    expect(JSON.stringify(state.events)).toContain("wrongGuess");
  });

  it("can't be read with another key", async () => {
    const { gameId } = await startGame(deps(new PgGameStore(db, vault)), PACK, bob, CONFIG);
    const other = new PgGameStore(db, new Vault(Buffer.alloc(32, 8)));
    const error = await other.get(gameId).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GameUnreadableError);
    expect(error).toMatchObject({ gameId, owner: bob });
  });

  it("with another key, the owner gets GameUnreadableError and a stranger gets GameNotFoundError", async () => {
    const { gameId } = await startGame(deps(new PgGameStore(db, vault)), PACK, bob, CONFIG);
    const other = deps(new PgGameStore(db, new Vault(Buffer.alloc(32, 8))));
    await expect(getGame(other, gameId, bob)).rejects.toBeInstanceOf(GameUnreadableError);
    await expect(getGame(other, gameId, alice)).rejects.toBeInstanceOf(GameNotFoundError);
    await expect(act(other, gameId, alice, { type: "start" }, 0)).rejects.toBeInstanceOf(GameNotFoundError);
  });

  it("can't be moved to another game", async () => {
    const store = new PgGameStore(db, vault);
    const a = await startGame(deps(store), PACK, bob, CONFIG);
    const b = await startGame(deps(store), PACK, bob, CONFIG);
    await pg.query("UPDATE games SET state_encrypted = (SELECT state_encrypted FROM games WHERE id = $1) WHERE id = $2", [
      a.gameId,
      b.gameId,
    ]);
    await expect(store.get(b.gameId)).rejects.toThrow();
  });

  /** A new game's state, as the service makes it. */
  const newState = async (store: PgGameStore) => (await store.get((await startGame(deps(store), PACK, bob, CONFIG)).gameId))!.state;

  it("uses the same key whatever the case of the game id or the user id", async () => {
    const store = new PgGameStore(db, vault);
    const upperAlice: GameOwner = { userId: ("userId" in alice ? alice.userId : "").toUpperCase() };
    const created = await store.create({ owner: upperAlice, packId: PACK.id, state: await newState(store) });
    expect((await store.get(created.id))!.state).toEqual(created.state);
    const saved = await store.save({ ...created, id: created.id.toUpperCase() });
    expect(saved.revision).toBe(1);
    expect(await store.get(created.id.toUpperCase())).toEqual({ ...saved, id: created.id });
  });

  it("save ignores the owner it's given, like MemoryGameStore: only the state changes", async () => {
    const store = new PgGameStore(db, vault);
    const created = await store.create({ owner: bob, packId: PACK.id, state: await newState(store) });
    const saved = await store.save({ ...created, owner: { anonId: "raw-cookie-token" } });
    expect(saved).toEqual({ ...created, revision: 1 });
    expect(await columns(created.id)).toMatchObject({ user_id: null, anon_owner_hash: "anonId" in bob && bob.anonId });
  });

  it("create and save return what the next get() will: the state goes through JSON, like MemoryGameStore", async () => {
    const store = new PgGameStore(db, vault);
    // Fields JSON drops or changes: an undefined value and a Date.
    const odd = { ...(await newState(store)), extra: undefined, when: new Date("2026-11-17T00:00:00Z") } as GameState;
    const created = await store.create({ owner: bob, packId: PACK.id, state: odd });
    expect(created.state).toEqual((await store.get(created.id))!.state);
    expect(created.state).not.toHaveProperty("extra");
    const saved = await store.save({ ...created, state: odd });
    expect(saved.state).toEqual((await store.get(created.id))!.state);
  });

  it("reports a conflict or a missing game without decrypting, even with the wrong key", async () => {
    const store = new PgGameStore(db, vault);
    const created = await store.create({ owner: bob, packId: PACK.id, state: await newState(store) });
    await store.save(created);
    const wrongKey = new PgGameStore(db, new Vault(Buffer.alloc(32, 8)));
    await expect(wrongKey.save(created)).rejects.toBeInstanceOf(GameConflictError);
    await expect(wrongKey.save({ ...created, id: "00000000-0000-4000-8000-000000000000" })).rejects.toBeInstanceOf(GameNotFoundError);
    await expect(wrongKey.save({ ...created, id: "not-a-game" })).rejects.toBeInstanceOf(GameNotFoundError);
  });

  it("still reads a game stored before encryption, and encrypts it on the next save", async () => {
    const store = new PgGameStore(db, vault);
    const d = deps(store);
    const { gameId } = await startGame(d, PACK, alice, CONFIG);
    // Turn it back into a pre-#84 row: plain jsonb state, nothing encrypted.
    const plain = (await store.get(gameId))!.state;
    await pg.query("UPDATE games SET state = $1::jsonb, state_encrypted = NULL WHERE id = $2", [JSON.stringify(plain), gameId]);
    expect((await store.get(gameId))!.state).toEqual(plain);

    await playNow(d, gameId, alice, { type: "start" });
    await playNow(d, gameId, alice, { type: "guess", guess: "zzz wrong" });
    expect(await stateColumns(gameId)).toMatchObject({ state: null, state_encrypted: expect.stringMatching(/^v1\./) });
    expect((await store.get(gameId))!.state.events).toHaveLength(plain.events.length + 1);
  });

  it("refuses a row with both or neither copy of the state", async () => {
    const { gameId } = await startGame(deps(new PgGameStore(db, vault)), PACK, alice, CONFIG);
    await expect(pg.query("UPDATE games SET state = '{}'::jsonb WHERE id = $1", [gameId])).rejects.toThrow(/games_one_state/);
    await expect(pg.query("UPDATE games SET state_encrypted = NULL WHERE id = $1", [gameId])).rejects.toThrow(/games_one_state/);
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
