// The daily challenge's intro data (#58). Owner: Joseph. Framework-free and
// shared by the server (which builds it) and the intro screen (which shows it).

import type { DailyResetConfig } from "./daily-date.ts";

/**
 * Everything the daily intro screen may show before play: the day, today's
 * theme and how many images, and when the next challenge starts. No pack or
 * puzzle ids, answers or images.
 */
export type DailyIntro = {
  date: string; // "YYYY-MM-DD" in the reset time zone
  reset: DailyResetConfig; // the rule `date` came from, so the "next challenge" line can't disagree
  pack: { theme: string; puzzleCount: number } | null; // null: nothing scheduled today
};
