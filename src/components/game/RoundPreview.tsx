"use client";

import { useRef, useState } from "react";
import { scoreAt } from "@/game/scoring";
import type { Puzzle, TimedScoringConfig } from "@/game/types";
import { TimedFinalScore, type TimedRoundSummary } from "./TimedFinalScore";
import { TimedRound, type TimedRoundPhase } from "./TimedRound";

/** What the preview may know about a photo before the round ends: no answer. */
export type PreviewPhoto = {
  imageUrl: string;
  focus: Puzzle["reveal"]["focus"];
  credit: Puzzle["credit"];
  effect?: string | undefined;
};

type GuessCheck = { kind: "correct" } | { kind: "incorrect"; normalizedGuess: string } | { kind: "empty" };

type RoundRecord = {
  phase: TimedRoundPhase;
  startedAt: number | null;
  elapsed: number;
  wrong: number;
  lastWrong?: string;
  points: number;
  seconds: number;
  answer?: string;
};

const fresh = (): RoundRecord => ({ phase: "ready", startedAt: null, elapsed: 0, wrong: 0, points: 0, seconds: 0 });

/**
 * Dev-only stand-in for the timed server (#255), for `/dev/round`: keeps the
 * clock in the browser, asks the server (`check`, `answer`) about guesses,
 * and renders `TimedRound` the way the real game will.
 */
export function RoundPreview({
  photos,
  scoring,
  check,
  answer,
}: {
  photos: PreviewPhoto[];
  scoring: TimedScoringConfig;
  check: (index: number, guess: string) => Promise<GuessCheck>;
  answer: (index: number) => Promise<string>;
}) {
  const [index, setIndex] = useState(0);
  const [round, setRound] = useState<RoundRecord>(fresh);
  const [done, setDone] = useState<TimedRoundSummary[]>([]);
  const [pending, setPending] = useState(false);
  // The round as of the latest update, for async results (state may be stale in their closures).
  const latest = useRef(round);
  latest.current = round;
  const photo = photos[index];

  const elapsedNow = (r: RoundRecord) => (r.startedAt === null ? 0 : (Date.now() - r.startedAt) / 1000);

  async function end(phase: "correct" | "timedOut", seconds: number, points: number) {
    const name = await answer(index);
    setRound({ ...latest.current, phase, elapsed: seconds, points, seconds, answer: name });
    setDone((d) => [...d, { answer: name, outcome: phase, seconds, points }]);
  }

  const onStart = () => setRound({ ...fresh(), phase: "playing", startedAt: Date.now() });

  async function onGuess(guess: string) {
    if (pending) return;
    // Timed when sent, like the server would.
    const seconds = elapsedNow(round);
    if (seconds >= scoring.limitSeconds) return onTimeUp();
    setPending(true);
    try {
      const outcome = await check(index, guess);
      if (latest.current.phase !== "playing") return;
      if (outcome.kind === "correct") {
        await end("correct", seconds, scoreAt(seconds, scoring));
      } else if (outcome.kind === "incorrect") {
        const r = latest.current;
        setRound({ ...r, elapsed: elapsedNow(r), wrong: r.wrong + 1, lastWrong: outcome.normalizedGuess });
      }
    } finally {
      setPending(false);
    }
  }

  async function onTimeUp() {
    if (latest.current.phase !== "playing") return;
    await end("timedOut", scoring.limitSeconds, 0);
  }

  const onNext = () => {
    setIndex((i) => i + 1);
    setRound(fresh());
  };

  if (!photo) {
    return (
      <TimedFinalScore
        rounds={done}
        scoring={scoring}
        onPlayAgain={() => {
          setIndex(0);
          setDone([]);
          setRound(fresh());
        }}
      />
    );
  }

  const over = round.phase === "correct" || round.phase === "timedOut";
  return (
    <div className="flex w-full flex-col items-center gap-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Image {index + 1} of {photos.length} · effect: {photo.effect ?? "none"} (blur stand-in)
      </p>
      <TimedRound
        key={index}
        phase={round.phase}
        imageSrc={round.phase === "ready" ? null : photo.imageUrl}
        effect={photo.effect}
        focus={photo.focus}
        elapsedSeconds={round.elapsed}
        scoring={scoring}
        wrongGuesses={round.wrong}
        lastWrongGuess={round.lastWrong}
        result={
          over && round.answer !== undefined
            ? { answer: round.answer, points: round.points, seconds: round.seconds, credit: photo.credit }
            : undefined
        }
        isLastRound={index === photos.length - 1}
        pending={pending}
        onStart={onStart}
        onGuess={(g) => void onGuess(g)}
        onNext={onNext}
        onTimeUp={() => void onTimeUp()}
      />
    </div>
  );
}
