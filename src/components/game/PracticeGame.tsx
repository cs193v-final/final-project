"use client";

import { useReducer, type ReactNode } from "react";
import { currentPuzzle } from "@/game/round";
import type { Puzzle } from "@/game/types";
import { GuessPanel } from "./GuessPanel";
import { ImageViewer } from "./ImageViewer";
import { initPractice, practiceReducer } from "./practice";
import { ZoomOutButton } from "./ZoomOutButton";

/**
 * The three-image practice game: the image viewer and Zoom out (#10, #11) and
 * guessing (#14). The score screens (#16) are still placeholders.
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

      <div className="flex w-full max-w-md flex-col items-center gap-3">
        {/* key: each image starts at its own tight crop, with no zoom animation from the last one. */}
        <ImageViewer
          key={puzzle.id}
          puzzle={puzzle}
          revealLevel={round.revealLevel}
          showFull={round.state !== "playing"}
        />
        {round.state === "playing" ? (
          <ZoomOutButton round={round} onZoomOut={() => dispatch({ type: "reveal" })} />
        ) : (
          <Credit credit={puzzle.credit} />
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

/**
 * Image source and license, required by CC BY-SA. Shown only after the round,
 * because the source and file name often give the answer away.
 */
function Credit({ credit }: { credit: Puzzle["credit"] }) {
  const source = credit.url ? (
    <a href={credit.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
      {credit.source}
    </a>
  ) : (
    credit.source
  );
  return (
    <p className="text-center text-xs text-zinc-600 dark:text-zinc-400">
      Photo: {source} ({credit.license})
    </p>
  );
}
