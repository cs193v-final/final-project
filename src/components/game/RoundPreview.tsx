"use client";

import { useState } from "react";
import { checkGuess } from "@/game/guess";
import { scoreAt } from "@/game/scoring";
import type { Puzzle, TimedScoringConfig } from "@/game/types";
import { formatPoints } from "@/game/round-clock";
import { TimedRound, type TimedRoundPhase } from "./TimedRound";

/** The effects for the practice photos, as in #259, until `Puzzle.effect` merges. */
const EFFECTS: Record<string, string> = { "pz-dbdb4dee": "thermal", "pz-683182e7": "pixelate", "pz-af6d3bbb": "zoom" };

type RoundRecord = { phase: TimedRoundPhase; startedAt: number | null; elapsed: number; wrong: number; lastWrong?: string; points: number; seconds: number };

const fresh = (): RoundRecord => ({ phase: "ready", startedAt: null, elapsed: 0, wrong: 0, points: 0, seconds: 0 });

/**
 * Dev-only stand-in for the timed server (#255), for `/dev/round`: keeps the
 * clock and checks guesses in the browser, then renders `TimedRound` the way
 * the real game will. Not for real games: it has the answers.
 */
export function RoundPreview({ puzzles, scoring }: { puzzles: Puzzle[]; scoring: TimedScoringConfig }) {
  const [index, setIndex] = useState(0);
  const [round, setRound] = useState<RoundRecord>(fresh);
  const [totals, setTotals] = useState<number[]>([]);
  const puzzle = puzzles[index];

  const elapsedNow = (r: RoundRecord) => (r.startedAt === null ? 0 : (Date.now() - r.startedAt) / 1000);

  const onStart = () => setRound({ ...fresh(), phase: "playing", startedAt: Date.now() });

  const onGuess = (guess: string) => {
    if (!puzzle) return;
    const seconds = elapsedNow(round);
    if (seconds >= scoring.limitSeconds) return onTimeUp();
    const outcome = checkGuess(puzzle, guess);
    if (outcome.kind === "correct") {
      const points = scoreAt(seconds, scoring);
      setRound({ ...round, phase: "correct", elapsed: seconds, points, seconds });
      setTotals((t) => [...t, points]);
    } else if (outcome.kind === "incorrect") {
      setRound({ ...round, elapsed: seconds, wrong: round.wrong + 1, lastWrong: outcome.normalizedGuess });
    }
  };

  function onTimeUp() {
    if (round.phase !== "playing") return;
    setRound({ ...round, phase: "timedOut", elapsed: scoring.limitSeconds, points: 0, seconds: scoring.limitSeconds });
    setTotals((t) => [...t, 0]);
  }

  const onNext = () => {
    setIndex((i) => i + 1);
    setRound(fresh());
  };

  if (!puzzle) {
    const total = totals.reduce((a, b) => a + b, 0);
    return (
      <div className="flex flex-col items-center gap-3">
        <p className="text-lg">
          Total: <strong className="tabular-nums">{formatPoints(total)}</strong>
        </p>
        <button
          className="underline"
          onClick={() => {
            setIndex(0);
            setTotals([]);
            setRound(fresh());
          }}
        >
          Play again
        </button>
      </div>
    );
  }

  const over = round.phase === "correct" || round.phase === "timedOut";
  return (
    <div className="flex w-full flex-col items-center gap-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Image {index + 1} of {puzzles.length} · effect: {EFFECTS[puzzle.id] ?? "none"} (blur stand-in)
      </p>
      <TimedRound
        key={index}
        phase={round.phase}
        imageSrc={round.phase === "ready" ? null : puzzle.imageUrl}
        effect={EFFECTS[puzzle.id]}
        focus={puzzle.reveal.focus}
        elapsedSeconds={round.elapsed}
        scoring={scoring}
        wrongGuesses={round.wrong}
        lastWrongGuess={round.lastWrong}
        result={over ? { answer: puzzle.answer, points: round.points, seconds: round.seconds, credit: puzzle.credit } : undefined}
        isLastRound={index === puzzles.length - 1}
        onStart={onStart}
        onGuess={onGuess}
        onNext={onNext}
        onTimeUp={onTimeUp}
      />
    </div>
  );
}
