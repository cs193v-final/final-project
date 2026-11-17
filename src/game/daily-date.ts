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
 * - Streaks (the rest of #63), PLANNED: the played day should be the
 *   challenge's date, stored on the game when it starts, not recomputed from
 *   timestamps. Then a game started at 23:59 and finished at 00:01 counts for
 *   the challenge actually played, and changing the reset time later doesn't
 *   rewrite past days or break existing streaks. That needs a
 *   `games.daily_date` column with a unique index per owner (follow-up B in
 *   the #74 review, planned with #58); `games` has no such column yet. Until
 *   it exists, don't derive played days by joining games.pack_id to
 *   daily_schedule.pack_id: a pack scheduled on more than one day would
 *   inflate streaks.
 */

export type DailyResetConfig = {
  /** IANA time zone the reset is defined in, e.g. "America/Los_Angeles". */
  timeZone: string;
  /** Local wall-clock hour (0-23) at which a new daily challenge starts. */
  resetHour: number;
};

/**
 * When a new daily challenge starts: midnight in Los Angeles (decided in #58,
 * "Daily reset time" in PROJECT_BRIEF.md). This is the one place to change it:
 * it's dailyDateFor's default, and the daily screen (#58), streaks and the
 * leaderboard all use it. Frozen, so no caller can change it for the others.
 */
export const DEFAULT_DAILY_RESET: Readonly<DailyResetConfig> = Object.freeze({
  timeZone: "America/Los_Angeles",
  resetHour: 0,
});

const MS_PER_DAY = 86_400_000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
// toDayNumber rejects years 0000-0099 (see below), so outputs stay in the
// range it accepts: every date this module returns is a valid input again.
const MIN_YEAR = 100;
const MAX_YEAR = 9999;

/** Days since 1970-01-01 for a "YYYY-MM-DD" string. Throws on invalid input. */
function toDayNumber(date: string): number {
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
  const date = new Date(day * MS_PER_DAY);
  const year = date.getUTCFullYear();
  // Outside this range toISOString gives "+010000-01-01" or "-000001-...".
  if (!(year >= MIN_YEAR && year <= MAX_YEAR)) {
    throw new RangeError(`Daily date out of range: years ${MIN_YEAR}-${MAX_YEAR} only`);
  }
  return date.toISOString().slice(0, 10);
}

/** The daily date `days` days after `date` (negative goes back). */
export function addDays(date: string, days: number): string {
  if (!Number.isInteger(days)) throw new RangeError(`addDays needs a whole number of days, got ${days}`);
  return fromDayNumber(toDayNumber(date) + days);
}

/**
 * Whole days from `from` to `to`: positive if `to` is later, 0 for the same
 * day. Throws a RangeError unless both are valid daily dates.
 */
export function daysBetween(from: string, to: string): number {
  return toDayNumber(to) - toDayNumber(from);
}

/** Throws a RangeError unless `date` is a real calendar date as "YYYY-MM-DD". */
export function assertDailyDate(date: string): void {
  toDayNumber(date);
}

/**
 * Checks `config` and returns the formatter for its time zone. The config may
 * come from JSON or the database, so its types are checked at runtime too: a
 * missing time zone would otherwise silently fall back to the host's zone.
 *
 * No cache: dailyDateFor is called about once per request (for "today"), and
 * building one formatter takes a fraction of a millisecond.
 */
function formatterFor({ timeZone, resetHour }: DailyResetConfig): Intl.DateTimeFormat {
  if (!Number.isInteger(resetHour) || resetHour < 0 || resetHour > 23) {
    throw new RangeError(`resetHour must be a whole hour from 0 to 23, got ${resetHour}`);
  }
  if (typeof timeZone !== "string" || timeZone === "") {
    throw new RangeError(`timeZone must be a non-empty IANA time zone name, got ${JSON.stringify(timeZone)}`);
  }
  // Throws a RangeError for an unknown time zone.
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });
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
export function dailyDateFor(instant: Date, config: Readonly<DailyResetConfig> = DEFAULT_DAILY_RESET): string {
  if (Number.isNaN(instant.getTime())) throw new RangeError("dailyDateFor needs a valid Date");
  const parts = formatterFor(config).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((p) => p.type === type);
    if (found === undefined) throw new Error(`Intl.DateTimeFormat gave no ${type}`);
    return Number(found.value);
  };

  const localDay = Date.UTC(part("year"), part("month") - 1, part("day")) / MS_PER_DAY;
  return fromDayNumber(part("hour") < config.resetHour ? localDay - 1 : localDay);
}
