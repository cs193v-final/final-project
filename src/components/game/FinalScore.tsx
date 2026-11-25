"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { GameScore } from "@/game/scoring";
import { SCORING_CONFIG } from "@/game/scoring-config";
import type { BeatAiSummary, Puzzle, RoundResult, ScoringConfig } from "@/game/types";
import { Button } from "../ui/controls";

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
  config = SCORING_CONFIG,
}: {
  puzzles: readonly Pick<Puzzle, "id" | "answer">[];
  score: GameScore;
  /** From the server (`GameView.beatAi`). Omit it, or give 0 played, and nothing is shown. */
  beatAi?: BeatAiSummary | undefined;
  /** Omit for a game you can't replay (the daily, #58); show `after` instead. */
  onPlayAgain?: () => void;
  after?: ReactNode;
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

  return (
    <section aria-labelledby="final-score" className="flex w-full max-w-md flex-col items-center gap-6 text-center">
      <div className="flex flex-col items-center gap-1">
        <h2 id="final-score" ref={heading} tabIndex={-1} className="text-2xl font-semibold outline-none">
          Practice complete
        </h2>
        <p className="text-lg">
          You scored <strong className="text-3xl font-semibold">{score.total}</strong> out of {max}
        </p>
        {versusAi === null ? null : <p className="text-zinc-700 dark:text-zinc-300">{versusAi}</p>}
      </div>

      <ol className="flex w-full flex-col gap-2 text-left">
        {score.rounds.map((r, i) => (
          <li key={r.puzzleId} className="flex items-start justify-between gap-3 rounded-lg bg-zinc-100 px-4 py-3 dark:bg-zinc-900">
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
            <span className="shrink-0 text-lg font-semibold">{r.points}</span>
          </li>
        ))}
      </ol>

      {onPlayAgain ? <Button onClick={onPlayAgain}>Play again</Button> : null}
      {after}
    </section>
  );
}
