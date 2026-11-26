/**
 * Play streaks (#63).
 *
 * Streaks are counted over daily dates ("YYYY-MM-DD", see ./daily-date.ts).
 * The played days come from the challenge date stored on each game when it
 * starts (`games.daily_date`, migration 0005), read by `getPlayedDailyDates`
 * in src/db/streaks.ts: never from timestamps, and never from a join on
 * pack_id (a pack scheduled on two days would count twice). Only logged-in
 * players' finished dailies count; anonymous games never do (#58).
 */

import { daysBetween } from "./daily-date.ts";

/** Any fixed date works: only differences between day numbers matter. */
const EPOCH = "1970-01-01";

/** Each distinct played day as whole days since EPOCH. Validates every entry. */
function uniqueDayNumbers(playedDays: Iterable<string>): Set<number> {
  const days = new Set<number>();
  for (const date of playedDays) days.add(daysBetween(EPOCH, date));
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
  const todayNumber = daysBetween(EPOCH, today);
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

/** What the home screen and the daily result show (#63). */
export type StreakSummary = {
  /** Consecutive days played, ending today (or yesterday, while today isn't played yet). */
  current: number;
  /** The longest run ever, so at least `current`. */
  longest: number;
  /** Whether today's daily has been played. If not, `current` is lost at the next reset. */
  playedToday: boolean;
};

/**
 * The streak as of `today`, from the days played. Days after `today` are
 * ignored, for `longest` too, so a summary never counts a day that hasn't
 * started yet. Throws a RangeError for an invalid date, like the others.
 */
export function summarizeStreak(playedDays: Iterable<string>, today: string): StreakSummary {
  const upToToday = [...playedDays].filter((date) => daysBetween(date, today) >= 0);
  return {
    current: currentStreak(upToToday, today),
    longest: longestStreak(upToToday),
    playedToday: upToToday.includes(today),
  };
}
