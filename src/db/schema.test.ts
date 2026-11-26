// Applies the committed migrations (drizzle/) to an empty in-memory Postgres
// (PGlite, no network) and checks the tables, keys and constraints that other
// features rely on (#47).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EFFECTS } from "../game/puzzles";

import * as schema from "./schema";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

let pg: PGlite;
let db: PgliteDatabase<typeof schema>;

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle({ client: pg, schema });
  await migrate(db, { migrationsFolder });
}, 60_000);

afterAll(async () => {
  await pg.close();
});

async function rows<T>(query: string, params: unknown[] = []): Promise<T[]> {
  return (await pg.query<T>(query, params)).rows;
}

// --- fixtures (raw SQL, so they test the database, not the TypeScript types) ---

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${++counter}`;

/** `usernameIndex` stands in for the keyed hash of the lowercased username (#84). */
async function addUser(usernameIndex = nextId("user")): Promise<string> {
  const [row] = await rows<{ id: string }>(
    "INSERT INTO users (username_encrypted, username_index, password_hash) VALUES ('v1.encrypted', $1, 'hash') RETURNING id",
    [usernameIndex],
  );
  return row!.id;
}

async function addPack(kind = "daily"): Promise<string> {
  const [row] = await rows<{ id: string }>(
    "INSERT INTO packs (kind, title, theme) VALUES ($1, 'Title', 'Theme') RETURNING id",
    [kind],
  );
  return row!.id;
}

/** `zoomLevels` is a Postgres array literal; the default is a valid list. */
async function addPuzzle(zoomLevels = "{8,4,2,1}"): Promise<string> {
  const [row] = await rows<{ id: string }>(
    `INSERT INTO puzzles (answer, image_url, focus_x, focus_y, zoom_levels, credit_source, credit_license)
     VALUES ('Answer', '/full.jpg', 0.5, 0.5, $1, 'Source', 'CC BY-SA 4.0') RETURNING id`,
    [zoomLevels],
  );
  return row!.id;
}

async function addGame(packId: string, userId: string | null = null): Promise<string> {
  const [row] = await rows<{ id: string }>(
    "INSERT INTO games (pack_id, user_id, state) VALUES ($1, $2, '{}') RETURNING id",
    [packId, userId],
  );
  return row!.id;
}

async function addRound(gameId: string, puzzleId: string, position = 1) {
  await pg.query(
    `INSERT INTO game_rounds (game_id, position, puzzle_id, outcome, reveal_level_reached,
       wrong_guesses, points, base_points, reveal_penalty, wrong_guess_penalty)
     VALUES ($1, $2, $3, 'correct', 1, 0, 80, 100, 20, 0)`,
    [gameId, position, puzzleId],
  );
}

const count = async (table: string, where: string, params: unknown[]) =>
  Number((await rows<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`, params))[0]!.n);

// ---------------------------------------------------------------------------

describe("migrations", () => {
  it("create exactly the planned tables (no lobbies yet, #67)", async () => {
    const tables = await rows<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' ORDER BY table_name`,
    );
    expect(tables.map((t) => t.table_name)).toEqual([
      "daily_schedule",
      "game_rounds",
      "games",
      "image_files", // per-level image bytes (#57)
      "pack_puzzles",
      "packs",
      "puzzle_images",
      "puzzles",
      "rate_limits", // login and sign-up limits (#53)
      "sessions",
      "users",
    ]);
  });

  it("can run again on an up-to-date database without changing anything", async () => {
    await expect(migrate(db, { migrationsFolder })).resolves.toBeUndefined();
  });

  it("match src/db/schema.ts (run `npm run db:generate` after changing the schema)", async () => {
    const journal = JSON.parse(readFileSync(`${migrationsFolder}/meta/_journal.json`, "utf8")) as {
      entries: { idx: number }[];
    };
    const last = journal.entries.at(-1)!.idx.toString().padStart(4, "0");
    const snapshot = JSON.parse(
      readFileSync(`${migrationsFolder}/meta/${last}_snapshot.json`, "utf8"),
    ) as Parameters<typeof generateMigration>[0];

    const pending = await generateMigration(snapshot, generateDrizzleJson(schema));
    expect(pending).toEqual([]);
  });

  it("use timestamptz for every timestamp column", async () => {
    const naive = await rows<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND data_type = 'timestamp without time zone'`,
    );
    expect(naive).toEqual([]);
  });
});

describe("users and sessions", () => {
  it("store only hashes and encrypted values: no plain password, token or username columns", async () => {
    const columns = await rows<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name IN ('users', 'sessions')
       ORDER BY table_name, ordinal_position`,
    );
    expect(columns.map((c) => `${c.table_name}.${c.column_name}`)).toEqual([
      "sessions.token_hash",
      "sessions.user_id",
      "sessions.created_at",
      "sessions.expires_at",
      "users.id",
      "users.password_hash",
      "users.created_at",
      "users.username_encrypted",
      "users.username_index",
    ]);
  });

  it("reject a second user with the same username index (the app lowercases before hashing, #84)", async () => {
    await addUser("hmac-of-ansel");
    await expect(addUser("hmac-of-ansel")).rejects.toThrow(/users_username_index_key/);
  });

  it("delete a user's sessions and games along with the user", async () => {
    const userId = await addUser();
    const packId = await addPack();
    const puzzleId = await addPuzzle();
    await pg.query(
      "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '30 days')",
      [nextId("token-hash"), userId],
    );
    const gameId = await addGame(packId, userId);
    await addRound(gameId, puzzleId);

    await pg.query("DELETE FROM users WHERE id = $1", [userId]);

    expect(await count("sessions", "user_id = $1", [userId])).toBe(0);
    expect(await count("games", "id = $1", [gameId])).toBe(0);
    expect(await count("game_rounds", "game_id = $1", [gameId])).toBe(0);
  });

  it("reject a session for a user that doesn't exist", async () => {
    await expect(
      pg.query(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('h', gen_random_uuid(), now())",
      ),
    ).rejects.toThrow(/sessions_user_id_users_id_fk/);
  });
});

