/**
 * Play streaks (#63).
 *
 * Streaks are counted over daily dates ("YYYY-MM-DD", see ./daily-date.ts).
 * Take each played day from the game's stored daily date (DailyEntry.date),
 * not from timestamps, so a later change to the reset time doesn't rewrite
 * history.
 */

import { toDayNumber } from "./daily-date.ts";

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
