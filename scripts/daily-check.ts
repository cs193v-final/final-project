// Checks that the daily schedule covers every day from today through a given
// date (#223): each day has a scheduled pack, the pack is a daily pack, and it
// has at least one puzzle. READ-ONLY: it never writes to the database.
//
//   npm run db:daily-check                          # today through today + 14 days
//   npm run db:daily-check -- --through 2026-12-10
//
// "Today" is the daily's own today: the date in the reset time zone (midnight
// Pacific, #58), from `dailyDateFor` with `DEFAULT_DAILY_RESET`, the same rule
// as `dailyDateAt` in src/server/daily.ts.
//
// Prints dates and counts only, never pack ids, themes or answers, so the
// output can go in a public issue comment (the repo is public).
//
// Exit code: 0 when every day is covered, 1 when there are gaps, 2 when it
// couldn't check (bad arguments, no or insecure database URL, database error).
//
// Connects like scripts/pack-scoring.ts: DATABASE_URL_UNPOOLED from the
// environment, or from .env.local when it's unset, through `connect` in
// ./seed-db.ts (TLS check, then node-postgres for loopback, Neon HTTP
// otherwise). Runs with plain Node (type stripping), so imports use relative
// paths with `.ts`.
import { existsSync } from "node:fs";

import { and, count, eq, gte, lte } from "drizzle-orm";

import type { AnyDb } from "../src/db/content.ts";
import { dailySchedule, packPuzzles, packs } from "../src/db/schema.ts";
import { InsecureDatabaseUrlError } from "../src/db/tls.ts";
import { addDays, assertDailyDate, dailyDateFor, daysBetween, DEFAULT_DAILY_RESET } from "../src/game/daily-date.ts";
import { connect } from "./seed-db.ts";

/** Default range when --through isn't given: today plus this many days. */
export const DEFAULT_DAYS_AHEAD = 14;
/** Longest range checked, so a typo like 2062 doesn't print thousands of lines. */
export const MAX_DAYS = 366;

/** The daily's today at `now`: the same rule as `dailyDateAt` in src/server/daily.ts (server-only). */
export const dailyToday = (now: Date) => dailyDateFor(now, DEFAULT_DAILY_RESET);

export const USAGE = `Usage:
  npm run db:daily-check                           (today through today + ${DEFAULT_DAYS_AHEAD} days)
  npm run db:daily-check -- --through YYYY-MM-DD`;

export class UsageError extends Error {
  constructor(message: string) {
    super(`${message}\n\n${USAGE}`);
    this.name = "UsageError";
  }
}

export type Range = { from: string; through: string };

/**
 * Parses the command line into the range to check, starting at `today` (a
 * daily date). Throws a UsageError for unknown arguments, a date that isn't a
 * real "YYYY-MM-DD", a date before today, or a range over MAX_DAYS days.
 */
export function parseArgs(args: readonly string[], today: string): Range {
  let through: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    let value: string | undefined;
    if (arg === "--through") {
      value = args[++i];
      if (value === undefined) throw new UsageError("--through needs a date.");
    } else if (arg.startsWith("--through=")) {
      value = arg.slice("--through=".length);
    } else {
      throw new UsageError(`Unknown argument "${arg}".`);
    }
    if (through !== undefined) throw new UsageError("--through given more than once.");
    through = value;
  }
  if (through === undefined) return { from: today, through: addDays(today, DEFAULT_DAYS_AHEAD) };
  try {
    assertDailyDate(through);
  } catch {
    throw new UsageError(`--through "${through}" is not a real date as YYYY-MM-DD.`);
  }
  const days = daysBetween(today, through) + 1;
  if (days < 1) throw new UsageError(`--through ${through} is before today (${today}, Pacific).`);
  if (days > MAX_DAYS) throw new UsageError(`--through ${through} is more than ${MAX_DAYS} days away.`);
  return { from: today, through };
}

/** Every daily date from `from` through `through`, inclusive. Empty if `through` is earlier. */
export function datesInRange({ from, through }: Range): string[] {
  const days = daysBetween(from, through);
  return Array.from({ length: Math.max(0, days + 1) }, (_, i) => addDays(from, i));
}

/** One scheduled day, as the query returns it: no pack id or theme. */
export type ScheduledDay = { date: string; kind: string; puzzleCount: number };

