"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { GameScore } from "@/game/scoring";
import { TIMED_SCORING_CONFIG } from "@/game/scoring-config";
import type { BeatAiSummary, Puzzle, RoundResult, TimedScoringConfig } from "@/game/types";
import { Button } from "../ui/controls";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A round's time, e.g. "6.2 s". */
export function secondsText(seconds: number): string {
  return `${seconds.toFixed(1)} s`;
}

/** What happened in a timed round (#255), e.g. "Got it in 6.2 s, 1 wrong guess" or "Time's up". */
export function actionsText(result: RoundResult): string {
  const wrong = result.wrongGuesses > 0 ? `, ${plural(result.wrongGuesses, "wrong guess", "wrong guesses")}` : "";
  return result.outcome === "correct" ? `Got it in ${secondsText(result.seconds)}${wrong}` : `Time's up${wrong}`;
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
 * (#66), one line per image with its time and points (#255), and Play again.
 */
export function FinalScore({
  puzzles,
  score,
  beatAi,
  onPlayAgain,
  after,
  title = "Practice complete",
  config = TIMED_SCORING_CONFIG,
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
  /** The game's scoring (`GameView.scoring`), for the most it could have scored. */
  config?: TimedScoringConfig;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  // The game screen just disappeared; move focus here so keyboard and
  // screen-reader users land on the results.
  useEffect(() => {
    heading.current?.focus();
  }, []);

  const answers = new Map(puzzles.map((p) => [p.id, p.answer]));
  const max = config.maxPoints * puzzles.length;
  const versusAi = beatAi === undefined ? null : beatAiText(beatAi, score.rounds.length);

  return (
    <section aria-labelledby="final-score" className="flex w-full max-w-md flex-col items-center gap-6 text-center">
      <div className="flex flex-col items-center gap-1">
        <h2 id="final-score" ref={heading} tabIndex={-1} className="text-2xl font-semibold outline-none">
          {title}
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
                  {r.outcome === "correct" ? "✓ correct" : "time's up"}
                </span>
              </span>
              <span className="text-sm text-zinc-600 dark:text-zinc-400">{actionsText(r)}</span>
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
