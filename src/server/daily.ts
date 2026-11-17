// The daily challenge on the server (#58). Server-only: it reads the database.
import "server-only";

import { getDb } from "@/db";
import { getTodaysDaily, toIntro, type DailyIntro } from "@/db/daily";
import { DEFAULT_DAILY_RESET, type DailyResetConfig } from "@/game/daily-date";

/**
 * When a new daily challenge starts. Decided in #58: midnight Pacific
 * (`DEFAULT_DAILY_RESET`, #63). Change it here, not in the date logic.
 */
export const DAILY_RESET: Readonly<DailyResetConfig> = DEFAULT_DAILY_RESET;

/** What today's intro screen shows. No puzzle ids, answers or images. */
export async function loadDailyIntro(now = new Date()): Promise<DailyIntro> {
  return toIntro(await getTodaysDaily(getDb(), now, DAILY_RESET));
}
