// The daily challenge's intro data (#58). Owner: Joseph. Framework-free and
// shared by the server (which builds it) and the intro screen (which shows it).

/**
 * Everything the daily intro screen may show before play: the day, today's
 * theme and how many images. No pack or
 * puzzle ids, answers or images.
 */
export type DailyIntro = {
  date: string; // "YYYY-MM-DD" in the reset time zone (DEFAULT_DAILY_RESET)
  pack: { theme: string; puzzleCount: number } | null; // null: nothing scheduled today
  /** A pack is scheduled but can't be played (e.g. no puzzles after a partial seed). */
  broken?: true;
};
