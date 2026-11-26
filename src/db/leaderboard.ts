// The daily leaderboard (#62). Owner: Ethan. Per day: the top players by
// their server-calculated total, plus one player's own rank.
//
// Who counts: logged-in players (`user_id`), finished games, that day's daily
// (`daily_date`). The database allows one daily game per player per day
// (`games_daily_user_key`), so each player has at most one entry. Anonymous
// games never count (decided in #58).
//
// What leaves this file: `LeaderboardEntry` only (rank, username, score,
// beatAiCount), never a user id. Usernames are encrypted per user (#84), so
// each entry costs one decryption; the server caches the top list
// (src/server/leaderboard.ts).
//
// No "server-only" import (tests run it); only for server code.

import { sql } from "drizzle-orm";

import { USERNAME_FIELD } from "../auth/user-row.ts";
import type { Vault } from "../crypto/vault.ts";
import { LEADERBOARD_SIZE, UNKNOWN_PLAYER } from "../game/leaderboard.ts";
import type { LeaderboardEntry } from "../game/types.ts";
import type { AnyDb } from "./content.ts";
import { rowsOf } from "./rows.ts";

export { LEADERBOARD_SIZE, UNKNOWN_PLAYER };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The games on `date`'s board, as a SQL fragment over `games g`. */
const onBoard = (date: string) => sql`
  g.daily_date = ${date}::date
  AND g.user_id IS NOT NULL
  AND g.finished_at IS NOT NULL
`;

/**
 * Beat the AI (#56, #66): images in game `g` the player got right at an
 * earlier zoom level than the AI's first correct guess. The same level is a
 * tie, not a win. An image the AI never got, or wasn't run on
 * (`ai_solved_level` NULL), doesn't count. The same rule as `aiVerdict` in
 * src/game/beat-ai.ts (the round screen and the final screen); change both
 * together.
 */
const beatAiCount = sql`(
  SELECT count(*)::int FROM game_rounds r JOIN puzzles pz ON pz.id = r.puzzle_id
  WHERE r.game_id = g.id
    AND r.outcome = 'correct'
    AND pz.ai_solved_level IS NOT NULL
    AND r.reveal_level_reached < pz.ai_solved_level
)`;

type Row = Record<string, unknown>;

/** Rows with `rank`, `score`, `user_id`, `username_encrypted` and `beat_ai` as entries. Also used by the lobby board (#67). */
export function toEntries(vault: Vault, rows: Row[]): LeaderboardEntry[] {
  let failed = false;
  const entries = rows.map((r) => {
    let username = UNKNOWN_PLAYER;
    try {
      username = vault.decrypt(String(r.user_id), USERNAME_FIELD, String(r.username_encrypted));
    } catch {
      failed = true;
    }
    return { rank: Number(r.rank), username, score: Number(r.score), beatAiCount: Number(r.beat_ai) };
  });
  // Once per call, without the error (it could carry the ciphertext).
  if (failed) console.error("Leaderboard: a username couldn't be decrypted (is DATA_ENCRYPTION_KEY right for this tier?)");
  return entries;
}

/**
 * The top `LEADERBOARD_SIZE` players on `date` (a `YYYY-MM-DD` daily date),
 * best first, and how many players finished that day. Ranks are competition
 * ranks: a tie shares a rank and the next rank skips (1, 2, 2, 4). Ties are
 * listed by who finished first. The cut at `LEADERBOARD_SIZE` can fall inside
 * a tie (ranks 9, 10, 10, 10 lists only the first rank-10 player to finish);
 * that's intended, and the others still see their rank from `getDailyRank`.
 */
export async function getDailyTop(db: AnyDb, vault: Vault, date: string): Promise<{ top: LeaderboardEntry[]; players: number }> {
  const rows = rowsOf(
    await db.execute(sql`
      WITH board AS (
        SELECT g.id, g.user_id, g.total, g.finished_at,
               rank() OVER (ORDER BY g.total DESC) AS rank,
               count(*) OVER () AS players
        FROM games g
        WHERE ${onBoard(date)}
      )
      SELECT g.rank, g.total AS score, g.user_id, g.players, u.username_encrypted, ${beatAiCount} AS beat_ai
      FROM board g JOIN users u ON u.id = g.user_id
      ORDER BY g.rank, g.finished_at, g.id
      LIMIT ${LEADERBOARD_SIZE}
    `),
  );
  return { top: toEntries(vault, rows), players: Number(rows[0]?.players ?? 0) };
}

/** Your own entry, and how many players finished that day, counted at the same moment. */
export type DailyRank = { entry: LeaderboardEntry; players: number };

/**
 * `userId`'s own entry on `date`, ranked like `getDailyTop` (1 + the number of
 * players with a higher score), and the day's player count from the same
 * query, or null if they have no finished daily game that day. The count is
 * here so "Your rank: X of N" never mixes a fresh rank with a cached count.
 */
export async function getDailyRank(db: AnyDb, vault: Vault, date: string, userId: string): Promise<DailyRank | null> {
  if (!UUID.test(userId)) return null;
  const rows = rowsOf(
    await db.execute(sql`
      SELECT g.total AS score, g.user_id, u.username_encrypted, ${beatAiCount} AS beat_ai,
             1 + (SELECT count(*) FROM games g WHERE ${onBoard(date)} AND g.total > me.total)::int AS rank,
             (SELECT count(*) FROM games g WHERE ${onBoard(date)})::int AS players
      FROM games g
      JOIN users u ON u.id = g.user_id
      CROSS JOIN LATERAL (SELECT g.total) AS me(total)
      WHERE ${onBoard(date)} AND g.user_id = ${userId}::uuid
    `),
  );
  const entry = toEntries(vault, rows)[0];
  return entry === undefined ? null : { entry, players: Number(rows[0]!.players) };
}
