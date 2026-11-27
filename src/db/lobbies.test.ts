// Spec for the lobby queries (#67) on PGlite with the real migrations: the
// caps, what a purge deletes, what the sweep picks, how reports count, and
// that a lobby puzzle is never played without its answer.
// src/server/lobbies.test.ts plays the whole flow through the server.
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { newUserRow } from "@/auth/user-row";
import { Vault } from "@/crypto/vault";
import { LOBBY_LIFETIME_MS } from "@/game/lobby";
import { GameNotFoundError } from "@/game/server-game";

import type { Db } from "./index";
import {
  countActiveLobbies,
  createLobby,
  findPlayableLobby,
  getLobbyAnswers,
  getPuzzlesWithLobbyAnswers,
  getUploads,
  insertUpload,
  LobbyGoneError,
  LOBBY_PUZZLE_ZOOM_LEVELS,
  lobbyImageBytes,
  listOwnLobbies,
  markLobbyDeleted,
  purgeDeadLobbies,
  purgeLobby,
  reportLobby,
  UNFINISHED_LOBBY_MS,
  type LobbyCaps,
  type NewLobbyRound,
} from "./lobbies";
import * as schema from "./schema";

let pg: PGlite;
let db: Db;
const vault = new Vault(Buffer.alloc(32, 9));
const NOW = new Date("2026-11-26T12:00:00Z");
const CAPS: LobbyCaps = { perUser: 3, total: 100, totalImageBytes: 10_000_000 };

