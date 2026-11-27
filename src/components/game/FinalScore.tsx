"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { scoreRating } from "@/game/feedback";
import type { GameScore } from "@/game/scoring";
import { SCORING_CONFIG } from "@/game/scoring-config";
import type { BeatAiSummary, Puzzle, RoundResult, ScoringConfig } from "@/game/types";
import { Button, CARD_ROW, chipClass, PAGE_TITLE } from "../ui/controls";
import { ROW_IN, ROW_IN_TIMING, useCountUp, usePrefersReducedMotion } from "./motion";
import { sounds } from "./sound";

/** How long the total takes to count up, and the gap between rows arriving (#283, as on the timed results). */
const COUNT_UP_MS = 900;
const ROW_STAGGER_MS = 70;

/**
 * Brings the rows in one after another with a tally sound each, then a
 * fanfare once the total has counted up. The same pattern as the timed
 * results' `useScoreReveal`. Rows only animate without reduced motion; the
 * sounds follow the sound setting.
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

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The points math for one round, e.g. "100 − 40 for zoom-outs − 10 for wrong guesses". */
export function breakdownText(result: RoundResult): string {
  if (result.outcome === "skipped") return "Skipped";
  const { base, revealPenalty, wrongGuessPenalty } = result.breakdown;
  const parts = [`${base}`];
  if (revealPenalty > 0) parts.push(`− ${revealPenalty} for zoom-outs`);
  if (wrongGuessPenalty > 0) parts.push(`− ${wrongGuessPenalty} for wrong guesses`);
  const raw = base - revealPenalty - wrongGuessPenalty;
  return result.points > raw ? `${parts.join(" ")} (minimum applied)` : parts.join(" ");
}

/** What the player did in a round, e.g. "2 zoom-outs, 1 wrong guess". */
export function actionsText(result: RoundResult): string {
  const zooms = plural(result.revealLevelReached, "zoom-out", "zoom-outs");
  const wrong = plural(result.wrongGuesses, "wrong guess", "wrong guesses");
  return `${zooms}, ${wrong}`;
}

/**
 * How the player did against the AI (#66), e.g. "You beat the AI on 2 of 5."
 * Null when the AI has no result for any image.
 */
export function beatAiText({ beaten, played }: BeatAiSummary, imageCount: number): string | null {
  if (played === 0) return null;
  return played === imageCount ? `You beat the AI on ${beaten} of ${played}.` : `You beat the AI on ${beaten} of the ${played} images it played.`;
}

/**
 * The final score screen (#16): the total, how the player did against the AI
 * (#66), one line per image with how its points were worked out, and Play again.
 */
export function FinalScore({
  puzzles,
  score,
  beatAi,
  onPlayAgain,
  after,
  title = "Practice complete",
  config = SCORING_CONFIG,
}: {
  puzzles: readonly Pick<Puzzle, "id" | "answer">[];
  score: GameScore;
  /** From the server (`GameView.beatAi`). Omit it, or give 0 played, and nothing is shown. */
  beatAi?: BeatAiSummary | undefined;
  /** Omit for a game you can't replay (the daily, #58); show `after` instead. */
  onPlayAgain?: () => void;
  after?: ReactNode;
  /** The heading, e.g. "Stanford complete" (#65). */
  title?: string;
  config?: ScoringConfig;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  // The game screen just disappeared; move focus here so keyboard and
  // screen-reader users land on the results.
  useEffect(() => {
    heading.current?.focus();
  }, []);

  const answers = new Map(puzzles.map((p) => [p.id, p.answer]));
  const max = config.basePoints * puzzles.length;
  const versusAi = beatAi === undefined ? null : beatAiText(beatAi, score.rounds.length);
  const shownTotal = useCountUp(score.total, COUNT_UP_MS);
  const list = useRef<HTMLOListElement>(null);
  useScoreReveal(list, score.rounds.length, score.total);

  // The timed results' layout (#183): title, the total counting up, a rating,
  // a tile per image, then a row per image.
  return (
    <section aria-labelledby="final-score" className="flex w-full max-w-md flex-col items-center gap-6 text-center">
      <div className="flex flex-col items-center gap-1">
        <h2 id="final-score" ref={heading} tabIndex={-1} className={`${PAGE_TITLE} outline-none`}>
          {title}
        </h2>
        {/* The total, counting up. Decorative: the sentence below says it in words. */}
        <span
          data-total-count
          aria-hidden="true"
          className="mt-2 font-display text-7xl leading-none tracking-[-0.07em] text-emerald-700 tabular-nums sm:text-8xl dark:text-[#d6eea7]"
        >
          {shownTotal}
        </span>
        <p data-rating className={chipClass("meadow", "badge-pop mt-2 px-3 text-base")}>
          {scoreRating(score.total, max)}
        </p>
        {/* One tile per image. Decorative: the list below says it. */}
        <div aria-hidden="true" className="mt-2 flex flex-wrap justify-center gap-1.5">
          {score.rounds.map((r) => (
            <span
              key={r.puzzleId}
              data-summary-pip={r.outcome}
              className={`grid h-8 w-9 place-items-center rounded-md border font-mono text-xs font-bold ${
                r.outcome === "correct"
                  ? "border-meadow-edge bg-meadow-soft text-plum"
                  : "border-[#a3413b] bg-peach text-[#6d2329]"
              }`}
            >
              {r.outcome === "correct" ? "✓" : "×"}
            </span>
          ))}
        </div>
        <p className="text-lg">
          You scored <strong className="font-semibold tabular-nums">{score.total}</strong> out of {max}
        </p>
        {versusAi === null ? null : <p className="text-zinc-700 dark:text-zinc-300">{versusAi}</p>}
      </div>

      <ol ref={list} className="flex w-full flex-col gap-2 text-left">
        {score.rounds.map((r, i) => (
          <li key={r.puzzleId} className={`${CARD_ROW} flex items-start justify-between gap-3 px-4 py-3`}>
            <div className="flex flex-col">
              <span className="font-medium">
                {i + 1}. {answers.get(r.puzzleId) ?? r.puzzleId}{" "}
                <span className={r.outcome === "correct" ? "text-emerald-700 dark:text-emerald-400" : "text-zinc-600 dark:text-zinc-400"}>
                  {r.outcome === "correct" ? "✓ correct" : "skipped"}
                </span>
              </span>
              <span className="text-sm text-zinc-600 dark:text-zinc-400">{actionsText(r)}</span>
              <span className="text-sm text-zinc-600 dark:text-zinc-400">{breakdownText(r)}</span>
            </div>
            <span className="shrink-0 font-mono text-lg font-bold tabular-nums">{r.points}</span>
          </li>
        ))}
      </ol>

      {onPlayAgain ? (
        <Button size="lg" onClick={onPlayAgain}>
          Play again
        </Button>
      ) : null}
      {after}
    </section>
  );
}
