// Database schema (#47). Owners: Jacky and Joseph together; change it only
// through a PR that both review.
//
// After changing this file, run `npm run db:generate` and commit the new SQL
// file in `drizzle/`. Never edit a migration that has already been applied
// anywhere; add a new one instead. See TECHNICAL.md → Database.
//
// This file has no "server-only" import so drizzle-kit and the tests can load
// it. Query the database only through `@/db` (src/db/index.ts), which is
// server-only.
//
// Conventions:
// - Every timestamp is `timestamptz`.
// - Users, sessions and games get random UUIDs. Packs and puzzles get opaque
//   text ids (the seed script, #52, may set its own), never derived from the
//   theme or the answer.
// - Passwords and session tokens are stored only as hashes.

import { sql } from "drizzle-orm";
import {
  check,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Type-only import (erased at runtime), so drizzle-kit doesn't need the "@/" alias.
import type { ScoringConfig } from "../game/types";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/**
 * Raw bytes (Postgres `bytea`); Drizzle has no built-in column for it. Handed
 * to the driver as a Buffer, which all three of ours take: node-postgres
 * natively, PGlite as a Uint8Array, and Neon HTTP turns it into `\x…` hex itself
 * (`encodeBuffersAsBytea`). Read back as a Uint8Array; a `\x…` string is also
 * understood, in case a driver returns bytea as text.
 */
const bytea = customType<{ data: Uint8Array; driverData: Buffer | Uint8Array | string }>({
  dataType: () => "bytea",
  toDriver: (value) => Buffer.from(value.buffer, value.byteOffset, value.byteLength),
  fromDriver: (value) =>
    typeof value === "string" ? new Uint8Array(Buffer.from(value.replace(/^\\x/, ""), "hex")) : new Uint8Array(value),
});

/** Opaque text id for packs and puzzles; the seed script may supply its own. */
const opaqueId = () =>
  text("id")
    .primaryKey()
    .default(sql`gen_random_uuid()::text`);

// ---------------------------------------------------------------------------
// Accounts (#53)
// ---------------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Stored as typed (for display). Uniqueness ignores case, see the index below.
    username: text("username").notNull(),
    // argon2/bcrypt hash including its salt and parameters. Never the password.
    passwordHash: text("password_hash").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_username_lower_key").on(sql`lower(${t.username})`)],
);

export const sessions = pgTable(
  "sessions",
  {
    // Hash (e.g. SHA-256) of the random token in the cookie. The token itself
    // is never stored, so a database leak doesn't hand out live sessions.
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("sessions_user_id_idx").on(t.userId),
    index("sessions_expires_at_idx").on(t.expiresAt),
  ],
);

// ---------------------------------------------------------------------------
// Packs and puzzles (#52, #57, #56)
// ---------------------------------------------------------------------------

/** Matches `PackKind` (#52). */
export const packKind = pgEnum("pack_kind", ["practice", "daily", "stanford", "lobby"]);

export const packs = pgTable("packs", {
  id: opaqueId(),
  kind: packKind("kind").notNull(),
  title: text("title").notNull(),
  theme: text("theme").notNull(),
  // Per-pack scoring override (#64). NULL = use the default config.
  scoring: jsonb("scoring").$type<ScoringConfig>(),
  createdAt: createdAt(),
});

/**
 * Server-only puzzle data. Columns map to `Puzzle` (credit fields to
 * `Puzzle["credit"]`, focus and zoom levels to `Puzzle["reveal"]`).
 */
