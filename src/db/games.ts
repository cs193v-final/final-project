// The Postgres `GameStore` (#54) on the `games` table (#47). Server-only.
//
// `src/game/server-game.ts` runs the games; this file only stores them.
// The same contract tests run against this store (on PGlite with the real
// migrations, see games.test.ts) and against `MemoryGameStore`.
//
// Encryption (#84): the game state (the player's guesses and moves) is stored
// only encrypted, in `state_encrypted`, with a key for this owner and this
// game (`stateKeyId`). Games written before that still have a plain `state`;
// they're read as they are, and encrypted the next time they're saved (or by
// `npm run db:encrypt-games`). `total`, `finished_at` and `game_rounds` stay
// plain: leaderboards (#62) sort and filter on them in SQL.
import "server-only";

import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";

import type { Vault } from "@/crypto/vault";

import type { GameOwner, GameState, GameStore, NewStoredGame, StoredGame } from "@/game/server-game";
import { GameConflictError, GameNotFoundError } from "@/game/server-game";
import { scoreGame } from "@/game/scoring";
import type { Pack } from "@/game/types";
import type { Db } from "./index";
import { STATE_FIELD, stateKeyId } from "./game-state-key";
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
  recordRounds?: boolean;
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
  /** Only on games written before #84; NULL once encrypted. */
  state: unknown;
  stateEncrypted: string | null;
  revision: number;
};

function fromRow(vault: Vault, row: GameRow): StoredGame {
  let owner: GameOwner;
  if (row.userId !== null) owner = { userId: row.userId };
  else if (row.anonOwnerHash !== null) owner = { anonId: row.anonOwnerHash };
  else throw new Error(`PgGameStore: game ${row.id} has no owner`);
  let state: GameState;
  if (row.stateEncrypted !== null) {
    state = vault.decryptJson<GameState>(stateKeyId(owner, row.id), STATE_FIELD, row.stateEncrypted);
  } else {
    // Written before #84. Raw `execute` results may hand jsonb back as text, depending on the driver.
    state = (typeof row.state === "string" ? JSON.parse(row.state) : row.state) as GameState;
  }
  return { id: row.id, owner, packId: row.packId, revision: Number(row.revision), state };
}

const ROW_COLUMNS = {
  id: games.id,
  packId: games.packId,
  userId: games.userId,
  anonOwnerHash: games.anonOwnerHash,
  state: games.state,
  stateEncrypted: games.stateEncrypted,
  revision: games.revision,
};

/** `db.execute` returns `{ rows }` on every driver we use (Neon HTTP, node-postgres, PGlite). */
function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const rows = (result as { rows?: unknown } | null)?.rows;
  if (Array.isArray(rows)) return rows as Record<string, unknown>[];
  throw new Error("PgGameStore: unexpected result from db.execute");
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
  private readonly recordRounds: boolean;

  constructor(
    private readonly db: Db,
    private readonly vault: Vault,
    options: PgGameStoreOptions = {},
  ) {
    this.recordRounds = options.recordRounds ?? true;
  }

  async get(id: string): Promise<StoredGame | null> {
    // Ids come from URLs; anything that isn't a UUID can't exist (and would be
    // a Postgres type error).
    if (!UUID.test(id)) return null;
    const [row] = await this.db.select(ROW_COLUMNS).from(games).where(eq(games.id, id));
    return row === undefined ? null : fromRow(this.vault, row);
  }

  async create(game: NewStoredGame): Promise<StoredGame> {
    // The id is made here, not by the database, so the encrypted state can be
    // bound to it before the row exists.
    const id = randomUUID();
    const owner = ownerColumns(game.owner);
    const [row] = await this.db
      .insert(games)
      .values({
        id,
        packId: game.packId,
        ...owner,
        state: null,
        stateEncrypted: this.vault.encryptJson(stateKeyId(game.owner, id), STATE_FIELD, game.state),
        revision: 0,
        total: 0,
      })
      .returning(ROW_COLUMNS);
    if (row === undefined) throw new Error("PgGameStore: insert returned no row");
    return fromRow(this.vault, row);
  }

  async save(game: StoredGame): Promise<StoredGame> {
    const { state } = game;
    // The state is encrypted for its owner, so the update only applies if
    // `game.owner` is the stored owner (see the end for when it isn't).
    const owner = ownerColumns(game.owner);
    const { rounds, total } = scoreGame(state.events, state.scoring);
    // Rounds are scored in play order, so position = index + 1. Every save
    // sends all finished rounds; ON CONFLICT skips the ones already written.
    const roundRows = this.recordRounds
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
            state_encrypted = ${this.vault.encryptJson(stateKeyId(game.owner, game.id), STATE_FIELD, state)},
            revision = revision + 1,
            total = ${total},
            finished_at = CASE WHEN ${state.finished}::boolean THEN coalesce(finished_at, now()) ELSE NULL END,
            updated_at = now()
        WHERE id = ${game.id}::uuid AND revision = ${game.revision}
          AND user_id IS NOT DISTINCT FROM ${owner.userId}::uuid
          AND anon_owner_hash IS NOT DISTINCT FROM ${owner.anonOwnerHash}
        RETURNING id, pack_id, user_id, anon_owner_hash, state, state_encrypted, revision
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
      SELECT id, pack_id AS "packId", user_id AS "userId", anon_owner_hash AS "anonOwnerHash", state,
             state_encrypted AS "stateEncrypted", revision
      FROM updated
    `);

    const [row] = rowsOf(result) as GameRow[];
    if (row !== undefined) return fromRow(this.vault, row);
    // Nothing updated: the game is gone, another request saved first, or the
    // caller passed a different owner. A save never changes the owner, so in
    // that last case save again as the stored owner (whose key the state uses).
    const current = UUID.test(game.id) ? await this.get(game.id) : null;
    if (current === null) throw new GameNotFoundError();
    if (current.revision === game.revision && stateKeyId(current.owner, game.id) !== stateKeyId(game.owner, game.id)) {
      return this.save({ ...game, owner: current.owner });
    }
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
