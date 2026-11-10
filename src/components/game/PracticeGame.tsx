"use client";

import { useReducer, type ReactNode } from "react";
import { currentPuzzle } from "@/game/round";
import type { Puzzle } from "@/game/types";
import { GuessPanel } from "./GuessPanel";
import { initPractice, practiceReducer } from "./practice";

/**
 * The three-image practice game. For now only the guessing part is real (#14);
 * the image viewer (#10, #11) and the score screens (#16) are placeholders.
 */
export function PracticeGame({ puzzles }: { puzzles: readonly Puzzle[] }) {
  const [state, dispatch] = useReducer(practiceReducer, puzzles, initPractice);
  const { game, feedback } = state;
  const puzzle = currentPuzzle(game);
  const { round } = game;

  if (game.finished) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <Placeholder>Final score screen comes in #16</Placeholder>
        <h2 className="text-2xl font-semibold">Practice complete</h2>
        <button
          type="button"
          onClick={() => dispatch({ type: "restart" })}
          className="rounded-lg bg-zinc-900 px-4 py-2 font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Play again
        </button>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col items-center gap-6">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Image {game.index + 1} of {game.puzzles.length}
      </p>

      <div className="flex aspect-[4/3] w-full max-w-md flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-zinc-300 p-4 text-center dark:border-zinc-700">
        <Placeholder>Image viewer comes in #10 and #11</Placeholder>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Reveal level {round.revealLevel + 1} of {round.maxRevealLevel + 1}
        </p>
        {round.state === "playing" && (
          <button
            type="button"
            onClick={() => dispatch({ type: "reveal" })}
            disabled={round.revealLevel >= round.maxRevealLevel}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium disabled:opacity-50 dark:border-zinc-700"
          >
            Zoom out (placeholder)
          </button>
        )}
      </div>

      <GuessPanel
        key={puzzle.id}
        round={round}
        feedback={feedback}
        isLastRound={game.index === game.puzzles.length - 1}
        onGuess={(guess) => dispatch({ type: "guess", guess })}
        onSkip={() => dispatch({ type: "skip" })}
        onNext={() => dispatch({ type: "next" })}
      />
    </div>
  );
}

function Placeholder({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
      Placeholder: {children}
    </span>
  );
}
