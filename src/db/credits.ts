// Photo credits for the /credits page (#239). Owner: Joseph.
//
// Only dailies scheduled before today: listing today's or a future day's
// photos (their source pages show the photo and often its name) would spoil
// them. Stanford and lobby packs can be played any time, so they're left out
// too; their credits show after each round, as every pack's do.
//
// No "server-only" import, like the rest of src/db's content helpers, so tests
// can run it; it's still only for server code (it reads the database).

import { and, asc, desc, eq, lt } from "drizzle-orm";

import type { DailyCredits } from "../game/credits.ts";
import type { AnyDb } from "./content.ts";
import { dailySchedule, packPuzzles, packs, puzzles } from "./schema.ts";

export type { DailyCredits };

/** Every daily scheduled before `today` (YYYY-MM-DD), newest first, with its photos' credits. */
export async function getPastDailyCredits(db: AnyDb, today: string): Promise<DailyCredits[]> {
  const rows = await db
    .select({
      date: dailySchedule.date,
      title: packs.title,
      source: puzzles.creditSource,
      license: puzzles.creditLicense,
      url: puzzles.creditUrl,
    })
    .from(dailySchedule)
    .innerJoin(packs, eq(packs.id, dailySchedule.packId))
    .innerJoin(packPuzzles, eq(packPuzzles.packId, packs.id))
    .innerJoin(puzzles, eq(puzzles.id, packPuzzles.puzzleId))
    .where(and(lt(dailySchedule.date, today), eq(packs.kind, "daily")))
    .orderBy(desc(dailySchedule.date), asc(packPuzzles.position));
  const days: DailyCredits[] = [];
  for (const row of rows) {
    let day = days.at(-1);
    if (day?.date !== row.date) {
      day = { date: row.date, title: row.title, credits: [] };
      days.push(day);
    }
    day.credits.push({ source: row.source, license: row.license, ...(row.url === null ? {} : { url: row.url }) });
  }
  return days;
}
