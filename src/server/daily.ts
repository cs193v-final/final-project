// The daily challenge on the server (#58). Server-only: it reads the database.
import "server-only";

import { cacheLife } from "next/cache";

import { getDb } from "@/db";
import { getDailyIntro } from "@/db/daily";
import { dailyDateFor, DEFAULT_DAILY_RESET } from "@/game/daily-date";
import type { DailyIntro } from "@/game/daily";

/**
 * Today's intro. The day is worked out per request (cheap, no database); the
 * intro for that day is cached, because it's the same for everyone, so
 * reloading /daily in a loop doesn't query the database each time (security
 * review of #100). The reset rule is `DEFAULT_DAILY_RESET`, the one place it's
 * set (#63, decided in #58).
 */
export async function loadDailyIntro(now = new Date()): Promise<DailyIntro> {
  return cachedIntro(dailyDateFor(now, DEFAULT_DAILY_RESET));
}

/**
 * Cached per date (the argument is part of the cache key). After a reset the
 * date changes, so it's a new entry. "minutes": refreshed in the background
 * after a minute, so a pack seeded during the day shows up within about a
 * minute, and the database sees at most about one query a minute per server.
 * A broken day (a scheduled pack with no puzzles) is a result, so it's cached
 * too; only a database error is thrown, and isn't cached.
 */
async function cachedIntro(date: string): Promise<DailyIntro> {
  "use cache";
  cacheLife("minutes");
  return getDailyIntro(getDb(), date);
}
