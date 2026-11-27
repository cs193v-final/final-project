"use client";

import { useRef, useState } from "react";
import { correctStreak } from "@/game/feedback";
import { scoreAt } from "@/game/scoring";
import type { Puzzle, PuzzleEffect, TimedScoringConfig } from "@/game/types";
import { TimedFinalScore, type TimedRoundSummary } from "./TimedFinalScore";
import { TimedRound, type TimedRoundPhase } from "./TimedRound";

/** What the preview may know about a photo before the round ends: no answer. */
export type PreviewPhoto = {
  /** The puzzle's id, the effect's seed (as the server will send it). */
  seed: string;
  imageUrl: string;
  focus: Puzzle["reveal"]["focus"];
  credit: Puzzle["credit"];
  effect?: PuzzleEffect | undefined;
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
      <div className="flex w-full max-w-md items-end justify-between gap-3">
        <p className="font-mono text-xs font-bold tracking-wider text-zinc-600 uppercase dark:text-zinc-300">
          Image {index + 1} of {photos.length} · effect: {photo.effect ?? "none chosen (pixelate)"}
        </p>
        <RoundPips count={photos.length} current={index} done={done} />
      </div>
      <TimedRound
        key={index}
        phase={round.phase}
        imageSrc={round.phase === "ready" ? null : photo.imageUrl}
        effect={photo.effect}
        focus={photo.focus}
        seed={photo.seed}
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
        streak={correctStreak(done.slice(0, index).map((d) => d.outcome))}
        pending={pending}
        onStart={onStart}
        onGuess={(g) => void onGuess(g)}
        onNext={onNext}
        onTimeUp={() => void onTimeUp()}
      />
    </div>
  );
}

/**
 * Round progress (#183): a tile per photo, green once guessed, peach once
 * timed out, highlighted for the current one. Decorative: the line beside it
 * says which image this is.
 */
function RoundPips({ count, current, done }: { count: number; current: number; done: readonly TimedRoundSummary[] }) {
  return (
    <ol aria-hidden="true" className="flex gap-1">
      {Array.from({ length: count }, (_, i) => {
        const outcome = done[i]?.outcome;
        const tone =
          outcome === "correct"
            ? "border-[#5a793a] bg-[#d8f1ad] text-plum"
            : outcome === "timedOut"
              ? "border-[#a3413b] bg-peach text-[#6d2329]"
              : i === current
                ? "border-[#5a793a] bg-meadow text-plum shadow-[0_2px_0_#5a793a]"
                : "border-[#8d77ab] bg-paper text-plum shadow-[0_2px_0_#8d77ab]";
        return (
          <li key={i} className={`grid size-6 place-items-center rounded-[5px] border font-mono text-xs font-bold ${tone}`}>
            {i + 1}
          </li>
        );
      })}
    </ol>
  );
}