describe("packs and puzzles", () => {
  it("accept only the four pack kinds", async () => {
    for (const kind of ["practice", "daily", "stanford", "lobby"]) {
      await expect(addPack(kind)).resolves.toEqual(expect.any(String));
    }
    await expect(addPack("weekly")).rejects.toThrow(/pack_kind/);
  });

  it("accept only the puzzle effects the loader knows (EFFECTS), or none yet (timed-reveal redesign)", async () => {
    expect(schema.puzzleEffect.enumValues).toEqual([...EFFECTS]);
    const puzzleId = await addPuzzle();
    expect((await rows<{ effect: string | null }>("SELECT effect FROM puzzles WHERE id = $1", [puzzleId]))[0]!.effect).toBeNull();
    for (const effect of EFFECTS) {
      await pg.query("UPDATE puzzles SET effect = $2 WHERE id = $1", [puzzleId, effect]);
    }
    await expect(pg.query("UPDATE puzzles SET effect = 'blur' WHERE id = $1", [puzzleId])).rejects.toThrow(/puzzle_effect/);
  });

  it("keep a pack's puzzles in order, each puzzle and position at most once", async () => {
    const packId = await addPack();
    const [a, b] = [await addPuzzle(), await addPuzzle()];
    await pg.query("INSERT INTO pack_puzzles (pack_id, puzzle_id, position) VALUES ($1, $2, 2), ($1, $3, 1)", [
      packId,
      a,
      b,
    ]);
    const order = await rows<{ puzzle_id: string }>(
      "SELECT puzzle_id FROM pack_puzzles WHERE pack_id = $1 ORDER BY position",
      [packId],
    );
    expect(order.map((r) => r.puzzle_id)).toEqual([b, a]);

    await expect(
      pg.query("INSERT INTO pack_puzzles (pack_id, puzzle_id, position) VALUES ($1, $2, 3)", [packId, a]),
    ).rejects.toThrow(/pack_puzzles_pack_puzzle_key/);
    const c = await addPuzzle();
    await expect(
      pg.query("INSERT INTO pack_puzzles (pack_id, puzzle_id, position) VALUES ($1, $2, 1)", [packId, c]),
    ).rejects.toThrow(/pack_puzzles_pack_id_position_pk/);
    await expect(
      pg.query("INSERT INTO pack_puzzles (pack_id, puzzle_id, position) VALUES ($1, $2, 0)", [packId, c]),
    ).rejects.toThrow(/pack_puzzles_position_min/);
  });

  it("drop a pack's puzzle list with the pack, but never delete a puzzle that's in a pack", async () => {
    const packId = await addPack();
    const puzzleId = await addPuzzle();
    await pg.query("INSERT INTO pack_puzzles (pack_id, puzzle_id, position) VALUES ($1, $2, 1)", [packId, puzzleId]);

    await expect(pg.query("DELETE FROM puzzles WHERE id = $1", [puzzleId])).rejects.toThrow(
      /pack_puzzles_puzzle_id_puzzles_id_fk/,
    );
    await pg.query("DELETE FROM packs WHERE id = $1", [packId]);
    expect(await count("pack_puzzles", "pack_id = $1", [packId])).toBe(0);
    expect(await count("puzzles", "id = $1", [puzzleId])).toBe(1);
  });

  it("delete a puzzle's per-level images with the puzzle", async () => {
    const puzzleId = await addPuzzle();
    await pg.query("INSERT INTO puzzle_images (puzzle_id, level, src) VALUES ($1, 0, 'a'), ($1, 1, 'b')", [puzzleId]);
    await expect(
      pg.query("INSERT INTO puzzle_images (puzzle_id, level, src) VALUES ($1, 0, 'c')", [puzzleId]),
    ).rejects.toThrow(/puzzle_images_puzzle_id_level_pk/);

    await pg.query("DELETE FROM puzzles WHERE id = $1", [puzzleId]);
    expect(await count("puzzle_images", "puzzle_id = $1", [puzzleId])).toBe(0);
  });

  it("reject a focus outside 0–1 and an AI level beyond the last zoom level", async () => {
    const id = await addPuzzle();
    await expect(pg.query("UPDATE puzzles SET focus_x = 1.5 WHERE id = $1", [id])).rejects.toThrow(
      /puzzles_focus_x_range/,
    );
    await pg.query("UPDATE puzzles SET ai_solved_level = 3 WHERE id = $1", [id]); // last of 4 levels
    await expect(pg.query("UPDATE puzzles SET ai_solved_level = 4 WHERE id = $1", [id])).rejects.toThrow(
      /puzzles_ai_solved_level_range/,
    );
  });

  it("accept zoom levels the loader accepts, ending at 1 (the full image)", async () => {
    for (const levels of ["{8,4,2,1}", "{2,1}", "{3.5,1.5,1}"]) {
      await expect(addPuzzle(levels)).resolves.toEqual(expect.any(String));
    }
  });

  it("reject zoom levels the loader rejects, as far as a CHECK can tell", async () => {
    const rejected = {
      "no levels": "{}",
      "a single level": "{1}",
      "a last level other than 1": "{8,4,2}",
      "a level below 1": "{4,0.5,1}",
      "a zero or negative level": "{0,-2,1}",
      "a NULL level": "{4,NULL,1}",
      "an infinite level": "{Infinity,2,1}",
      "a NaN level": "{NaN,2,1}",
      "a two-dimensional list": "{{4,2},{2,1}}",
      "a list not starting at index 1": "[0:1]={2,1}",
    };
    for (const [why, levels] of Object.entries(rejected)) {
      await expect(addPuzzle(levels), why).rejects.toThrow(/puzzles_zoom_levels_valid/);
    }
    const id = await addPuzzle();
    await expect(pg.query("UPDATE puzzles SET zoom_levels = '{1}' WHERE id = $1", [id])).rejects.toThrow(
      /puzzles_zoom_levels_valid/,
    );
  });

  it("leave level order to the loader: a CHECK can't loop over the list", async () => {
    // parsePuzzles rejects this (each level must be smaller than the one before).
    await expect(addPuzzle("{2,4,1}")).resolves.toEqual(expect.any(String));
  });

  it("reject a negative per-level image level (the upper bound is the seed script's job)", async () => {
    const puzzleId = await addPuzzle();
    await expect(
      pg.query("INSERT INTO puzzle_images (puzzle_id, level, src) VALUES ($1, -1, 'a')", [puzzleId]),
    ).rejects.toThrow(/puzzle_images_level_min/);
  });

  it("round-trip a pack and puzzle through the typed schema", async () => {
    const scoring = { maxPoints: 10_000, minPoints: 100, revealSeconds: 25, limitSeconds: 30, curve: 2 };
    const [pack] = await db
      .insert(schema.packs)
      .values({ id: "pack-typed", kind: "stanford", title: "Campus", theme: "Stanford", scoring })
      .returning();
    expect(pack).toMatchObject({ id: "pack-typed", kind: "stanford", scoring });
    expect(pack!.createdAt).toBeInstanceOf(Date);

    await db.insert(schema.puzzles).values({
      id: "puzzle-typed",
      answer: "Hoover Tower",
      acceptedAnswers: ["hoover"],
      imageUrl: "/x.jpg",
      focusX: 0.25,
      focusY: 0.75,
      zoomLevels: [8, 4, 2, 1],
      creditSource: "Own photo",
      creditLicense: "CC BY 4.0",
    });
    const [puzzle] = await db.select().from(schema.puzzles).where(eq(schema.puzzles.id, "puzzle-typed"));
    expect(puzzle).toMatchObject({
      acceptedAnswers: ["hoover"],
      zoomLevels: [8, 4, 2, 1],
      creditUrl: null,
      aiSolvedLevel: null,
    });
  });
});

