// The Postgres `GameStore` (#54) on the `games` table (#47). Server-only.
//
// `src/game/server-game.ts` runs the games; this file only stores them.
// The same contract tests run against this store (on PGlite with the real
// migrations, see games.test.ts) and against `MemoryGameStore`.
import "server-only";

import { and, eq, sql } from "drizzle-orm";

import type { GameOwner, GameState, GameStore, NewStoredGame, StoredGame } from "@/game/server-game";
import { DuplicateDailyGameError, GameConflictError, GameNotFoundError } from "@/game/server-game";
import { scoreGame } from "@/game/scoring";
import type { Pack } from "@/game/types";
import type { Db } from "./index";
import { rowsOf } from "./rows";
import { games, packs } from "./schema";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_HEX = /^[0-9a-f]{64}$/;

export type PgGameStoreOptions = {
  /**
   * Also write one `game_rounds` row per finished round (for leaderboards and
   * stats, #62). Needs every puzzle of the game in the `puzzles` table
   * (foreign key), so it's off for the practice pack, whose puzzles are still
   * in code (`SAMPLE_PUZZLES`) until packs land (#52). Default: true.
   */
  recordRounds?: boolean | ((state: GameState) => boolean);
};

/** The columns that say who owns a game. Exactly one is set. */
function ownerColumns(owner: GameOwner): { userId: string | null; anonOwnerHash: string | null } {
  if ("userId" in owner) {
    if (!UUID.test(owner.userId)) throw new Error("PgGameStore: userId must be a users.id (uuid)");
    return { userId: owner.userId, anonOwnerHash: null };
  }
  // The anonymous owner id is already the SHA-256 of the cookie token
  // (src/server/owner.ts), so the token itself never reaches the database.
  // Refuse anything else, e.g. a raw token passed by mistake.
  if (!SHA256_HEX.test(owner.anonId)) {
    throw new Error("PgGameStore: anonId must be the SHA-256 hex of the owner cookie, never the raw token");
  }
  return { userId: null, anonOwnerHash: owner.anonId };
}

type GameRow = {
  id: string;
  packId: string;
  userId: string | null;
  anonOwnerHash: string | null;
  state: unknown;
  revision: number;
  dailyDate: string | null;
};

function fromRow(row: GameRow): StoredGame {
  let owner: GameOwner;
  if (row.userId !== null) owner = { userId: row.userId };
  else if (row.anonOwnerHash !== null) owner = { anonId: row.anonOwnerHash };
  else throw new Error(`PgGameStore: game ${row.id} has no owner`);
  // Raw `execute` results may hand jsonb back as text, depending on the driver.
  const state = (typeof row.state === "string" ? JSON.parse(row.state) : row.state) as GameState;
  const game: StoredGame = { id: row.id, owner, packId: row.packId, revision: Number(row.revision), state };
  // Raw `execute` results may return a date as a Date or as text, depending on the driver.
  if (row.dailyDate !== null && row.dailyDate !== undefined) game.dailyDate = dailyDateText(row.dailyDate);
  return game;
}

/**
 * A `date` column as "YYYY-MM-DD". node-postgres parses `date` to a Date at
 * *local* midnight, so read it with local getters: `toISOString()` would move
 * it back a day in any zone east of UTC (review of #119).
 */
