// The daily result screen's logic (#58): the spoiler-free share text and when
// the next challenge starts. Owner: Joseph. Framework-free.

import { dailyDateFor, type DailyResetConfig } from "./daily-date.ts";
import type { RoundResult } from "./types.ts";

const QUARTER_HOUR = 15 * 60 * 1000;

/**
 * The first instant after `now` that belongs to the next daily date. Every
 * time zone's offset is a multiple of 15 minutes and the reset is on the hour,
 * so the reset falls on a UTC quarter hour: check those, up to two days ahead
 * (a daylight-saving day is at most 25 hours).
 */
export function nextResetAt(now: Date, reset: Readonly<DailyResetConfig>): Date {
  const today = dailyDateFor(now, reset);
  let t = Math.floor(now.getTime() / QUARTER_HOUR) * QUARTER_HOUR + QUARTER_HOUR;
  for (let i = 0; i < 2 * 24 * 4; i++, t += QUARTER_HOUR) {
    if (dailyDateFor(new Date(t), reset) !== today) return new Date(t);
  }
  throw new Error("nextResetAt: no reset in the next two days");
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