export const puzzles = pgTable(
  "puzzles",
  {
    id: opaqueId(),
    answer: text("answer").notNull(),
    acceptedAnswers: text("accepted_answers")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // The full image. Per-level images are in `puzzle_images` (#57).
    imageUrl: text("image_url").notNull(),
    focusX: doublePrecision("focus_x").notNull(),
    focusY: doublePrecision("focus_y").notNull(),
    // Index 0 = tightest crop, last = full image (same as `Puzzle`).
    zoomLevels: doublePrecision("zoom_levels").array().notNull(),
    creditSource: text("credit_source").notNull(),
    creditLicense: text("credit_license").notNull(),
    creditUrl: text("credit_url"),
    // First reveal level at which the AI got it (#56). NULL = it never did,
    // or the solver hasn't run yet.
    aiSolvedLevel: integer("ai_solved_level"),
    createdAt: createdAt(),
  },
  (t) => [
    check("puzzles_focus_x_range", sql`${t.focusX} BETWEEN 0 AND 1`),
    check("puzzles_focus_y_range", sql`${t.focusY} BETWEEN 0 AND 1`),
    // Zoom levels follow the loader's rules (`parseZoomLevels` in
    // src/game/puzzles.ts) as far as a CHECK can: a plain 1-based list, at
    // least 2 levels, the last one 1 (the full image), and every level a
    // finite number >= 1 with no NULLs. `'Infinity' > ALL` also rejects NaN,
    // which Postgres sorts above every number, and the NULL test is needed
    // because `1 <= ALL` is NULL (so passes) for a list with a NULL in it.
    // "Each level smaller than the one before" can't be a CHECK (it would
    // have to loop over the list); the seed script (#52) runs every puzzle
    // through `parsePuzzles` before inserting it.
    check(
      "puzzles_zoom_levels_valid",
      sql`array_ndims(${t.zoomLevels}) = 1 AND array_lower(${t.zoomLevels}, 1) = 1 AND cardinality(${t.zoomLevels}) >= 2 AND ${t.zoomLevels}[cardinality(${t.zoomLevels})] = 1 AND array_position(${t.zoomLevels}, NULL) IS NULL AND 1 <= ALL(${t.zoomLevels}) AND 'Infinity'::double precision > ALL(${t.zoomLevels})`,
    ),
    check(
      "puzzles_ai_solved_level_range",
      sql`${t.aiSolvedLevel} IS NULL OR (${t.aiSolvedLevel} >= 0 AND ${t.aiSolvedLevel} < cardinality(${t.zoomLevels}))`,
    ),
  ],
);

/**
 * One pre-cut image per reveal level (#57), so the server can hand out only the
 * current level's image. `src` is the URL the browser loads: for images cut
 * into `image_files`, `/img/<id>.webp`.
 */
export const puzzleImages = pgTable(
  "puzzle_images",
  {
    puzzleId: text("puzzle_id")
      .notNull()
      .references(() => puzzles.id, { onDelete: "cascade" }),
    level: integer("level").notNull(),
    src: text("src").notNull(),
    width: integer("width"),
    height: integer("height"),
  },
  (t) => [
    primaryKey({ columns: [t.puzzleId, t.level] }),
    // 0-based, like the index into `puzzles.zoom_levels`. The upper bound
    // (level < number of zoom levels) would need to read the puzzle row, which
    // a CHECK can't do. Whatever loads per-level images (#57) must check it.
    check("puzzle_images_level_min", sql`${t.level} >= 0`),
  ],
);

/**
 * The bytes of each cut level image (#57), served by `GET /img/<id>.webp`.
 *
 * The id is 32 random hex characters (128 bits) and is the only thing that
 * protects an image: the server sends a level's URL only once the player has
 * reached it, and one level's id says nothing about another's. So ids are
 * never derived from the puzzle, the level or the answer.
 */
export const imageFiles = pgTable(
  "image_files",
  {
    id: text("id").primaryKey(),
    // Whose image this is, so re-cutting a puzzle can drop its old files, and
    // deleting a puzzle deletes them. Never sent to the browser.
    puzzleId: text("puzzle_id")
      .notNull()
      .references(() => puzzles.id, { onDelete: "cascade" }),
    contentType: text("content_type").notNull(),
    bytes: bytea("bytes").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("image_files_puzzle_id_idx").on(t.puzzleId),
    check("image_files_id_format", sql`${t.id} ~ '^[0-9a-f]{32}$'`),
    check("image_files_content_type", sql`${t.contentType} IN ('image/webp')`),
  ],
);

