// Photo credits on the server (#239). Server-only: it reads the database.
import "server-only";

import { cacheLife } from "next/cache";

import { getDb } from "@/db";
import { getPastDailyCredits } from "@/db/credits";
import type { DailyCredits } from "@/game/credits";

import { dailyDateAt } from "./daily";

/**
 * Credits for the dailies before today. The day is worked out per request;
 * the list for that day is the same for everyone, so it's cached per date
 * (like the daily intro), and reloading /credits doesn't query each time.
 */
export async function loadPastDailyCredits(now = new Date()): Promise<DailyCredits[]> {
  return cachedCredits(dailyDateAt(now));
}

async function cachedCredits(today: string): Promise<DailyCredits[]> {
  "use cache";
  cacheLife("minutes");
  return getPastDailyCredits(getDb(), today);
}
