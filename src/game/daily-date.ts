/**
 * Daily-challenge dates (#63, used by #58).
 *
 * A "daily date" is a calendar date string, "YYYY-MM-DD", naming one daily
 * challenge. Which date an instant belongs to depends on when the daily
 * challenge resets, which is configurable (see DEFAULT_DAILY_RESET).
 *
 * Calendar arithmetic on daily dates never uses local-time Date math: a date
 * string is turned into a whole number of days since 1970-01-01 in UTC, so
 * there is no time zone or daylight-saving change involved.
 *
 * How to use these:
 * - The daily challenge (#58) should call dailyDateFor(new Date()) to pick
 *   today's pack.
 * - Streaks (the rest of #63) should NOT recompute played days from
 *   timestamps. Take each played day from the daily date stored on the game
 *   when it starts (DailyEntry.date), so a game started at 23:59 and finished
 *   at 00:01 counts for the challenge actually played, and changing the reset
 *   time later doesn't rewrite past days or break existing streaks. Use
 *   dailyDateFor only for "today".
 */

export type DailyResetConfig = {
  /** IANA time zone the reset is defined in, e.g. "America/Los_Angeles". */
  timeZone: string;
  /** Local wall-clock hour (0-23) at which a new daily challenge starts. */
  resetHour: number;
};

/**
 * Placeholder: midnight in Los Angeles. The daily reset time is an OPEN
 * decision ("Daily reset time" under "Open decisions" in PROJECT_BRIEF.md), so
 * pass a different config instead of changing this logic once it's settled.
 */
export const DEFAULT_DAILY_RESET: DailyResetConfig = {
  timeZone: "America/Los_Angeles",
  resetHour: 0,
};

const MS_PER_DAY = 86_400_000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;

/** Days since 1970-01-01 for a "YYYY-MM-DD" string. Throws on invalid input. */
export function toDayNumber(date: string): number {
  const match = DATE_PATTERN.exec(date);
  if (match === null) {
    throw new RangeError(`Invalid daily date "${date}": expected YYYY-MM-DD`);
  }
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  const ms = Date.UTC(y, m - 1, d);
  const check = new Date(ms);
  // Date.UTC rolls over (2027-02-29 becomes 2027-03-01), so check the
  // round trip to reject dates that don't exist. Date.UTC also maps years
  // 0-99 to 1900-1999, which the round trip catches as well.
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    throw new RangeError(`Invalid daily date "${date}": no such calendar date`);
  }
  return ms / MS_PER_DAY;
}

function fromDayNumber(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/** The daily date `days` days after `date` (negative goes back). */
export function addDays(date: string, days: number): string {
  if (!Number.isInteger(days)) throw new RangeError(`addDays needs a whole number of days, got ${days}`);
  return fromDayNumber(toDayNumber(date) + days);
}

/** Throws a RangeError unless `date` is a real calendar date as "YYYY-MM-DD". */
export function assertDailyDate(date: string): void {
  toDayNumber(date);
}

/**
 * One formatter per time zone, built on first use. Building an
 * Intl.DateTimeFormat is slow compared to using one, and it throws a
 * RangeError for an unknown time zone (so nothing is cached for one).
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

function validateConfig({ timeZone, resetHour }: DailyResetConfig): void {
  if (!Number.isInteger(resetHour) || resetHour < 0 || resetHour > 23) {
    throw new RangeError(`resetHour must be a whole hour from 0 to 23, got ${resetHour}`);
  }
  // Throws a RangeError for an unknown time zone.
  formatterFor(timeZone);
}

/**
 * Which daily challenge `instant` belongs to: the local calendar date in
 * `config.timeZone`, minus one day if the local wall-clock hour is still
 * before `config.resetHour`.
 *
 * The reset follows the wall clock, so it stays at the same local time across
 * daylight-saving changes (a day is then 23 or 25 hours long). If the reset
 * hour is skipped by a spring-forward change, the new day starts at the first
 * local time after it.
 */
export function dailyDateFor(instant: Date, config: DailyResetConfig = DEFAULT_DAILY_RESET): string {
  if (Number.isNaN(instant.getTime())) throw new RangeError("dailyDateFor needs a valid Date");
  validateConfig(config);

  const parts = formatterFor(config.timeZone).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((p) => p.type === type);
    if (found === undefined) throw new Error(`Intl.DateTimeFormat gave no ${type}`);
    return Number(found.value);
  };

  const localDay = Date.UTC(part("year"), part("month") - 1, part("day")) / MS_PER_DAY;
  return fromDayNumber(part("hour") < config.resetHour ? localDay - 1 : localDay);
}
