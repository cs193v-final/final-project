// Today's daily challenge (#58). Owner: Joseph.
//
// The day comes from the reset rule (`dailyDateFor`, #63), the pack from the
// daily schedule (#52). Everyone asking at the same moment gets the same date,
// so the same pack.
//
// No "server-only" import, like the rest of src/db's content helpers, so tests
// can run it; it's still only for server code (it reads the database).

import { dailyDateFor, type DailyResetConfig } from "../game/daily-date.ts";
import type { Pack } from "../game/types.ts";
import { getDailyEntry, getPack, type AnyDb } from "./content.ts";

/**
 * What the daily screen may show before play: no puzzle ids, answers or
 * images, only what the intro says ("Today: Fruit, 5 images").
 */
export type DailyIntro = {
  date: string; // "YYYY-MM-DD" in the reset time zone
  pack: { title: string; theme: string; puzzleCount: number } | null; // null: nothing scheduled today
};

export type TodaysDaily = DailyIntro & {
  /** Server-only: the full pack, to start the game with (#58 part 2, with #54). */
  fullPack: Pack | null;
};

/** The daily challenge for the day `now` falls in. */
export async function getTodaysDaily(db: AnyDb, now: Date, reset: Readonly<DailyResetConfig>): Promise<TodaysDaily> {
  const date = dailyDateFor(now, reset);
  const entry = await getDailyEntry(db, date);
  const pack = entry ? await getPack(db, entry.packId) : null;
  if (!pack || pack.puzzleIds.length === 0) return { date, pack: null, fullPack: null };
  return {
    date,
    pack: { title: pack.title, theme: pack.theme, puzzleCount: pack.puzzleIds.length },
    fullPack: pack,
  };
}

/** Just what the browser may see. */
export function toIntro({ date, pack }: TodaysDaily): DailyIntro {
  return { date, pack };
}
