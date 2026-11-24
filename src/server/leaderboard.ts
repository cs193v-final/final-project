// The daily leaderboard on the server (#62). Server-only: it reads the database.
import "server-only";

import { cacheLife } from "next/cache";

import { getCurrentUser } from "@/auth/session";
import { getVault } from "@/crypto/vault";
import { getDb } from "@/db";
import { getDailyRank, getDailyTop } from "@/db/leaderboard";
import type { LeaderboardEntry } from "@/game/types";

import { dailyDateAt } from "./daily";

export type DailyLeaderboard = {
  /** The daily date (`YYYY-MM-DD`) the board is for. */
  date: string;
  top: LeaderboardEntry[];
  /** How many logged-in players finished that day's daily. */
  players: number;
  /** Logged out: null. Logged in: your entry, or null if you haven't finished today's daily. */
  you: LeaderboardEntry | null;
  loggedIn: boolean;
};

/**
 * Today's board and the current player's own entry. The top list is the same
 * for everyone, so it's cached per date (like the daily intro): reloading the
 * page in a loop doesn't query the database or decrypt up to ten usernames
 * each time. Your own rank is one small indexed query, at request time.
 */
export async function loadDailyLeaderboard(now = new Date()): Promise<DailyLeaderboard> {
  const date = dailyDateAt(now);
  const [board, user] = await Promise.all([cachedTop(date), getCurrentUser()]);
  const you = user === null ? null : await getDailyRank(getDb(), getVault(), date, user.id);
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