/** A pack's puzzles in play order. `position` is 1-based, like `PublicRound.position`. */
export const packPuzzles = pgTable(
  "pack_puzzles",
  {
    packId: text("pack_id")
      .notNull()
      .references(() => packs.id, { onDelete: "cascade" }),
    // RESTRICT: a puzzle that is in a pack can't be deleted by accident.
    puzzleId: text("puzzle_id")
      .notNull()
      .references(() => puzzles.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.packId, t.position] }),
    unique("pack_puzzles_pack_puzzle_key").on(t.packId, t.puzzleId),
    index("pack_puzzles_puzzle_id_idx").on(t.puzzleId),
    check("pack_puzzles_position_min", sql`${t.position} >= 1`),
  ],
);

/** Which pack is a given day's daily challenge (`DailyEntry`, #58). */
export const dailySchedule = pgTable(
  "daily_schedule",
  {
    // The day in the reset time zone (open decision). `mode: "string"` keeps
    // it as "YYYY-MM-DD", with no time-zone conversion in JavaScript.
    date: date("date", { mode: "string" }).primaryKey(),
    packId: text("pack_id")
      .notNull()
      .references(() => packs.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (t) => [index("daily_schedule_pack_id_idx").on(t.packId)],
);

// ---------------------------------------------------------------------------
// Server-side games (#54)
// ---------------------------------------------------------------------------

export const games = pgTable(
  "games",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    packId: text("pack_id")
      .notNull()
      .references(() => packs.id, { onDelete: "restrict" }),
    // Logged-in owner. Deleting the account deletes its games.
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    // Hash of an anonymous-player cookie, IF anonymous play is allowed (open
    // decision, #54/#62). Never the raw cookie value.
    anonOwnerHash: text("anon_owner_hash"),
    // Full serialized server-side game state, so #54 can resume a game across
    // requests. Its shape is owned by #54; the browser never sees it.
    state: jsonb("state").notNull(),
    // Optimistic concurrency for #54: a save is `UPDATE ... WHERE id = $1 AND
    // revision = $2` and bumps it, so two fast requests can't both apply.
    // Works without interactive transactions (the Neon HTTP driver has none).
    revision: integer("revision").notNull().default(0),
    total: integer("total").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("games_user_id_created_at_idx").on(t.userId, t.createdAt),
    index("games_anon_owner_hash_idx").on(t.anonOwnerHash),
    // Leaderboards (#62): finished games of a pack, by score.
    index("games_finished_pack_id_total_idx")
      .on(t.packId, t.total)
      .where(sql`${t.finishedAt} IS NOT NULL`),
    check("games_single_owner", sql`${t.userId} IS NULL OR ${t.anonOwnerHash} IS NULL`),
  ],
);

/** Matches `RoundResult["outcome"]`. */
export const roundOutcome = pgEnum("round_outcome", ["correct", "skipped"]);

/** One finished round. Columns match `RoundResult` (breakdown flattened). */
export const gameRounds = pgTable(
  "game_rounds",
  {
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    position: integer("position").notNull(), // 1-based
    puzzleId: text("puzzle_id")
      .notNull()
      .references(() => puzzles.id, { onDelete: "restrict" }),
    outcome: roundOutcome("outcome").notNull(),
    revealLevelReached: integer("reveal_level_reached").notNull(),
    wrongGuesses: integer("wrong_guesses").notNull(),
    points: integer("points").notNull(),
    basePoints: integer("base_points").notNull(),
    revealPenalty: integer("reveal_penalty").notNull(),
    wrongGuessPenalty: integer("wrong_guess_penalty").notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.gameId, t.position] }),
    index("game_rounds_puzzle_id_idx").on(t.puzzleId),
    check("game_rounds_position_min", sql`${t.position} >= 1`),
    check("game_rounds_reveal_level_min", sql`${t.revealLevelReached} >= 0`),
    check("game_rounds_wrong_guesses_min", sql`${t.wrongGuesses} >= 0`),
  ],
);
