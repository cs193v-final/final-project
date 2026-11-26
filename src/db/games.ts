// The Postgres `GameStore` (#54) on the `games` table (#47). Server-only.
//
// `src/game/server-game.ts` runs the games; this file only stores them.
// The same contract tests run against this store (on PGlite with the real
// migrations, see games.test.ts) and against `MemoryGameStore`.
//
// Encryption (#84): the game state (the player's guesses and moves) is stored
// only encrypted, in `state_encrypted`, with a key for this game
// (`stateKeyId`, from the game id alone). Games written before that still have a plain `state`;
// they're read as they are, and encrypted the next time they're saved (or by
// `npm run db:encrypt-games`). `total`, `finished_at` and `game_rounds` stay
// plain: leaderboards (#62) sort and filter on them in SQL.
import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq, is, sql, type SQL } from "drizzle-orm";
import { NeonHttpDatabase } from "drizzle-orm/neon-http";

import { DecryptionError, type Vault } from "@/crypto/vault";

import type { GameOwner, GameState, GameStore, NewStoredGame, StoredGame } from "@/game/server-game";
import { DuplicateDailyGameError, GameConflictError, GameNotFoundError, GameUnreadableError } from "@/game/server-game";
import { scoreGame } from "@/game/scoring";
import type { Pack } from "@/game/types";
import type { Db } from "./index";
import { STATE_FIELD, stateKeyId } from "./game-state-key";
import { rowsOf } from "./rows";
import { games, packs } from "./schema";

export { STATE_FIELD, stateKeyId };

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
  /**
   * At most this many unfinished games per owner and pack (#85): `create`
   * throws `UnfinishedGamesCapError` instead of inserting one more. Exact even
   * when several starts for one owner run at once (#225). Daily games are
   * left out (one per owner and day already, #58). Default: no cap.
   */
  maxUnfinishedPerPack?: number;
};

/**
 * `create` found the owner already at `maxUnfinishedPerPack` unfinished games
 * of this pack (#85, #225), usually because another start for the same owner
 * got there first. Nothing was inserted: resume one of those games instead.
 */
export class UnfinishedGamesCapError extends Error {
  constructor(readonly packId: string) {
    super(`The owner already has the maximum number of unfinished games of pack ${packId}`);
    this.name = "UnfinishedGamesCapError";
  }
}

/**
 * Run `statements` in order in one transaction and return each result. The
 * Neon HTTP driver has no interactive transactions, but its `batch` is one
 * (non-interactive) transaction; node-postgres and PGlite use `transaction`.
 * Read committed either way, so each statement sees what was committed
 * before it started, e.g. by whoever held a lock it waited for.
 */
async function inOneTransaction(db: Db, statements: [SQL, ...SQL[]]): Promise<unknown[]> {
  if (is(db, NeonHttpDatabase)) {
    const neonDb = db as unknown as NeonHttpDatabase<Record<string, unknown>>;
    const [first, ...rest] = statements.map((s) => neonDb.execute(s));
    return neonDb.batch([first!, ...rest]);
  }
  return db.transaction(async (tx) => {
    const results: unknown[] = [];
    for (const statement of statements) results.push(await tx.execute(statement));
    return results;
  });
}

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
  /** Only on games written before #84; NULL once encrypted. */
  state: unknown;
  stateEncrypted: string | null;
  revision: number;
  dailyDate: string | null;
};

type OwnerRow = Pick<GameRow, "id" | "userId" | "anonOwnerHash">;

function ownerOf(row: OwnerRow): GameOwner {
  if (row.userId !== null) return { userId: row.userId };
  if (row.anonOwnerHash !== null) return { anonId: row.anonOwnerHash };
  throw new Error(`PgGameStore: game ${row.id} has no owner`);
}

/** Sets `dailyDate` on a stored game when the row has one (#58). */
function withDailyDate(game: StoredGame, dailyDate: unknown): StoredGame {
  // Raw `execute` results may return a date as a Date or as text, depending on the driver.
  if (dailyDate !== null && dailyDate !== undefined) game.dailyDate = dailyDateText(dailyDate);
  return game;
}

