/**
 * Play streaks (#63).
 *
 * Streaks are counted over daily dates ("YYYY-MM-DD", see ./daily-date.ts).
 * PLANNED: the played days should come from the challenge date stored on each
 * game when it starts (a `games.daily_date` column, not there yet), not from
 * timestamps or a join on pack_id. See the comment at the top of
 * ./daily-date.ts.
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
