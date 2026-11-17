// The daily result screen's logic (#58): the spoiler-free share text and when
// the next challenge starts. Owner: Joseph. Framework-free.

import { addDays, dailyDateFor, type DailyResetConfig } from "./daily-date.ts";
import type { RoundResult } from "./types.ts";

const QUARTER_HOUR = 15 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/**
 * When the daily *after* `date` starts: the first instant whose daily date is
 * `date + 1` (review of #121: from the day that was played, not from the
 * clock, so a page left open past midnight never skips a day). Every time
 * zone's offset is a multiple of 15 minutes and the reset is on the hour, so
 * it's on a UTC quarter hour within 15 hours of that day's reset hour in UTC;
 * binary search finds it in about 7 checks.
 */
export function nextChallengeAt(date: string, reset: Readonly<DailyResetConfig>): Date {
  const next = addDays(date, 1);
  const [y, m, d] = next.split("-").map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, reset.resetHour);
  // Quarter hours from guess - 15h to guess + 15h: the answer is the first one on `next` or later.
  let lo = 0;
  let hi = (30 * HOUR) / QUARTER_HOUR;
  const at = (i: number) => new Date(guess - 15 * HOUR + i * QUARTER_HOUR);
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (dailyDateFor(at(mid), reset) >= next) hi = mid;
    else lo = mid + 1;
  }
  return at(lo);
}

/** "2h 14m", "14m", "under a minute" until `until`. */
export function formatCountdown(ms: number): string {
  if (ms < 60_000) return "under a minute";
  const minutes = Math.floor(ms / 60_000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${m}m` : `${h}h ${m}m`;
}

/**
 * One square per image, by how much of it the player needed. No answers, no
 * theme beyond what the intro already showed everyone, so it's safe to post.
 * Solved at the tightest crop: green; one zoom-out: yellow; two: orange;
 * more: red; skipped: black.
 */
export function roundSquare(round: Pick<RoundResult, "outcome" | "revealLevelReached">): string {
  if (round.outcome === "skipped") return "⬛";
  return ["🟩", "🟨", "🟧"][round.revealLevelReached] ?? "🟥";
}

export type ShareInput = {
  gameName: string;
  date: string; // "YYYY-MM-DD"
  theme: string;
  rounds: readonly Pick<RoundResult, "outcome" | "revealLevelReached">[];
  total: number;
  maxTotal: number;
  url?: string;
};

/** The text the Share button copies, e.g. "Zoom Out daily · Nov 17 · Fruit\n🟩🟨⬛🟥🟩 340/500\n<url>". */
export function shareText({ gameName, date, theme, rounds, total, maxTotal, url }: ShareInput): string {
  const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`),
  );
  const lines = [`${gameName} daily · ${day} · ${theme}`, `${rounds.map(roundSquare).join("")} ${total}/${maxTotal}`];
  if (url) lines.push(url);
  return lines.join("\n");
}

/** One image of a finished daily, compared with the other players who finished it (#58). */
export type RoundStat = {
  position: number; // 1-based, as in game_rounds
  others: number; // other players who finished this daily
  beaten: number; // of those, how many scored fewer points on this image
};

export type DailyStats = { rounds: RoundStat[]; others: number; beatenTotal: number };

/** "better than 62% of players" (rounded down, so 100% only when every other player did worse). `null` with nobody to compare. */
export function betterThanPercent(beaten: number, others: number): number | null {
  if (others === 0) return null;
  return Math.floor((100 * beaten) / others);
}
