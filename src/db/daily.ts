// Today's daily challenge (#58). Owner: Joseph.
//
// The day comes from the reset rule (`dailyDateFor`, #63), the pack from the
// daily schedule (#52). Everyone asking at the same moment gets the same date,
// so the same pack.
//
// No "server-only" import, like the rest of src/db's content helpers, so tests
// can run it; it's still only for server code (it reads the database).

import { asc, eq } from "drizzle-orm";

import { dailyDateFor, type DailyResetConfig } from "../game/daily-date.ts";
import type { DailyIntro } from "../game/daily.ts";
import type { Pack } from "../game/types.ts";
import type { AnyDb } from "./content.ts";
import { dailySchedule, packPuzzles, packs } from "./schema.ts";

/** Thrown when a day's pack exists but can't be played (e.g. it has no puzzles). Not the same as "nothing scheduled". */
export class BrokenDailyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrokenDailyError";
  }
}

/**
 * The daily pack scheduled on `date`, with its puzzles in order, in one query.
 * `null` if nothing (or a pack that isn't daily) is scheduled that day. Throws
 * `BrokenDailyError` if the scheduled pack has no puzzles: that's a content
 * problem to fix (e.g. a seed run that stopped partway), not an empty day.
 */
export async function getDailyPack(db: AnyDb, date: string): Promise<Pack | null> {
  const rows = await db
    .select({ id: packs.id, kind: packs.kind, title: packs.title, theme: packs.theme, puzzleId: packPuzzles.puzzleId })
    .from(dailySchedule)
    .innerJoin(packs, eq(packs.id, dailySchedule.packId))
    .leftJoin(packPuzzles, eq(packPuzzles.packId, packs.id))
    .where(eq(dailySchedule.date, date))
    .orderBy(asc(packPuzzles.position));
  const first = rows[0];
  if (!first || first.kind !== "daily") return null;
  const puzzleIds = rows.flatMap((r) => (r.puzzleId === null ? [] : [r.puzzleId]));
  if (puzzleIds.length === 0) throw new BrokenDailyError(`daily pack ${first.id} on ${date} has no puzzles`);
  return { id: first.id, kind: "daily", title: first.title, theme: first.theme, puzzleIds };
}

/** The intro for `date` (no ids, answers or images). */
export async function getDailyIntro(db: AnyDb, date: string, reset: Readonly<DailyResetConfig>): Promise<DailyIntro> {
  const pack = await getDailyPack(db, date);
  return { date, reset: { ...reset }, pack: pack && { theme: pack.theme, puzzleCount: pack.puzzleIds.length } };
}

/** The day `now` falls in, under `reset`. */
export function todaysDate(now: Date, reset: Readonly<DailyResetConfig>): string {
  return dailyDateFor(now, reset);
}
