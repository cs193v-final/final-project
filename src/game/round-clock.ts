// The timed round's clock as the browser shows it (#256). Pure, no React, so
// it's unit-testable. The server (#255) keeps its own clock and decides the
// real points; this only drives the live score, the timer bar and the effect.
import { scoreAt } from "./scoring.ts";
import type { TimedScoringConfig } from "./types.ts";

/**
 * Where a round is: the photo is still `clearing`, it's `clear` (worth
 * `minPoints` until the limit), or it's `timeUp` (worth 0, the round is over).
 */
export type ClockPhase = "clearing" | "clear" | "timeUp";

export type ClockReading = {
  /** Seconds since the round started, never below 0. */
  seconds: number;
  /** What a correct guess is worth now (`scoreAt`). */
  points: number;
  /** How far the effect has cleared, 0 (hidden) to 1 (clear): `t / revealSeconds`. */
  progress: number;
  phase: ClockPhase;
  /** Seconds until time's up, never below 0. */
  secondsLeft: number;
};

/** The clock at `seconds` into a round. */
export function readClock(seconds: number, config: TimedScoringConfig): ClockReading {
  const t = Math.max(0, seconds);
  return {
    seconds: t,
    points: scoreAt(t, config),
    progress: Math.min(t / config.revealSeconds, 1),
    phase: t >= config.limitSeconds ? "timeUp" : t >= config.revealSeconds ? "clear" : "clearing",
    secondsLeft: Math.max(0, config.limitSeconds - t),
  };
}

/** How often the effect moves on with reduced motion (#281): about once a second. */
export const REDUCED_MOTION_STEP_SECONDS = 1;

/**
 * The effect's progress with reduced motion (#281): `reading.progress`, held
 * still between whole steps of `stepSeconds`, so swirl and zoom move in a few
 * small jumps instead of a continuous spin. Only the photo steps; the score
 * and the clock still use the smooth reading.
 */
export function steppedProgress(
  reading: ClockReading,
  config: TimedScoringConfig,
  stepSeconds: number = REDUCED_MOTION_STEP_SECONDS,
): number {
  const held = Math.floor(reading.seconds / stepSeconds) * stepSeconds;
  return Math.min(held / config.revealSeconds, 1);
}

/**
 * Seconds into the round now, from what the server said when its response
 * arrived: `elapsedAtReceipt` seconds had passed at local time `receivedAtMs`.
 * Counting from the browser's own clock after that means a wrong device
 * clock doesn't matter, only how long the response took to arrive.
 */
export function secondsNow(elapsedAtReceipt: number, receivedAtMs: number, nowMs: number): number {
  return Math.max(0, elapsedAtReceipt + (nowMs - receivedAtMs) / 1000);
}

/** "12.3 s": one decimal, the way rounds and the AI's time (#257) are shown. */
export function formatSeconds(seconds: number): string {
  return `${(Math.floor(Math.max(0, seconds) * 10) / 10).toFixed(1)} s`;
}

/** "10,000": points with thousands separators, the same on server and browser. */
export function formatPoints(points: number): string {
  return points.toLocaleString("en-US");
}
