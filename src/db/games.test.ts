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
import type { Pack, ScoringConfig } from "@/game/types";

import { Vault } from "@/crypto/vault";

import { ensurePackRow, findUnfinishedGames, PgGameStore, STATE_FIELD, stateKeyId, UnfinishedGamesCapError } from "./games";
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
const CONFIG: ScoringConfig = { basePoints: 100, revealPenalty: 20, wrongGuessPenalty: 10, minPoints: 10, skipPoints: 0 };

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
    const store = new PgGameStore(db, vault, { recordRounds: false });
    const d = deps(store);
    const { gameId } = await startGame(d, PACK, bob, CONFIG);
    const view = await playNow(d, gameId, bob, { type: "skip" });
    expect(view.results).toHaveLength(1);
    expect(await roundRows(gameId)).toEqual([]);
    expect(await columns(gameId)).toMatchObject({ revision: 1, total: 0 });
  });

  it("stores no answers in the games table", async () => {
    const store = new PgGameStore(db, vault);
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

describe("PgGameStore encryption (#84)", () => {
  type StateColumns = { state: unknown; state_encrypted: string | null };
  const stateColumns = async (id: string) =>
    (await pg.query<StateColumns>("SELECT state, state_encrypted FROM games WHERE id = $1", [id])).rows[0]!;

  it("stores the state only encrypted: no plain state, and no guess anywhere in the row", async () => {
    const store = new PgGameStore(db, vault);
    const d = deps(store);
    const { gameId } = await startGame(d, PACK, alice, CONFIG);
    expect(await stateColumns(gameId)).toMatchObject({ state: null, state_encrypted: expect.stringMatching(/^v1\./) });
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
    await expect(act(other, gameId, alice, { type: "skip" }, 0)).rejects.toBeInstanceOf(GameNotFoundError);
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

    await playNow(d, gameId, alice, { type: "skip" });
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

describe("PgGameStore with maxUnfinishedPerPack (#85, #225)", () => {
  const CAP = 3;
  const capped = () => new PgGameStore(db, vault, { maxUnfinishedPerPack: CAP });

  async function unfinishedCount(owner: GameOwner, packId: string): Promise<number> {
    const [column, value] = "userId" in owner ? ["user_id", owner.userId] : ["anon_owner_hash", owner.anonId];
    const { rows } = await pg.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM games WHERE ${column} = $1 AND pack_id = $2 AND finished_at IS NULL`,
      [value, packId],
    );
    return rows[0]!.n;
  }

  it("never goes over the cap when several starts for one owner run at once", async () => {
    const pack: Pack = { ...PACK, id: "pk_cap_parallel" };
    await ensurePackRow(db, pack);
    const owner = anon("parallel starter's cookie token");
    const d = deps(capped());

    const results = await Promise.allSettled(Array.from({ length: 3 * CAP }, () => startGame(d, pack, owner, CONFIG)));

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(CAP);
    for (const r of results) {
      if (r.status === "rejected") expect(r.reason).toBeInstanceOf(UnfinishedGamesCapError);
    }
    expect(await unfinishedCount(owner, pack.id)).toBe(CAP);
  });

  it("at the cap inserts nothing and throws UnfinishedGamesCapError, so the caller resumes a game", async () => {
    const pack: Pack = { ...PACK, id: "pk_cap_full" };
    await ensurePackRow(db, pack);
    const d = deps(capped());
    const started = [];
    for (let i = 0; i < CAP; i++) started.push(await startGame(d, pack, alice, CONFIG));

    await expect(startGame(d, pack, alice, CONFIG)).rejects.toBeInstanceOf(UnfinishedGamesCapError);
    expect(await unfinishedCount(alice, pack.id)).toBe(CAP);

    // Other owners and other packs have their own caps.
    await expect(startGame(d, pack, bob, CONFIG)).resolves.toMatchObject({ revision: 0 });
    const otherPack: Pack = { ...PACK, id: "pk_cap_other" };
    await ensurePackRow(db, otherPack);
    await expect(startGame(d, otherPack, alice, CONFIG)).resolves.toMatchObject({ revision: 0 });

    // Finished games don't count: finishing one makes room for one more, which reads back like any game.
    await pg.query("UPDATE games SET finished_at = now() WHERE id = $1", [started[0]!.gameId]);
    const next = await startGame(d, pack, alice, CONFIG);
    expect(await getGame(d, next.gameId, alice)).toEqual(next);
    expect(await unfinishedCount(alice, pack.id)).toBe(CAP);
  });

  it("leaves daily games out of the cap (one per owner and day already, #58)", async () => {
    const pack: Pack = { ...PACK, id: "pk_cap_daily", kind: "daily" };
    await ensurePackRow(db, pack);
    const owner = anon("daily player's cookie token");
    const d = deps(capped());
    for (let i = 0; i <= CAP; i++) {
      await startGame(d, pack, owner, CONFIG, { dailyDate: `2030-01-0${i + 1}` });
    }
    expect(await unfinishedCount(owner, pack.id)).toBe(CAP + 1);
  });
});

describe("findUnfinishedGames (#85)", () => {
  // Packs and owners no other test in this file uses, so only this block's games count.
  const OWN_PACK: Pack = { ...PACK, id: "pk_unfinished_test" };
  const OTHER_PACK: Pack = { ...PACK, id: "pk_unfinished_other" };
  const carol = anon("carol's cookie token");
  const dave = anon("dave's cookie token");
  /** More than any owner here has, so `recentIds` lists all of them unless a test passes less. */
  const LIMIT = 10;

  /** Pins a game's timestamps, so the "newest" and "most recently played" picks don't depend on clock resolution. */
  async function setTimes(id: string, createdAt: string, updatedAt: string) {
    await pg.query("UPDATE games SET created_at = $2, updated_at = $3 WHERE id = $1", [id, createdAt, updatedAt]);
  }

  it("counts and picks only this owner's unfinished games of this pack, never another player's", async () => {
    await ensurePackRow(db, OWN_PACK);
    await ensurePackRow(db, OTHER_PACK);
    const d = deps(new PgGameStore(db, vault));

    expect(await findUnfinishedGames(db, carol, OWN_PACK.id, LIMIT)).toEqual({ count: 0, untouchedId: null, recentIds: [] });

    // Carol: an old played game, a newer played one, an untouched one, and a finished one.
    const older = await startGame(d, OWN_PACK, carol, CONFIG);
    await act(d, older.gameId, carol, { type: "reveal" }, older.revision);
    const newer = await startGame(d, OWN_PACK, carol, CONFIG);
    await act(d, newer.gameId, carol, { type: "reveal" }, newer.revision);
    const untouched = await startGame(d, OWN_PACK, carol, CONFIG);
    const done = await startGame(d, OWN_PACK, carol, CONFIG);
    await pg.query("UPDATE games SET finished_at = now() WHERE id = $1", [done.gameId]);
    await setTimes(older.gameId, "2030-01-01T00:00:00Z", "2030-01-01T00:05:00Z");
    await setTimes(newer.gameId, "2030-01-01T00:01:00Z", "2030-01-01T00:02:00Z");
    await setTimes(untouched.gameId, "2030-01-01T00:03:00Z", "2030-01-01T00:03:00Z");
    // The finished game is Carol's newest and most recently updated, and must still be left out.
    await setTimes(done.gameId, "2030-01-01T00:09:00Z", "2030-01-01T00:09:00Z");

    // Other players' untouched games of the same pack, newer than all of Carol's
    // (an anonymous owner and a logged-in user), and Carol's own game of another pack.
    const daves = await startGame(d, OWN_PACK, dave, CONFIG);
    const alices = await startGame(d, OWN_PACK, alice, CONFIG);
    const elsewhere = await startGame(d, OTHER_PACK, carol, CONFIG);
    for (const id of [daves.gameId, alices.gameId, elsewhere.gameId]) {
      await setTimes(id, "2030-01-02T00:00:00Z", "2030-01-02T00:00:00Z");
    }

    expect(await findUnfinishedGames(db, carol, OWN_PACK.id, LIMIT)).toEqual({
      count: 3,
      untouchedId: untouched.gameId,
      // Most recently played first: `older` was created first but played last.
      recentIds: [older.gameId, untouched.gameId, newer.gameId],
    });
    // `limit` caps the list, not the count.
    expect(await findUnfinishedGames(db, carol, OWN_PACK.id, 1)).toEqual({ count: 3, untouchedId: untouched.gameId, recentIds: [older.gameId] });
    expect(await findUnfinishedGames(db, dave, OWN_PACK.id, LIMIT)).toEqual({ count: 1, untouchedId: daves.gameId, recentIds: [daves.gameId] });
    expect(await findUnfinishedGames(db, alice, OWN_PACK.id, LIMIT)).toEqual({ count: 1, untouchedId: alices.gameId, recentIds: [alices.gameId] });
    expect(await findUnfinishedGames(db, carol, OTHER_PACK.id, LIMIT)).toEqual({
      count: 1,
      untouchedId: elsewhere.gameId,
      recentIds: [elsewhere.gameId],
    });
  });

  it("has no untouched game once every unfinished one has been played", async () => {
    const pack: Pack = { ...PACK, id: "pk_unfinished_played" };
    await ensurePackRow(db, pack);
    const d = deps(new PgGameStore(db, vault));
    const frank = anon("frank's cookie token");
    const game = await startGame(d, pack, frank, CONFIG);
    await act(d, game.gameId, frank, { type: "skip" }, game.revision);
    expect(await findUnfinishedGames(db, frank, pack.id, LIMIT)).toEqual({ count: 1, untouchedId: null, recentIds: [game.gameId] });
  });

  it("refuses an owner id that isn't a users.id or a hashed cookie, instead of querying with it", async () => {
    await expect(findUnfinishedGames(db, { userId: "not-a-uuid" }, OWN_PACK.id, LIMIT)).rejects.toThrow(/userId must be a users.id/);
    await expect(findUnfinishedGames(db, { anonId: "raw-cookie-token" }, OWN_PACK.id, LIMIT)).rejects.toThrow(/never the raw token/);
  });
});
