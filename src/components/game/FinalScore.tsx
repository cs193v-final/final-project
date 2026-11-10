"use client";

import { useEffect, useRef } from "react";
import type { GameScore } from "@/game/scoring";
import { SCORING_CONFIG } from "@/game/scoring-config";
import type { Puzzle, RoundResult, ScoringConfig } from "@/game/types";

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
 * The final score screen (#16): the total, one line per image with how its
 * points were worked out, and Play again.
 */
export function FinalScore({
  puzzles,
  score,
  onPlayAgain,
  config = SCORING_CONFIG,
}: {
  puzzles: readonly Pick<Puzzle, "id" | "answer">[];
  score: GameScore;
  onPlayAgain: () => void;
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

  return (
    <section aria-labelledby="final-score" className="flex w-full max-w-md flex-col items-center gap-6 text-center">
      <div className="flex flex-col items-center gap-1">
        <h2 id="final-score" ref={heading} tabIndex={-1} className="text-2xl font-semibold outline-none">
          Practice complete
        </h2>
        <p className="text-lg">
          You scored <strong className="text-3xl font-semibold">{score.total}</strong> out of {max}
        </p>
      </div>

      <ol className="flex w-full flex-col gap-2 text-left">
        {score.rounds.map((r, i) => (
          <li key={r.puzzleId} className="flex items-start justify-between gap-3 rounded-lg bg-zinc-100 px-4 py-3 dark:bg-zinc-900">
            <div className="flex flex-col">
              <span className="font-medium">
                {i + 1}. {answers.get(r.puzzleId) ?? r.puzzleId}{" "}
                <span className={r.outcome === "correct" ? "text-emerald-700 dark:text-emerald-400" : "text-zinc-500"}>
                  {r.outcome === "correct" ? "✓ correct" : "skipped"}
                </span>
              </span>
              <span className="text-sm text-zinc-600 dark:text-zinc-400">{actionsText(r)}</span>
              <span className="text-sm text-zinc-600 dark:text-zinc-400">{breakdownText(r)}</span>
            </div>
            <span className="shrink-0 text-lg font-semibold">{r.points}</span>
          </li>
        ))}
      </ol>

      <button
        type="button"
        onClick={onPlayAgain}
        className="rounded-lg bg-zinc-900 px-4 py-2 font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        Play again
      </button>
    </section>
  );
}