export type Coverage = {
  range: Range;
  /** Days in the range. */
  total: number;
  /** Days with a daily pack that has at least one puzzle. */
  covered: number;
  /** Days with nothing scheduled. */
  missing: string[];
  /** Days whose pack has no puzzles (the app shows a broken daily). */
  noPuzzles: string[];
  /** Days whose pack isn't of kind "daily" (the app shows no daily). */
  notDaily: string[];
};

/** Compares the range with what's scheduled. Rows outside the range are ignored. */
export function findGaps(range: Range, scheduled: readonly ScheduledDay[]): Coverage {
  const byDate = new Map(scheduled.map((day) => [day.date, day]));
  const coverage: Coverage = { range, total: 0, covered: 0, missing: [], noPuzzles: [], notDaily: [] };
  for (const date of datesInRange(range)) {
    coverage.total++;
    const day = byDate.get(date);
    if (day === undefined) coverage.missing.push(date);
    else if (day.kind !== "daily") coverage.notDaily.push(date);
    else if (day.puzzleCount < 1) coverage.noPuzzles.push(date);
    else coverage.covered++;
  }
  return coverage;
}

export const isFullyCovered = (c: Coverage) => c.covered === c.total;

/** What to print: dates and counts only. */
export function formatCoverage(c: Coverage): string {
  const lines = [
    `Daily schedule ${c.range.from} through ${c.range.through} (Pacific): ${c.covered} of ${c.total} days covered.`,
  ];
  const list = (label: string, dates: string[]) => {
    if (dates.length > 0) lines.push(`${label} (${dates.length}):`, ...dates.map((d) => `  ${d}`));
  };
  list("Nothing scheduled", c.missing);
  list("Scheduled pack has no puzzles", c.noPuzzles);
  list("Scheduled pack is not a daily pack", c.notDaily);
  if (isFullyCovered(c)) lines.push("Every day is covered.");
  return lines.join("\n");
}

/** Reads the schedule for `range`: one row per scheduled day, with its puzzle count. Read-only. */
export async function readSchedule(db: AnyDb, range: Range): Promise<ScheduledDay[]> {
  return db
    .select({ date: dailySchedule.date, kind: packs.kind, puzzleCount: count(packPuzzles.puzzleId) })
    .from(dailySchedule)
    .innerJoin(packs, eq(packs.id, dailySchedule.packId))
    .leftJoin(packPuzzles, eq(packPuzzles.packId, packs.id))
    .where(and(gte(dailySchedule.date, range.from), lte(dailySchedule.date, range.through)))
    .groupBy(dailySchedule.date, packs.kind);
}

/** Reads the schedule and checks it. */
export async function checkSchedule(db: AnyDb, range: Range): Promise<Coverage> {
  return findGaps(range, await readSchedule(db, range));
}

function databaseUrl(): string {
  if (process.env.DATABASE_URL_UNPOOLED === undefined && existsSync(".env.local")) {
    process.loadEnvFile(".env.local");
  }
  const url = process.env.DATABASE_URL_UNPOOLED;
  if (!url) {
    throw new UsageError(
      "DATABASE_URL_UNPOOLED is not set. For dev it comes from .env.local; for preview or production, see TECHNICAL.md → Database.",
    );
  }
  return url;
}

async function main(): Promise<void> {
  try {
    const range = parseArgs(process.argv.slice(2), dailyToday(new Date()));
    const url = databaseUrl();
    const { db, close } = await connect(url, "DATABASE_URL_UNPOOLED");
    try {
      // Only the host is printed, never the credentials.
      console.log(`Database host: ${new URL(url).host}`);
      const coverage = await checkSchedule(db, range);
      console.log(formatCoverage(coverage));
      process.exitCode = isFullyCovered(coverage) ? 0 : 1;
    } finally {
      await close();
    }
  } catch (error) {
    process.exitCode = 2;
    if (error instanceof UsageError || error instanceof InsecureDatabaseUrlError) {
      console.error(error.message);
      return;
    }
    // Network or database: the message chain, not a stack trace (as in
    // scripts/pack-scoring.ts). Driver errors don't include the URL.
    let current: unknown = error;
    for (let depth = 0; current !== undefined && depth < 5; depth++) {
      const message = current instanceof Error ? current.message : String(current);
      console.error(depth === 0 ? `db:daily-check failed: ${message}` : `Caused by: ${message}`);
      current = current instanceof Error ? current.cause : undefined;
    }
  }
}

if (import.meta.main) await main();
