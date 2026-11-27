"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { countUpValue, scoreRating } from "@/game/feedback";
import { formatPoints, formatSeconds } from "@/game/round-clock";
import type { BeatAiSummary, TimedScoringConfig } from "@/game/types";
import { Button } from "../ui/controls";
import { beatAiText } from "./FinalScore";
import { ROW_IN, ROW_IN_TIMING, usePrefersReducedMotion } from "./motion";
import { sounds } from "./sound";

/** How long the total takes to count up, and the gap between rows arriving (#283). */
const COUNT_UP_MS = 900;
const ROW_STAGGER_MS = 70;

/**
 * `target`, counted up from 0 over `durationMs` (#283). With reduced motion,
 * or before the browser can animate, it's just `target`.
 */
function useCountUp(target: number, durationMs: number): number {
  const reduced = usePrefersReducedMotion();
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (reduced || typeof requestAnimationFrame !== "function") return;
    let frame = 0;
    const start = performance.now();
    const step = (now: number) => {
      const next = countUpValue(target, now - start, durationMs);
      setValue(next);
      if (next !== target) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs, reduced]);
  return reduced ? target : value;
}

/**
 * Brings the rows in one after another with a tally sound each, then a
 * fanfare once the total has counted up (#283). Rows only animate without
 * reduced motion; the sounds follow the sound setting.
 */
function useScoreReveal(list: RefObject<HTMLOListElement | null>, rows: number, total: number) {
  const reduced = usePrefersReducedMotion();
  useEffect(() => {
    const items = Array.from(list.current?.children ?? []) as HTMLElement[];
    const animations = reduced
      ? []
      : items.flatMap((item, i) =>
          typeof item.animate === "function" ? [item.animate(ROW_IN, { ...ROW_IN_TIMING, delay: i * ROW_STAGGER_MS })] : [],
        );
    const timers = Array.from({ length: rows }, (_, i) => setTimeout(() => sounds.tally(i), i * ROW_STAGGER_MS));
    if (total > 0) timers.push(setTimeout(() => sounds.fanfare(), Math.max(COUNT_UP_MS, rows * ROW_STAGGER_MS)));
    return () => {
      animations.forEach((a) => a.cancel());
      timers.forEach(clearTimeout);
    };
    // Once per showing of the results.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * One finished timed round, as the final score needs it. Local to the screen
 * (#256) until the timed server's view (#255) settles; the game maps its view
 * to this, so `RoundResult` in `types.ts` doesn't change yet.
 */
export type TimedRoundSummary = {
  answer: string;
  outcome: "correct" | "timedOut";
  /** When the correct guess was sent, or the limit for a time-out. */
  seconds: number;
  points: number;
};

/** What happened in a round, e.g. "Got it in 4.2 s" or "Time's up". */
export function timedRoundText(round: TimedRoundSummary): string {
  return round.outcome === "correct" ? `Got it in ${formatSeconds(round.seconds)}` : "Time's up";
}

/**
 * The final score for timed rounds (#256): the total out of the most possible,
 * how the player did against the AI (#66), one line per photo with its time
 * and points, and Play again. Replaces `FinalScore` when the games switch.
 */
export function TimedFinalScore({
  rounds,
  scoring,
  title = "Practice complete",
  beatAi,
  onPlayAgain,
  after,
}: {
  rounds: readonly TimedRoundSummary[];
  scoring: TimedScoringConfig;
  title?: string;
  beatAi?: BeatAiSummary | undefined;
  /** Omit for a game you can't replay (the daily); show `after` instead. */
  onPlayAgain?: () => void;
  after?: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  // The round screen just disappeared; move focus here so keyboard and
  // screen-reader users land on the results.
  useEffect(() => {
    heading.current?.focus();
  }, []);

  const total = rounds.reduce((sum, r) => sum + r.points, 0);
  const max = scoring.maxPoints * rounds.length;
  const solved = rounds.filter((r) => r.outcome === "correct");
  const fastest = solved.length === 0 ? null : Math.min(...solved.map((r) => r.seconds));
  const versusAi = beatAi === undefined ? null : beatAiText(beatAi, rounds.length);
  const shownTotal = useCountUp(total, COUNT_UP_MS);
  const list = useRef<HTMLOListElement>(null);
  useScoreReveal(list, rounds.length, total);

  return (
    <section aria-labelledby="final-score" className="flex w-full max-w-md flex-col items-center gap-6 text-center">
      <div className="flex flex-col items-center gap-1">
        <h2 id="final-score" ref={heading} tabIndex={-1} className="text-2xl font-semibold outline-none">
          {title}
        </h2>
        {/* The total, counting up. Decorative: the sentence below says it in words. */}
        <span data-total-count aria-hidden="true" className="text-6xl font-bold tabular-nums">
          {formatPoints(shownTotal)}
        </span>
        <p className="badge-pop text-lg font-semibold text-emerald-700 dark:text-emerald-400">{scoreRating(total, max)}</p>
        <p className="text-lg">
          You scored <strong className="font-semibold tabular-nums">{formatPoints(total)}</strong> out of{" "}
          {formatPoints(max)}
        </p>
        <p className="text-zinc-700 dark:text-zinc-300">
          {solved.length} of {rounds.length} guessed
          {fastest === null ? "" : `, fastest in ${formatSeconds(fastest)}`}
        </p>
        {versusAi === null ? null : <p className="text-zinc-700 dark:text-zinc-300">{versusAi}</p>}
      </div>

      <ol ref={list} className="flex w-full flex-col gap-2 text-left">
        {rounds.map((r, i) => (
          <li key={i} className="flex items-center justify-between gap-3 rounded-lg bg-zinc-100 px-4 py-3 dark:bg-zinc-900">
            <div className="flex flex-col">
              <span className="font-medium">
                {i + 1}. {r.answer}
              </span>
              <span
                className={
                  r.outcome === "correct" ? "text-sm text-emerald-700 dark:text-emerald-400" : "text-sm text-zinc-600 dark:text-zinc-400"
                }
              >
                {timedRoundText(r)}
              </span>
            </div>
            <span className="shrink-0 text-lg font-semibold tabular-nums">{formatPoints(r.points)}</span>
          </li>
        ))}
      </ol>

      {onPlayAgain ? <Button onClick={onPlayAgain}>Play again</Button> : null}
      {after}
    </section>
  );
}