export function dailyDateText(value: unknown): string {
  if (value instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return String(value).slice(0, 10);
}

/** The two unique indexes that keep one daily game per owner per day (#58). */
const DAILY_INDEXES = new Set(["games_daily_user_key", "games_daily_anon_key"]);

/** A unique-index violation on one of `DAILY_INDEXES`, from any of our drivers (drizzle wraps it in `cause`). */
export function isDuplicateDaily(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e !== null && typeof e === "object" && depth < 4; depth++) {
    const { code, constraint, message } = e as { code?: unknown; constraint?: unknown; message?: unknown };
    if (code === "23505" && (DAILY_INDEXES.has(String(constraint)) || [...DAILY_INDEXES].some((i) => String(message).includes(i)))) {
      return true;
    }
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

const COLUMNS = {
  id: games.id,
  packId: games.packId,
  userId: games.userId,
  anonOwnerHash: games.anonOwnerHash,
  state: games.state,
  revision: games.revision,
  dailyDate: games.dailyDate,
};


/**
 * A `GameStore` on the `games` table.
 *
 * - `id` is a random UUID from the database; `revision` starts at 0.
 * - `save` is one statement: `UPDATE games ... WHERE id = $1 AND revision = $2`
 *   that also bumps `revision`, keeps `total` and `finished_at` in sync with
 *   the state, and (with `recordRounds`) inserts the finished rounds into
 *   `game_rounds` in a CTE, so they're written together or not at all. No
 *   row updated means another request saved first: `GameConflictError`.
 * - Owner: `{ userId }` → `user_id`; `{ anonId }` → `anon_owner_hash`.
 */
export class PgGameStore implements GameStore {
  private readonly recordRounds: (state: GameState) => boolean;

  constructor(
    private readonly db: Db,
    options: PgGameStoreOptions = {},
  ) {
    const record = options.recordRounds ?? true;
    this.recordRounds = typeof record === "function" ? record : () => record;
  }

  async get(id: string): Promise<StoredGame | null> {
    // Ids come from URLs; anything that isn't a UUID can't exist (and would be
    // a Postgres type error).
    if (!UUID.test(id)) return null;
    const [row] = await this.db.select(COLUMNS).from(games).where(eq(games.id, id));
    return row === undefined ? null : fromRow(row);
  }

  async findDaily(owner: GameOwner, dailyDate: string): Promise<StoredGame | null> {
    const { userId, anonOwnerHash } = ownerColumns(owner);
    const ownerMatch = userId !== null ? eq(games.userId, userId) : eq(games.anonOwnerHash, anonOwnerHash!);
    const [row] = await this.db
      .select(COLUMNS)
      .from(games)
      .where(and(ownerMatch, eq(games.dailyDate, dailyDate)));
    return row === undefined ? null : fromRow(row);
  }

  async create(game: NewStoredGame): Promise<StoredGame> {
    let row: GameRow | undefined;
    try {
      [row] = await this.db
        .insert(games)
        .values({
          packId: game.packId,
          ...ownerColumns(game.owner),
          state: game.state,
          revision: 0,
          total: 0,
          dailyDate: game.dailyDate ?? null,
        })
        .returning(COLUMNS);
    } catch (error) {
      if (game.dailyDate !== undefined && isDuplicateDaily(error)) throw new DuplicateDailyGameError(game.dailyDate);
      throw error;
    }
    if (row === undefined) throw new Error("PgGameStore: insert returned no row");
    return fromRow(row);
  }

  async save(game: StoredGame): Promise<StoredGame> {
    const { state } = game;
    const { rounds, total } = scoreGame(state.events, state.scoring);
    // Rounds are scored in play order, so position = index + 1. Every save
    // sends all finished rounds; ON CONFLICT skips the ones already written.
    const roundRows = this.recordRounds(state)
      ? rounds.map((r, i) => ({
          position: i + 1,
          puzzle_id: r.puzzleId,
          outcome: r.outcome,
          reveal_level_reached: r.revealLevelReached,
          wrong_guesses: r.wrongGuesses,
          points: r.points,
          base_points: r.breakdown.base,
          reveal_penalty: r.breakdown.revealPenalty,
          wrong_guess_penalty: r.breakdown.wrongGuessPenalty,
        }))
      : [];

    const result = await this.db.execute(sql`
      WITH updated AS (
        UPDATE games
        SET state = ${JSON.stringify(state)}::jsonb,
            revision = revision + 1,
            total = ${total},
            finished_at = CASE WHEN ${state.finished}::boolean THEN coalesce(finished_at, now()) ELSE NULL END,
            updated_at = now()
        WHERE id = ${game.id}::uuid AND revision = ${game.revision}
        RETURNING id, pack_id, user_id, anon_owner_hash, state, revision, daily_date
      ),
      new_rounds AS (
        INSERT INTO game_rounds (game_id, position, puzzle_id, outcome, reveal_level_reached,
                                 wrong_guesses, points, base_points, reveal_penalty, wrong_guess_penalty)
        SELECT updated.id, r.position, r.puzzle_id, r.outcome, r.reveal_level_reached,
               r.wrong_guesses, r.points, r.base_points, r.reveal_penalty, r.wrong_guess_penalty
        FROM updated
        CROSS JOIN jsonb_to_recordset(${JSON.stringify(roundRows)}::jsonb) AS r(
          position integer, puzzle_id text, outcome round_outcome, reveal_level_reached integer,
          wrong_guesses integer, points integer, base_points integer, reveal_penalty integer,
          wrong_guess_penalty integer)
        ON CONFLICT (game_id, position) DO NOTHING
      )
      SELECT id, pack_id AS "packId", user_id AS "userId", anon_owner_hash AS "anonOwnerHash", state, revision,
             daily_date::text AS "dailyDate"
      FROM updated
    `);

    const [row] = rowsOf(result) as GameRow[];
    if (row !== undefined) return fromRow(row);
    // Nothing updated: either the game is gone or another request saved first.
    if (!UUID.test(game.id) || (await this.get(game.id)) === null) throw new GameNotFoundError();
    throw new GameConflictError(game.id);
  }
}

/**
 * Make sure a pack defined in code (the practice pack, until #52) has its
 * `packs` row, which `games.pack_id` references. Inserts it once and never
 * changes an existing row.
 */
export async function ensurePackRow(db: Db, pack: Pick<Pack, "id" | "kind" | "title" | "theme">): Promise<void> {
  await db
    .insert(packs)
    .values({ id: pack.id, kind: pack.kind, title: pack.title, theme: pack.theme })
    .onConflictDoNothing({ target: packs.id });
}

/** What `startPracticeGame` needs to apply the unfinished-games cap (#85). */
export type UnfinishedGames = {
  /** How many of the owner's games of this pack aren't finished. */
  count: number;
  /** The owner's newest unfinished game of this pack that hasn't been played yet (revision 0), if any. */
  untouchedId: string | null;
  /** The owner's most recently played unfinished game of this pack, if any. */
  latestId: string | null;
};

/**
 * The owner's unfinished games of one pack, for the per-pack cap and for
 * reuse (#85). One query.
 *
 * TODO(#85): this read and the insert that may follow aren't atomic, so two
 * starts at the same moment can each insert a game and overshoot the cap by
 * one or two. Fine at our scale (the start limits bound it); an
 * `INSERT ... SELECT ... WHERE (count) < cap` would close it if it matters.
 */
export async function findUnfinishedGames(db: Db, owner: GameOwner, packId: string): Promise<UnfinishedGames> {
  const { userId, anonOwnerHash } = ownerColumns(owner);
  const mine = userId !== null ? sql`user_id = ${userId}::uuid` : sql`anon_owner_hash = ${anonOwnerHash}`;
  const result = await db.execute(sql`
    SELECT
      (SELECT count(*) FROM games WHERE ${mine} AND pack_id = ${packId} AND finished_at IS NULL) AS "count",
      (SELECT id FROM games WHERE ${mine} AND pack_id = ${packId} AND finished_at IS NULL AND revision = 0
        ORDER BY created_at DESC LIMIT 1) AS "untouchedId",
      (SELECT id FROM games WHERE ${mine} AND pack_id = ${packId} AND finished_at IS NULL
        ORDER BY updated_at DESC LIMIT 1) AS "latestId"
  `);
  const [row] = rowsOf(result);
  return {
    count: Number(row?.count ?? 0),
    untouchedId: (row?.untouchedId as string | null | undefined) ?? null,
    latestId: (row?.latestId as string | null | undefined) ?? null,
  };
}
