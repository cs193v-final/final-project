// The daily leaderboard on the server (#62). Server-only: it reads the database.
import "server-only";

import { cacheLife } from "next/cache";

import { getCurrentUser } from "@/auth/session";
import { getVault } from "@/crypto/vault";
import { getDb } from "@/db";
import { getDailyRank, getDailyTop, type DailyRank } from "@/db/leaderboard";
import type { LeaderboardEntry } from "@/game/types";

import { dailyDateAt } from "./daily";

/**
 * Whether logged-out visitors see the top list. The team hasn't decided whether
 * usernames on the board are public (they're also login names, #53); see #62.
 * Today: public. Turning it off hides the list from logged-out visitors only.
 */
export const LEADERBOARD_PUBLIC = true;

export type DailyLeaderboard = {
  /** The daily date (`YYYY-MM-DD`) the board is for. */
  date: string;
  /** Cached for about a minute, so it may not have a player who just finished yet. */
  top: LeaderboardEntry[];
  /** How many logged-in players finished that day's daily (cached with `top`). */
  players: number;
  /** Logged out: null. Logged in: your entry and a fresh player count, or null if you haven't finished today's daily. */
  you: DailyRank | null;
  loggedIn: boolean;
  /** The top list is hidden from this visitor (`LEADERBOARD_PUBLIC` is off and they're logged out). */
  topHidden?: boolean;
};

/**
 * Today's board and the current player's own entry. The top list is the same
 * for everyone, so it's cached per date (like the daily intro): reloading the
 * page in a loop doesn't query the database or decrypt up to ten usernames
 * each time. Your own rank, and the player count next to it, are read fresh at
 * request time. Both use the partial index `games_daily_date_total_idx`
 * (migration 0008, #206).
 */
export async function loadDailyLeaderboard(now = new Date()): Promise<DailyLeaderboard> {
  const date = dailyDateAt(now);
  const user = await getCurrentUser();
  if (!LEADERBOARD_PUBLIC && user === null) return { date, top: [], players: 0, you: null, loggedIn: false, topHidden: true };
  const [board, you] = await Promise.all([
    cachedTop(date),
    user === null ? null : getDailyRank(getDb(), getVault(), date, user.id),
  ]);
  return { date, ...board, you, loggedIn: user !== null };
}

/**
 * Cached per date. "minutes": refreshed in the background after a minute, so
 * a new score shows up within about a minute, and the database sees at most
 * about one query a minute per server. A database error is thrown, not cached.
 */
async function cachedTop(date: string) {
  "use cache";
  cacheLife("minutes");
  return getDailyTop(getDb(), getVault(), date);
}
