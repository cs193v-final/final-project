/**
 * Daily-challenge days and play streaks (#63).
 *
 * A "daily date" is a calendar date string, "YYYY-MM-DD", naming one daily
 * challenge. Which date an instant belongs to depends on when the daily
 * challenge resets, which is configurable (see DEFAULT_DAILY_RESET).
 *
 * Calendar arithmetic on daily dates never uses local-time Date math: a date
 * string is turned into a whole number of days since 1970-01-01 in UTC, so
 * there is no time zone or daylight-saving change involved.
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

function validateConfig({ timeZone, resetHour }: DailyResetConfig): void {
  if (!Number.isInteger(resetHour) || resetHour < 0 || resetHour > 23) {
    throw new RangeError(`resetHour must be a whole hour from 0 to 23, got ${resetHour}`);
  }
  // Throws a RangeError for an unknown time zone.
  new Intl.DateTimeFormat("en-US", { timeZone });
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

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: config.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((p) => p.type === type);
    if (found === undefined) throw new Error(`Intl.DateTimeFormat gave no ${type}`);
    return Number(found.value);
  };

  const localDay = Date.UTC(part("year"), part("month") - 1, part("day")) / MS_PER_DAY;
  return fromDayNumber(part("hour") < config.resetHour ? localDay - 1 : localDay);
}

function uniqueDayNumbers(playedDays: Iterable<string>): Set<number> {
  const days = new Set<number>();
  for (const date of playedDays) days.add(toDayNumber(date));
  return days;
}

/**
 * Consecutive daily challenges played, ending `today`. If today hasn't been
 * played yet, the streak ending yesterday still counts: it's only broken once
 * today's challenge is over. Days after `today` are ignored.
 *
 * `playedDays` may be unsorted and contain duplicates. Every entry must be a
 * valid "YYYY-MM-DD" date, or this throws a RangeError.
 */
export function currentStreak(playedDays: Iterable<string>, today: string): number {
  const todayNumber = toDayNumber(today);
  const days = uniqueDayNumbers(playedDays);

  let day = days.has(todayNumber) ? todayNumber : todayNumber - 1;
  let streak = 0;
  while (days.has(day)) {
    streak += 1;
    day -= 1;
  }
  return streak;
}

/** The longest run of consecutive daily challenges played, ever. */
export function longestStreak(playedDays: Iterable<string>): number {
  const days = [...uniqueDayNumbers(playedDays)].sort((a, b) => a - b);
  let longest = 0;
  let run = 0;
  let previous: number | undefined;
  for (const day of days) {
    run = previous !== undefined && day === previous + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = day;
  }
  return longest;
}