describe("daily schedule", () => {
  it("has at most one pack per date, stored as a plain YYYY-MM-DD date", async () => {
    const packId = await addPack();
    await db.insert(schema.dailySchedule).values({ date: "2026-12-01", packId });
    const [entry] = await db.select().from(schema.dailySchedule).where(eq(schema.dailySchedule.date, "2026-12-01"));
    expect(entry?.date).toBe("2026-12-01");

    await expect(
      pg.query("INSERT INTO daily_schedule (date, pack_id) VALUES ('2026-12-01', $1)", [await addPack()]),
    ).rejects.toThrow(/daily_schedule_pkey/);
  });

  it("won't delete a pack that's scheduled", async () => {
    const packId = await addPack();
    await pg.query("INSERT INTO daily_schedule (date, pack_id) VALUES ('2026-12-02', $1)", [packId]);
    await expect(pg.query("DELETE FROM packs WHERE id = $1", [packId])).rejects.toThrow(
      /daily_schedule_pack_id_packs_id_fk/,
    );
  });
});

describe("games and rounds", () => {
  it("allow a game with no owner, a user, or an anonymous owner, but not both", async () => {
    const packId = await addPack();
    await expect(addGame(packId)).resolves.toEqual(expect.any(String));
    await expect(addGame(packId, await addUser())).resolves.toEqual(expect.any(String));
    await pg.query("INSERT INTO games (pack_id, anon_owner_hash, state) VALUES ($1, 'h', '{}')", [packId]);
    await expect(
      pg.query("INSERT INTO games (pack_id, user_id, anon_owner_hash, state) VALUES ($1, $2, 'h', '{}')", [
        packId,
        await addUser(),
      ]),
    ).rejects.toThrow(/games_single_owner/);
  });

  it("store the full game state as JSON and give it back unchanged", async () => {
    const packId = await addPack();
    const state = { position: 2, revealLevel: 1, wrongGuesses: 0, events: [{ type: "reveal" }] };
    const [game] = await db.insert(schema.games).values({ packId, state }).returning();
    expect(game).toMatchObject({ state, revision: 0, total: 0, finishedAt: null, userId: null });
  });

  it("let only one of two saves from the same revision apply (#54)", async () => {
    const packId = await addPack();
    const [game] = await db.insert(schema.games).values({ packId, state: { n: 0 } }).returning();
    if (!game) throw new Error("insert returned no row");
    const save = (n: number) =>
      db
        .update(schema.games)
        .set({ state: { n }, revision: game.revision + 1 })
        .where(and(eq(schema.games.id, game.id), eq(schema.games.revision, game.revision)))
        .returning();
    expect(await save(1)).toHaveLength(1);
    expect(await save(2)).toHaveLength(0);
    const [stored] = await db.select().from(schema.games).where(eq(schema.games.id, game.id));
    expect(stored).toMatchObject({ state: { n: 1 }, revision: 1 });
  });

  it("delete a game's rounds with the game, and number rounds once per game", async () => {
    const packId = await addPack();
    const puzzleId = await addPuzzle();
    const gameId = await addGame(packId);
    await addRound(gameId, puzzleId, 1);
    await expect(addRound(gameId, puzzleId, 1)).rejects.toThrow(/game_rounds_game_id_position_pk/);

    await pg.query("DELETE FROM games WHERE id = $1", [gameId]);
    expect(await count("game_rounds", "game_id = $1", [gameId])).toBe(0);
  });

  it("won't delete a pack or puzzle that has been played", async () => {
    const packId = await addPack();
    const puzzleId = await addPuzzle();
    await addRound(await addGame(packId), puzzleId);
    await expect(pg.query("DELETE FROM packs WHERE id = $1", [packId])).rejects.toThrow(/games_pack_id_packs_id_fk/);
    await expect(pg.query("DELETE FROM puzzles WHERE id = $1", [puzzleId])).rejects.toThrow(
      /game_rounds_puzzle_id_puzzles_id_fk/,
    );
  });

  it("have indexes for a user's games, sessions by user, and leaderboards", async () => {
    const indexes = await rows<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE schemaname = 'public'",
    );
    expect(indexes.map((i) => i.indexname)).toEqual(
      expect.arrayContaining([
        "sessions_pkey", // token_hash lookups
        "sessions_user_id_idx",
        "games_user_id_created_at_idx",
        "games_anon_owner_hash_idx",
        "games_finished_pack_id_total_idx",
      ]),
    );
  });
});
