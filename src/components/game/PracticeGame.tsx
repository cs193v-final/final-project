"use client";

import { useReducer } from "react";
import { currentPuzzle } from "@/game/round";
import { scoreGame } from "@/game/scoring";
import type { Puzzle } from "@/game/types";
import { FinalScore } from "./FinalScore";
import { GuessPanel } from "./GuessPanel";
import { ImageViewer } from "./ImageViewer";
import { initPractice, practiceReducer } from "./practice";
import { RoundValue, ScoreHeader } from "./LiveScore";
import { ZoomOutButton } from "./ZoomOutButton";

/**
 * The three-image practice game: the image viewer and Zoom out (#10, #11),
 * guessing (#14), and the live score and final score screen (#16).
 */
export function PracticeGame({ puzzles }: { puzzles: readonly Puzzle[] }) {
  const [state, dispatch] = useReducer(practiceReducer, puzzles, initPractice);
  const { game, feedback } = state;
  const puzzle = currentPuzzle(game);
  const { round } = game;
  // Finished rounds and the running total, from the round logic's scoring events (#27).
  const score = scoreGame(state.events);

  if (game.finished) {
    return <FinalScore puzzles={game.puzzles} score={score} onPlayAgain={() => dispatch({ type: "restart" })} />;
  }

  // Once this round has ended, its result is the last one scored.
  const lastResult = score.rounds.at(-1);
  const roundResult = lastResult?.puzzleId === puzzle.id ? lastResult : undefined;

  return (
    <div className="flex w-full flex-col items-center gap-6">
      <ScoreHeader index={game.index} count={game.puzzles.length} total={score.total} />

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
        <RoundValue round={round} result={roundResult} />
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