function fromRow(vault: Vault, row: GameRow): StoredGame {
  const owner = ownerOf(row);
  let state: GameState;
  if (row.stateEncrypted !== null) {
    try {
      state = vault.decryptJson<GameState>(stateKeyId(row.id), STATE_FIELD, row.stateEncrypted);
    } catch (error) {
      if (error instanceof DecryptionError) throw new GameUnreadableError(row.id, owner, { cause: error });
      throw error;
    }
  } else {
    // Written before #84. Raw `execute` results may hand jsonb back as text, depending on the driver.
    state = (typeof row.state === "string" ? JSON.parse(row.state) : row.state) as GameState;
  }
  return withDailyDate({ id: row.id, owner, packId: row.packId, revision: Number(row.revision), state }, row.dailyDate);
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

const ROW_COLUMNS = {
  id: games.id,
  packId: games.packId,
  userId: games.userId,
  anonOwnerHash: games.anonOwnerHash,
  state: games.state,
  stateEncrypted: games.stateEncrypted,
  revision: games.revision,
  dailyDate: games.dailyDate,
};

/**
 * What `create` and `save` read back: no state. They already have it in
 * memory, so they don't fetch the ciphertext back and decrypt it again.
 */
const META_COLUMNS = {
  id: games.id,
  packId: games.packId,
  userId: games.userId,
  anonOwnerHash: games.anonOwnerHash,
  revision: games.revision,
  dailyDate: games.dailyDate,
};
type MetaRow = Omit<GameRow, "state" | "stateEncrypted">;

/**
 * A stored game from its row's columns and the state the caller already has.
 * The state goes through JSON, like what `get` decrypts and like
 * `MemoryGameStore`, so `save()` returns exactly what the next `get()` will:
 * an `undefined` field is dropped, a `Date` becomes a string.
 */
function withState(row: MetaRow, state: GameState): StoredGame {
  return withDailyDate(
    {
      id: row.id,
      owner: ownerOf(row),
      packId: row.packId,
      revision: Number(row.revision),
      state: JSON.parse(JSON.stringify(state)) as GameState,
    },
    row.dailyDate,
  );
}

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
  private readonly maxUnfinishedPerPack: number | undefined;

  constructor(
    private readonly db: Db,
    private readonly vault: Vault,
    options: PgGameStoreOptions = {},
  ) {
    const record = options.recordRounds ?? true;
    this.recordRounds = typeof record === "function" ? record : () => record;
    this.maxUnfinishedPerPack = options.maxUnfinishedPerPack;
  }

  async get(id: string): Promise<StoredGame | null> {
    // Ids come from URLs; anything that isn't a UUID can't exist (and would be
    // a Postgres type error).
    if (!UUID.test(id)) return null;
    const [row] = await this.db.select(ROW_COLUMNS).from(games).where(eq(games.id, id));
    return row === undefined ? null : fromRow(this.vault, row);
  }

  async findDaily(owner: GameOwner, dailyDate: string): Promise<StoredGame | null> {
    const { userId, anonOwnerHash } = ownerColumns(owner);
    const ownerMatch = userId !== null ? eq(games.userId, userId) : eq(games.anonOwnerHash, anonOwnerHash!);
    const [row] = await this.db
      .select(ROW_COLUMNS)
      .from(games)
      .where(and(ownerMatch, eq(games.dailyDate, dailyDate)));
    return row === undefined ? null : fromRow(this.vault, row);
  }

  async create(game: NewStoredGame): Promise<StoredGame> {
    // The id is made here, not by the database, so the encrypted state can be
    // bound to it before the row exists.
    const id = randomUUID();
    const cap = this.maxUnfinishedPerPack;
    if (cap !== undefined && game.dailyDate === undefined) return this.createCapped(id, game, cap);
    let row: MetaRow | undefined;
    try {
      [row] = await this.db
        .insert(games)
        .values({
          id,
          packId: game.packId,
          ...ownerColumns(game.owner),
          state: null,
          stateEncrypted: this.vault.encryptJson(stateKeyId(id), STATE_FIELD, game.state),
          revision: 0,
          total: 0,
          dailyDate: game.dailyDate ?? null,
        })
        .returning(META_COLUMNS);
    } catch (error) {
      if (game.dailyDate !== undefined && isDuplicateDaily(error)) throw new DuplicateDailyGameError(game.dailyDate);
      throw error;
    }
    if (row === undefined) throw new Error("PgGameStore: insert returned no row");
    return withState(row, game.state);
  }

  /**
   * `create` under the unfinished-games cap (#85), atomically (#225). One
   * transaction of two statements:
   * 1. a transaction-level advisory lock on (owner, pack), so two starts for
   *    the same owner and pack take turns (others don't wait);
   * 2. `INSERT ... SELECT ... WHERE (unfinished count) < cap`, which inserts
   *    nothing at the cap. It starts after the lock is held, so its count
   *    includes a game the previous holder just committed.
   * A single conditional INSERT without the lock isn't enough: under read
   * committed, two at once both count from before either inserted.
   */
  private async createCapped(id: string, game: NewStoredGame, cap: number): Promise<StoredGame> {
    const { userId, anonOwnerHash } = ownerColumns(game.owner);
    const mine = userId !== null ? sql`user_id = ${userId}::uuid` : sql`anon_owner_hash = ${anonOwnerHash}`;
    const lockKey = `games:unfinished:${userId !== null ? `user:${userId}` : `anon:${anonOwnerHash}`}:${game.packId}`;
    // The INSERT repeats `create`'s columns and values (and RETURNING repeats
    // META_COLUMNS): keep the two in sync when the games table changes.
    const results = await inOneTransaction(this.db, [
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
      sql`
        INSERT INTO games (id, pack_id, user_id, anon_owner_hash, state, state_encrypted, revision, total)
        SELECT ${id}::uuid, ${game.packId}, ${userId}::uuid, ${anonOwnerHash}, NULL,
               ${this.vault.encryptJson(stateKeyId(id), STATE_FIELD, game.state)}, 0, 0
        WHERE (SELECT count(*) FROM games WHERE ${mine} AND pack_id = ${game.packId} AND finished_at IS NULL) < ${cap}
        RETURNING id, pack_id AS "packId", user_id AS "userId", anon_owner_hash AS "anonOwnerHash", revision,
                  daily_date::text AS "dailyDate"
      `,
    ]);
    const [row] = rowsOf(results[1]) as MetaRow[];
    if (row === undefined) throw new UnfinishedGamesCapError(game.packId);
    return withState(row, game.state);
  }

  async save(game: StoredGame): Promise<StoredGame> {
    const { state } = game;
    // Only the state changes: id, owner and pack stay as created, so
    // `game.owner` is ignored (like MemoryGameStore). Ids come from URLs; one
    // that isn't a UUID can't exist (and would be a Postgres type error).
    if (!UUID.test(game.id)) throw new GameNotFoundError();
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
        SET state = NULL,
            state_encrypted = ${this.vault.encryptJson(stateKeyId(game.id), STATE_FIELD, state)},
            revision = revision + 1,
            total = ${total},
            finished_at = CASE WHEN ${state.finished}::boolean THEN coalesce(finished_at, now()) ELSE NULL END,
            updated_at = now()
        WHERE id = ${game.id}::uuid AND revision = ${game.revision}
        RETURNING id, pack_id, user_id, anon_owner_hash, revision, daily_date
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
      SELECT id, pack_id AS "packId", user_id AS "userId", anon_owner_hash AS "anonOwnerHash", revision,
             daily_date::text AS "dailyDate"
      FROM updated
    `);

    const [row] = rowsOf(result) as MetaRow[];
    if (row !== undefined) return withState(row, state);
    // Nothing updated: the game is gone, or another request saved first.
    // Only check that the row exists: no need to fetch and decrypt its state.
    const [exists] = await this.db.select({ id: games.id }).from(games).where(eq(games.id, game.id));
    if (exists === undefined) throw new GameNotFoundError();
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
  /**
   * The owner's unfinished games of this pack, most recently played first, so
   * at the cap the next one can be resumed when the latest can't be read
   * (#164). At most `limit`.
   */
  recentIds: string[];
};

/**
 * The owner's unfinished games of one pack, for the per-pack cap and for
 * reuse (#85). One query. Only a hint for the caller: another start may
 * insert a game right after it. The cap itself is enforced atomically by
 * `PgGameStore.create` (`maxUnfinishedPerPack`, #225), which throws
 * `UnfinishedGamesCapError` at the cap.
 */
export async function findUnfinishedGames(
  db: Db,
  owner: GameOwner,
  packId: string,
  limit: number,
): Promise<UnfinishedGames> {
  const { userId, anonOwnerHash } = ownerColumns(owner);
  const mine = userId !== null ? sql`user_id = ${userId}::uuid` : sql`anon_owner_hash = ${anonOwnerHash}`;
  const result = await db.execute(sql`
    SELECT
      (SELECT count(*) FROM games WHERE ${mine} AND pack_id = ${packId} AND finished_at IS NULL) AS "count",
      (SELECT id FROM games WHERE ${mine} AND pack_id = ${packId} AND finished_at IS NULL AND revision = 0
        ORDER BY created_at DESC LIMIT 1) AS "untouchedId",
      ARRAY(SELECT id::text FROM games WHERE ${mine} AND pack_id = ${packId} AND finished_at IS NULL
        ORDER BY updated_at DESC LIMIT ${limit}) AS "recentIds"
  `);
  const [row] = rowsOf(result);
  return {
    count: Number(row?.count ?? 0),
    untouchedId: (row?.untouchedId as string | null | undefined) ?? null,
    recentIds: (row?.recentIds as string[] | null | undefined) ?? [],
  };
}