beforeAll(async () => {
  pg = new PGlite();
  const client = drizzle({ client: pg, schema });
  await migrate(client, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
  db = client as unknown as Db;
}, 60_000);

afterAll(async () => {
  await pg.close();
});

beforeEach(async () => {
  await pg.exec("DELETE FROM games; DELETE FROM pack_puzzles; DELETE FROM puzzles WHERE id LIKE 'lobby-%'; DELETE FROM packs; DELETE FROM lobby_uploads;");
});

async function user(): Promise<string> {
  const row = newUserRow(vault, `u${Math.random().toString(36).slice(2, 10)}`, "hash");
  await db.insert(schema.users).values(row);
  return row.id;
}

const round = (answer: string, extra: Partial<NewLobbyRound> = {}): NewLobbyRound => ({
  answer,
  acceptedAnswers: [`${answer} alt`],
  focus: { x: 0.5, y: 0.5 },
  photo: { bytes: new Uint8Array(100).fill(1), width: 16, height: 12 },
  ...extra,
});

let codeCounter = 0;
const nextCode = () => `CODE${String(++codeCounter).padStart(12, "0")}`;

async function make(owner: string, caps = CAPS, now = NOW, rounds = [round("Kiwi"), round("Lime"), round("Fig")]) {
  const code = nextCode();
  const created = await createLobby(db, vault, { ownerUserId: owner, code, rounds, caps, now });
  return { code, created };
}

const count = async (sql: string, params: unknown[] = []) => Number((await pg.query<{ n: number }>(sql, params)).rows[0]!.n);

describe("createLobby", () => {
  it("stores a ready, playable lobby whose answers are encrypted and photos too", async () => {
    const owner = await user();
    const { code, created } = await make(owner);
    expect(created).not.toBeNull();
    const lobby = await findPlayableLobby(db, vault, code, NOW);
    expect(lobby).toMatchObject({ id: created!.lobbyId, packId: created!.packId, ownerUserId: owner });
    expect(lobby!.expiresAt.getTime()).toBe(NOW.getTime() + LOBBY_LIFETIME_MS);
    const answers = await getLobbyAnswers(db, vault, lobby!.puzzleIds, NOW);
    expect(lobby!.puzzleIds.map((id) => answers.get(id))).toEqual([
      { answer: "Kiwi", acceptedAnswers: ["Kiwi alt"] },
      { answer: "Lime", acceptedAnswers: ["Lime alt"] },
      { answer: "Fig", acceptedAnswers: ["Fig alt"] },
    ]);
    // Photo bytes are stored encrypted, not as given.
    const [file] = (await pg.query<{ bytes: Uint8Array }>(
      "SELECT f.bytes FROM image_files f JOIN lobby_puzzles lp ON lp.puzzle_id = f.puzzle_id LIMIT 1",
    )).rows;
    expect(Buffer.from(file!.bytes).equals(Buffer.alloc(100, 1))).toBe(false);
    // One image per photo (timed rounds, #254: no cut levels).
    expect(await lobbyImageBytes(db)).toBe(3 * (100 + 29));
  });

  it("stores one image per photo, the whole photo, which every zoom level points to (timed rounds, #254)", async () => {
    const owner = await user();
    const { code } = await make(owner);
    const { puzzleIds } = (await findPlayableLobby(db, vault, code, NOW))!;
    for (const puzzleId of puzzleIds) {
      const files = (await pg.query<{ id: string; width: number; height: number }>(
        "SELECT id, width, height FROM image_files WHERE puzzle_id = $1",
        [puzzleId],
      )).rows;
      expect(files).toHaveLength(1);
      expect(files[0]).toMatchObject({ width: 16, height: 12 });
      const levels = (await pg.query<{ level: number; src: string }>(
        "SELECT level, src FROM puzzle_images WHERE puzzle_id = $1 ORDER BY level",
        [puzzleId],
      )).rows;
      expect(levels.map((l) => l.level)).toEqual(LOBBY_PUZZLE_ZOOM_LEVELS.map((_, i) => i));
      expect(new Set(levels.map((l) => l.src))).toEqual(new Set([`/img/${files[0]!.id}.webp`]));
    }
    const [puzzle] = await getPuzzlesWithLobbyAnswers(db, vault, puzzleIds, NOW);
    expect(puzzle!.imageUrl).toBe(`/img/${(await pg.query<{ id: string }>("SELECT id FROM image_files WHERE puzzle_id = $1", [puzzleIds[0]])).rows[0]!.id}.webp`);
    expect(puzzle!.reveal).toEqual({ focus: { x: 0.5, y: 0.5 }, zoomLevels: [...LOBBY_PUZZLE_ZOOM_LEVELS] });
  });

  it("stores each photo's effect, and none when none was chosen", async () => {
    const owner = await user();
    const { code } = await make(owner, CAPS, NOW, [round("Kiwi", { effect: "swirl" }), round("Lime"), round("Fig", { effect: "tiles" })]);
    const { puzzleIds } = (await findPlayableLobby(db, vault, code, NOW))!;
    const puzzles = await getPuzzlesWithLobbyAnswers(db, vault, puzzleIds, NOW);
    expect(puzzles.map((p) => p.effect)).toEqual(["swirl", undefined, "tiles"]);
  });

  it("doesn't leave the pack behind if the lobby insert fails", async () => {
    const packs = await count("SELECT count(*)::int AS n FROM packs");
    // An owner that doesn't exist breaks the lobby row's foreign key.
    await expect(
      createLobby(db, vault, { ownerUserId: crypto.randomUUID(), code: nextCode(), rounds: [round("Kiwi"), round("Lime"), round("Fig")], caps: CAPS, now: NOW }),
    ).rejects.toThrow();
    expect(await count("SELECT count(*)::int AS n FROM packs")).toBe(packs);
  });

  it("a create that stopped partway holds a slot for an hour, then no longer counts", async () => {
    const owner = await user();
    for (let i = 0; i < CAPS.perUser; i++) expect((await make(owner)).created).not.toBeNull();
    const [stuck] = (await pg.query<{ id: string }>("SELECT id FROM lobbies WHERE owner_user_id = $1 LIMIT 1", [owner])).rows;
    // As if creating it had stopped before `ready_at`: the owner can't see it.
    await pg.query("UPDATE lobbies SET ready_at = NULL WHERE id = $1", [stuck!.id]);
    expect((await listOwnLobbies(db, vault, owner, NOW)).map((l) => l.id)).not.toContain(stuck!.id);
    expect(await countActiveLobbies(db, owner, NOW)).toBe(CAPS.perUser);
    expect((await make(owner)).created).toBeNull();
    const later = new Date(NOW.getTime() + UNFINISHED_LOBBY_MS + 1000);
    expect(await countActiveLobbies(db, owner, later)).toBe(CAPS.perUser - 1);
    expect((await make(owner, CAPS, later)).created).not.toBeNull();
  });

  it("refuses at the per-user cap, the total cap or the image budget, leaving nothing behind", async () => {
    const owner = await user();
    for (let i = 0; i < CAPS.perUser; i++) expect((await make(owner)).created).not.toBeNull();
    const packs = await count("SELECT count(*)::int AS n FROM packs");
    expect((await make(owner)).created).toBeNull();
    expect(await count("SELECT count(*)::int AS n FROM packs")).toBe(packs);
    // A deleted or expired lobby doesn't count.
    const [first] = (await pg.query<{ id: string }>("SELECT id FROM lobbies WHERE owner_user_id = $1 LIMIT 1", [owner])).rows;
    await markLobbyDeleted(db, first!.id, owner, NOW);
    expect(await countActiveLobbies(db, owner, NOW)).toBe(CAPS.perUser - 1);
    expect((await make(owner)).created).not.toBeNull();
    expect((await make(owner, CAPS, new Date(NOW.getTime() + LOBBY_LIFETIME_MS))).created).not.toBeNull();

    const other = await user();
    const total = await count("SELECT count(*)::int AS n FROM lobbies WHERE deleted_at IS NULL AND expires_at > $1", [NOW.toISOString()]);
    expect((await make(other, { ...CAPS, total })).created).toBeNull();
    expect((await make(other, { ...CAPS, totalImageBytes: await lobbyImageBytes(db) })).created).toBeNull();
    expect(await countActiveLobbies(db, other, NOW)).toBe(0);
  });
});

describe("visibility", () => {
  it("only a ready, unexpired, undeleted, unhidden lobby with an owner can be found or played", async () => {
    const owner = await user();
    const { code, created } = await make(owner);
    const id = created!.lobbyId;
    const lobby = (await findPlayableLobby(db, vault, code, NOW))!;
    const ids = lobby.puzzleIds;
    expect(await findPlayableLobby(db, vault, code, new Date(created!.expiresAt.getTime()))).toBeNull();
    for (const change of ["ready_at = NULL", "hidden_at = now()", "deleted_at = now()"]) {
      await pg.query(`UPDATE lobbies SET ${change} WHERE id = $1`, [id]);
      expect(await findPlayableLobby(db, vault, code, NOW)).toBeNull();
      await expect(getLobbyAnswers(db, vault, ids, NOW)).rejects.toBeInstanceOf(LobbyGoneError);
      await expect(getPuzzlesWithLobbyAnswers(db, vault, ids, NOW)).rejects.toBeInstanceOf(GameNotFoundError);
      await pg.query("UPDATE lobbies SET ready_at = $2, hidden_at = NULL, deleted_at = NULL WHERE id = $1", [id, NOW.toISOString()]);
    }
    expect(await findPlayableLobby(db, vault, code, NOW)).not.toBeNull();
    expect(await findPlayableLobby(db, vault, nextCode(), NOW)).toBeNull();
  });

  it("fills in a lobby puzzle's answers, and never returns one without", async () => {
    const owner = await user();
    const { code } = await make(owner);
    const { puzzleIds } = (await findPlayableLobby(db, vault, code, NOW))!;
    const puzzles = await getPuzzlesWithLobbyAnswers(db, vault, puzzleIds, NOW);
    expect(puzzles.map((p) => [p.answer, p.acceptedAnswers])).toEqual([
      ["Kiwi", ["Kiwi alt"]],
      ["Lime", ["Lime alt"]],
      ["Fig", ["Fig alt"]],
    ]);
    // A row whose answers went missing is never played with an empty answer.
    await pg.query("DELETE FROM lobby_puzzles WHERE puzzle_id = $1", [puzzleIds[0]]);
    await expect(getPuzzlesWithLobbyAnswers(db, vault, puzzleIds, NOW)).rejects.toBeInstanceOf(GameNotFoundError);
  });
});

describe("deleting", () => {
  it("only the owner can mark a lobby deleted", async () => {
    const owner = await user();
    const { created } = await make(owner);
    expect(await markLobbyDeleted(db, created!.lobbyId, await user(), NOW)).toBe(false);
    expect(await markLobbyDeleted(db, "not-a-uuid", owner, NOW)).toBe(false);
    expect(await markLobbyDeleted(db, created!.lobbyId, owner, NOW)).toBe(true);
    expect(await markLobbyDeleted(db, created!.lobbyId, owner, NOW)).toBe(false);
  });

  it("purgeLobby deletes the pack, puzzles, answers, images, URLs, games, rounds and reports, and can run again", async () => {
    const owner = await user();
    const { created } = await make(owner);
    const { lobbyId, packId } = created!;
    const [game] = (await pg.query<{ id: string }>(
      "INSERT INTO games (pack_id, user_id, state_encrypted, finished_at) VALUES ($1, $2, 'x', now()) RETURNING id",
      [packId, owner],
    )).rows;
    const [puzzle] = (await pg.query<{ puzzle_id: string }>("SELECT puzzle_id FROM lobby_puzzles LIMIT 1")).rows;
    await pg.query(
      "INSERT INTO game_rounds (game_id, position, puzzle_id, outcome, reveal_level_reached, wrong_guesses, points, base_points, reveal_penalty, wrong_guess_penalty) VALUES ($1, 1, $2, 'skipped', 0, 0, 0, 0, 0, 0)",
      [game!.id, puzzle!.puzzle_id],
    );
    await reportLobby(db, vault, lobbyId, { key: "user:someone", signedIn: true, ipHash: "ip-1" }, 3, NOW);
    // Another lobby is left alone.
    const keep = await make(owner);

    await purgeLobby(db, lobbyId);
    await purgeLobby(db, lobbyId);
    expect(await count("SELECT count(*)::int AS n FROM lobbies WHERE id = $1", [lobbyId])).toBe(0);
    expect(await count("SELECT count(*)::int AS n FROM packs WHERE id = $1", [packId])).toBe(0);
    expect(await count("SELECT count(*)::int AS n FROM games WHERE pack_id = $1", [packId])).toBe(0);
    expect(await count("SELECT count(*)::int AS n FROM game_rounds")).toBe(0);
    expect(await count("SELECT count(*)::int AS n FROM lobby_reports")).toBe(0);
    expect(await count("SELECT count(*)::int AS n FROM lobby_puzzles")).toBe(3);
    expect(await count("SELECT count(*)::int AS n FROM puzzles WHERE id LIKE 'lobby-%'")).toBe(3);
    expect(await count("SELECT count(*)::int AS n FROM puzzle_images WHERE puzzle_id LIKE 'lobby-%'")).toBe(3 * LOBBY_PUZZLE_ZOOM_LEVELS.length);
    expect(await count("SELECT count(*)::int AS n FROM image_files WHERE puzzle_id LIKE 'lobby-%'")).toBe(3);
    expect(await findPlayableLobby(db, vault, keep.code, NOW)).not.toBeNull();
  });

  it("the sweep purges deleted, expired, ownerless and long-unfinished lobbies, but keeps live and hidden ones", async () => {
    const owner = await user();
    const live = await make(owner);
    const hidden = await make(owner);
    await pg.query("UPDATE lobbies SET hidden_at = now() WHERE id = $1", [hidden.created!.lobbyId]);
    const deleted = await make(owner);
    await markLobbyDeleted(db, deleted.created!.lobbyId, owner, NOW);
    const gone = await user();
    const orphan = await make(gone);
    await pg.query("DELETE FROM users WHERE id = $1", [gone]);
    const fresh = await user();
    const unfinished = await make(fresh);
    const stillCreating = await make(fresh);
    await pg.query("UPDATE lobbies SET ready_at = NULL, created_at = $2 WHERE id = $1", [
      unfinished.created!.lobbyId,
      new Date(NOW.getTime() - 2 * 3600_000).toISOString(),
    ]);
    await pg.query("UPDATE lobbies SET ready_at = NULL, created_at = $2 WHERE id = $1", [stillCreating.created!.lobbyId, NOW.toISOString()]);

    expect(await purgeDeadLobbies(db, NOW)).toBe(3);
    const left = (await pg.query<{ id: string }>("SELECT id FROM lobbies")).rows.map((r) => r.id).sort();
    expect(left).toEqual([live.created!.lobbyId, hidden.created!.lobbyId, stillCreating.created!.lobbyId].sort());
    void orphan;

    // At expiry, everything goes.
    expect(await purgeDeadLobbies(db, live.created!.expiresAt)).toBe(3);
    expect(await count("SELECT count(*)::int AS n FROM lobbies")).toBe(0);
    expect(await count("SELECT count(*)::int AS n FROM image_files WHERE puzzle_id LIKE 'lobby-%'")).toBe(0);
  });
});

describe("reportLobby", () => {
  const signedIn = (key: string, ipHash: string | null) => ({ key, signedIn: true, ipHash });
  const anonymous = (key: string, ipHash: string | null) => ({ key, signedIn: false, ipHash });

  it("counts each reporter once, hides at the threshold, and stores no reporter id or IP hash", async () => {
    const owner = await user();
    const { code, created } = await make(owner);
    const id = created!.lobbyId;
    expect(await reportLobby(db, vault, id, signedIn("user:a", "ip-a"), 2, NOW)).toEqual({ counted: true, hidden: false });
    expect(await reportLobby(db, vault, id, signedIn("user:a", "ip-z"), 2, NOW)).toEqual({ counted: false, hidden: false });
    expect(await reportLobby(db, vault, id, signedIn("user:b", "ip-b"), 2, NOW)).toEqual({ counted: true, hidden: true });
    expect(await reportLobby(db, vault, id, signedIn("user:c", "ip-c"), 2, NOW)).toEqual({ counted: false, hidden: false });
    expect(await findPlayableLobby(db, vault, code, NOW)).toBeNull();
    const reporters = JSON.stringify((await pg.query("SELECT * FROM lobby_reports")).rows);
    expect(reporters).not.toMatch(/user:a|user:b|ip-a|ip-b/u);
    expect(await count("SELECT report_count AS n FROM lobbies WHERE id = $1", [id])).toBe(2);
  });

  it("records anonymous reports but never hides for them", async () => {
    const { code, created } = await make(await user());
    const id = created!.lobbyId;
    for (const key of ["anon:a", "anon:b", "anon:c"]) {
      expect(await reportLobby(db, vault, id, anonymous(key, `ip-${key}`), 2, NOW)).toEqual({ counted: true, hidden: false });
    }
    expect(await findPlayableLobby(db, vault, code, NOW)).not.toBeNull();
    expect(await count("SELECT report_count AS n FROM lobbies WHERE id = $1", [id])).toBe(0);
    expect(await count("SELECT count(*)::int AS n FROM lobby_reports WHERE lobby_id = $1", [id])).toBe(3);
    // A logged-in report after them is only the first that counts.
    expect(await reportLobby(db, vault, id, signedIn("user:a", "ip-a"), 2, NOW)).toEqual({ counted: true, hidden: false });
  });

  it("needs the logged-in reporters to come from as many addresses (no address counts as one)", async () => {
    const { code, created } = await make(await user());
    const id = created!.lobbyId;
    expect(await reportLobby(db, vault, id, signedIn("user:a", "ip-1"), 2, NOW)).toEqual({ counted: true, hidden: false });
    expect(await reportLobby(db, vault, id, signedIn("user:b", "ip-1"), 2, NOW)).toEqual({ counted: true, hidden: false });
    expect(await reportLobby(db, vault, id, signedIn("user:c", null), 2, NOW)).toEqual({ counted: true, hidden: true });
    expect(await findPlayableLobby(db, vault, code, NOW)).toBeNull();

    const other = (await make(await user())).created!.lobbyId;
    expect(await reportLobby(db, vault, other, signedIn("user:a", null), 2, NOW)).toEqual({ counted: true, hidden: false });
    expect(await reportLobby(db, vault, other, signedIn("user:b", null), 2, NOW)).toEqual({ counted: true, hidden: false });
  });
});

describe("uploads", () => {
  it("are stored encrypted, readable only by their uploader, and capped per user and in total", async () => {
    const alice = await user();
    const bob = await user();
    const photo = { bytes: new Uint8Array(1000).fill(7), width: 10, height: 10 };
    const id = await insertUpload(db, vault, alice, photo, { perUser: 2, totalBytes: 10_000 }, NOW);
    expect(id).toMatch(/^[0-9a-f]{32}$/u);
    const [row] = (await pg.query<{ bytes: Uint8Array }>("SELECT bytes FROM lobby_uploads WHERE id = $1", [id])).rows;
    expect(Buffer.from(row!.bytes).includes(Buffer.alloc(100, 7))).toBe(false);
    expect((await getUploads(db, vault, alice, [id!])).get(id!)).toEqual(photo);
    expect((await getUploads(db, vault, bob, [id!])).size).toBe(0);

    expect(await insertUpload(db, vault, alice, photo, { perUser: 2, totalBytes: 10_000 }, NOW)).not.toBeNull();
    expect(await insertUpload(db, vault, alice, photo, { perUser: 2, totalBytes: 10_000 }, NOW)).toBeNull();
    expect(await insertUpload(db, vault, bob, photo, { perUser: 2, totalBytes: 2 * 1029 + 500 }, NOW)).toBeNull();
    expect(await insertUpload(db, vault, bob, photo, { perUser: 2, totalBytes: 3 * 1029 }, NOW)).not.toBeNull();
  });
});
