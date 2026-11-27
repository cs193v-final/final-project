"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { formatPoints, formatSeconds, readClock, secondsNow, type ClockReading } from "@/game/round-clock";
import type { Puzzle, PuzzleEffect, TimedScoringConfig } from "@/game/types";
import { Button, TextInput } from "../ui/controls";
import { EffectCanvas } from "./EffectCanvas";
import { SHAKE, SHAKE_TIMING, useAnimateOn, usePrefersReducedMotion } from "./motion";

/**
 * Where the round is, as the server last said (#255):
 * - `ready`: not started; the photo isn't sent yet, only Start round.
 * - `playing`: the clock runs and the photo clears up.
 * - `correct` / `timedOut`: the round is over; the clear photo and the result.
 */
export type TimedRoundPhase = "ready" | "playing" | "correct" | "timedOut";

export type TimedRoundProps = {
  phase: TimedRoundPhase;
  /** The clear photo. Null before the round starts: the server only sends it after `start`. */
  imageSrc: string | null;
  /** How the photo is hidden while the clock runs (#258), drawn by src/game/effects (#257). Missing = `DEFAULT_EFFECT`. */
  effect?: PuzzleEffect | undefined;
  /** Where zoom, spotlight and swirl centre (`reveal.focus`). Missing = the middle. */
  focus?: Puzzle["reveal"]["focus"] | undefined;
  /**
   * Fixes the effect's random parts, like the tiles' order: the puzzle's id
   * (`PublicRound.seed`, #255). The AI solver uses the same, so pass it for
   * the AI's time to match what the player sees.
   */
  seed?: string | undefined;
  /** Seconds since the round started, as the server said when its response arrived. */
  elapsedSeconds: number;
  scoring: TimedScoringConfig;
  /** Wrong guesses this round. Each new one shakes the photo once. */
  wrongGuesses: number;
  /** The last wrong guess, normalized by the server, for the "Not it" message. */
  lastWrongGuess?: string | undefined;
  /** Once the round is over: what it was, what it earned, and how long it took. */
  result?: { answer: string; points: number; seconds: number; credit?: Puzzle["credit"] | undefined } | undefined;
  /** True on the last image, so the button after the round says "See results". */
  isLastRound: boolean;
  /** A move is on its way to the server: buttons are marked disabled and ignored. */
  pending?: boolean;
  onStart: () => void;
  onGuess: (guess: string) => void;
  onNext: () => void;
  /**
   * The local clock hit the limit. The server decides; ask it (e.g. `get`) so
   * the round ends. Called once per server reading that reaches the limit: if
   * the server says the round is still on (its clock can trail the local one),
   * it's called again when the new reading runs out.
   */
  onTimeUp: () => void;
};

/** The focus when a round has none: the middle of the photo. */
const CENTRE = { x: 0.5, y: 0.5 };

/** How often the live score, timer bar and photo update while the clock runs. */
const TICK_MS = 50;

/**
 * The clock from the server's elapsed time, ticking locally while `running`.
 * Restarts its local count each time the server sends a new elapsed time.
 */
function useRoundClock(running: boolean, elapsedSeconds: number, scoring: TimedScoringConfig): ClockReading {
  // When the latest server reading arrived (local ms), and which reading that was.
  const key = `${running}:${elapsedSeconds}`;
  const [anchor, setAnchor] = useState<{ key: string; receivedAt: number; now: number } | null>(null);

  useEffect(() => {
    if (!running) return;
    // A new reading (or the clock just started): count from it on the local clock.
    const receivedAt = Date.now();
    const id = setInterval(() => setAnchor({ key, receivedAt, now: Date.now() }), TICK_MS);
    return () => clearInterval(id);
  }, [key, running]);

  // Until the effect has anchored this reading, show it as the server sent it.
  const seconds =
    running && anchor !== null && anchor.key === key
      ? secondsNow(elapsedSeconds, anchor.receivedAt, anchor.now)
      : elapsedSeconds;
  return readClock(seconds, scoring);
}

/**
 * One timed round (#256): Start round, then a live score that drains while
 * the photo clears up, a timer bar, and guessing. Wrong guesses shake the
 * photo and say "Not it"; a correct guess or time's up shows the clear photo,
 * the answer, the points and the time. Only renders what it's given: the
 * server (#255) runs the real clock and scores the guess.
 */
export function TimedRound({
  phase,
  imageSrc,
  effect,
  focus,
  seed,
  elapsedSeconds,
  scoring,
  wrongGuesses,
  lastWrongGuess,
  result,
  isLastRound,
  pending = false,
  onStart,
  onGuess,
  onNext,
  onTimeUp,
}: TimedRoundProps) {
  const clock = useRoundClock(phase === "playing", elapsedSeconds, scoring);
  // The local clock ran out before the server said so: stop guessing, and ask
  // once. A new reading from the server that isn't over re-arms the ask, so a
  // server a little behind can't leave the round stuck on "Time's up."
  const localTimeUp = phase === "playing" && clock.phase === "timeUp";
  const askedAboutTimeUp = useRef(false);
  useEffect(() => {
    if (!localTimeUp) {
      askedAboutTimeUp.current = false;
      return;
    }
    if (askedAboutTimeUp.current) return;
    askedAboutTimeUp.current = true;
    onTimeUp();
  }, [localTimeUp, onTimeUp]);

  const over = phase === "correct" || phase === "timedOut";

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-4">
      {phase === "playing" ? <LiveScore clock={clock} timeUp={localTimeUp} /> : null}

      <PhotoStage
        phase={phase}
        imageSrc={imageSrc}
        effect={effect}
        focus={focus}
        seed={seed}
        progress={over ? 1 : clock.progress}
        wrongGuesses={wrongGuesses}
      />

      {phase === "playing" ? <TimerBar clock={clock} scoring={scoring} /> : null}

      {phase === "ready" ? (
        <div className="flex flex-col items-center gap-2 text-center">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            The score starts at {formatPoints(scoring.maxPoints)} and drains until you guess right.
          </p>
          <Button disabled={pending} onClick={onStart} autoFocus>
            Start round
          </Button>
        </div>
      ) : phase === "playing" ? (
        <GuessForm
          disabled={localTimeUp}
          pending={pending}
          wrongGuesses={wrongGuesses}
          lastWrongGuess={lastWrongGuess}
          onGuess={onGuess}
        />
      ) : (
        <RoundOver phase={phase} result={result} isLastRound={isLastRound} pending={pending} onNext={onNext} />
      )}
    </div>
  );
}

/** The big draining number. Not a live region: it changes 20 times a second. */
function LiveScore({ clock, timeUp }: { clock: ClockReading; timeUp: boolean }) {
  return (
    <div className="flex flex-col items-center" role="timer" aria-label="Points if you guess now">
      <span
        data-live-points
        className="text-5xl font-bold tabular-nums text-zinc-900 dark:text-zinc-100"
        aria-hidden="true"
      >
        {formatPoints(clock.points)}
      </span>
      {/* Read on demand by screen readers, rounded so it doesn't flicker. */}
      <span className="sr-only">
        {timeUp ? "Time's up" : `${formatPoints(clock.points)} points, ${Math.ceil(clock.secondsLeft)} seconds left`}
      </span>
      <span className="text-xs text-zinc-600 dark:text-zinc-400" aria-hidden="true">
        {clock.phase === "clearing" ? "points if you guess now" : timeUp ? "time's up" : "photo is clear"}
      </span>
    </div>
  );
}

/**
 * The round's time as a bar, with a mark where the photo is fully clear and
 * the end at the limit.
 */
function TimerBar({ clock, scoring }: { clock: ClockReading; scoring: TimedScoringConfig }) {
  const filled = Math.min(clock.seconds / scoring.limitSeconds, 1);
  const clearAt = scoring.revealSeconds / scoring.limitSeconds;
  const whole = Math.min(Math.floor(clock.seconds), scoring.limitSeconds);
  return (
    <div
      role="progressbar"
      aria-label="Time"
      aria-valuemin={0}
      aria-valuemax={scoring.limitSeconds}
      aria-valuenow={whole}
      aria-valuetext={`${whole} of ${scoring.limitSeconds} seconds`}
      className="relative h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
    >
      <div
        data-timer-fill
        className={`h-full ${clock.phase === "clearing" ? "bg-zinc-900 dark:bg-zinc-100" : "bg-rose-600 dark:bg-rose-500"}`}
        style={{ width: `${filled * 100}%` }}
      />
      {/* Where the photo is clear and the score bottoms out. */}
      <div
        data-clear-mark
        aria-hidden="true"
        className="absolute top-0 h-full w-0.5 bg-zinc-500"
        style={{ left: `${clearAt * 100}%` }}
      />
    </div>
  );
}

/**
 * The photo, hidden by its effect at `progress` (0 hidden, 1 clear) while the
 * clock runs, drawn on a canvas (`EffectCanvas`). Once the round is over it's
 * the photo itself, at full resolution. Each new wrong guess shakes it and
 * flashes red; no shake with reduced motion.
 */
function PhotoStage({
  phase,
  imageSrc,
  effect,
  focus,
  seed,
  progress,
  wrongGuesses,
}: {
  phase: TimedRoundPhase;
  imageSrc: string | null;
  effect?: PuzzleEffect | undefined;
  focus?: Puzzle["reveal"]["focus"] | undefined;
  seed?: string | undefined;
  progress: number;
  wrongGuesses: number;
}) {
  // Only wrong guesses made while this is on screen: a round resumed after a
  // refresh doesn't shake for old ones.
  const [mountWrong] = useState(wrongGuesses);
  const newWrong = wrongGuesses > mountWrong ? wrongGuesses : null;
  const box = useAnimateOn<HTMLDivElement>(newWrong, SHAKE, SHAKE_TIMING);
  const reduced = usePrefersReducedMotion();
  const [flashing, setFlashing] = useState(false);
  const [flashedFor, setFlashedFor] = useState<number | null>(null);
  if (newWrong !== null && newWrong !== flashedFor) {
    setFlashedFor(newWrong);
    setFlashing(true);
  }
  useEffect(() => {
    if (!flashing) return;
    const id = setTimeout(() => setFlashing(false), 400);
    return () => clearTimeout(id);
  }, [flashing, flashedFor]);

  // A flash still running when the round ends would tint the "Correct!" photo.
  const flashOn = flashing && phase === "playing";

  const frame =
    "relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-xl bg-zinc-200 dark:bg-zinc-800";

  if (imageSrc === null || phase === "ready") {
    return (
      <div className={frame}>
        <p className="px-6 text-center text-sm text-zinc-600 dark:text-zinc-400">The photo appears when you start.</p>
      </div>
    );
  }

  return (
    <div ref={box} data-photo-stage className={frame}>
      {phase === "playing" ? (
        <EffectCanvas
          src={imageSrc}
          effect={effect}
          focus={focus ?? CENTRE}
          seed={seed ?? ""}
          progress={progress}
          label="The photo to guess, still hidden"
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- the photo the effect drew, already loaded, sized by the frame
        <img src={imageSrc} alt="The photo, fully clear" className="h-full w-full object-cover" draggable={false} />
      )}
      <div
        data-wrong-flash={flashOn ? "on" : "off"}
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 rounded-xl ring-4 ring-inset ring-rose-600 ${reduced ? "" : "transition-opacity duration-300"} ${flashOn ? "bg-rose-600/20 opacity-100" : "opacity-0"}`}
      />
    </div>
  );
}

function GuessForm({
  disabled,
  pending,
  wrongGuesses,
  lastWrongGuess,
  onGuess,
}: {
  disabled: boolean;
  pending: boolean;
  wrongGuesses: number;
  lastWrongGuess?: string | undefined;
  onGuess: (guess: string) => void;
}) {
  const [guess, setGuess] = useState("");
  const [blank, setBlank] = useState(false);
  const inputId = useId();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || disabled) return;
    if (guess.trim() === "") {
      setBlank(true);
      return;
    }
    setBlank(false);
    onGuess(guess);
    setGuess("");
  }

  // The count makes each wrong guess change the text, so a screen reader
  // announces a repeated guess too.
  const message = disabled
    ? "Time's up."
    : blank
      ? "Type a guess first."
      : wrongGuesses > 0 && lastWrongGuess !== undefined
        ? `Not it: “${lastWrongGuess}” (${wrongGuesses} wrong ${wrongGuesses === 1 ? "guess" : "guesses"}). Keep going.`
        : "";

  return (
    <section aria-label="Your guess" className="flex w-full flex-col gap-2">
      <form onSubmit={submit} className="flex flex-col gap-2">
        <label htmlFor={inputId} className="text-sm font-medium">
          What is it?
        </label>
        <div className="flex gap-2">
          <TextInput
            id={inputId}
            name="guess"
            value={guess}
            onChange={(e) => setGuess(e.target.value)}
            disabled={disabled}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="send"
            autoFocus
            className="min-w-0 flex-1"
          />
          <Button type="submit" disabled={pending || disabled}>
            Guess
          </Button>
        </div>
      </form>
      <p role="status" aria-live="polite" className="flex min-h-6 items-start gap-2 text-rose-700 dark:text-rose-400">
        {message && !disabled && !blank ? (
          <span aria-hidden="true" className="font-bold">
            ✗
          </span>
        ) : null}
        <span>{message}</span>
      </p>
    </section>
  );
}

function RoundOver({
  phase,
  result,
  isLastRound,
  pending,
  onNext,
}: {
  phase: "correct" | "timedOut";
  result: TimedRoundProps["result"];
  isLastRound: boolean;
  pending: boolean;
  onNext: () => void;
}) {
  const next = useRef<HTMLButtonElement>(null);
  // Move focus to the next step, so keyboard and screen-reader users aren't
  // left on the guess box that just disappeared.
  useEffect(() => next.current?.focus(), []);

  const correct = phase === "correct";
  return (
    <section aria-label="Round result" className="flex w-full flex-col items-center gap-2 text-center">
      <p role="status" className={`text-lg font-semibold ${correct ? "text-emerald-700 dark:text-emerald-400" : "text-zinc-900 dark:text-zinc-100"}`}>
        {correct ? (
          <>
            <span aria-hidden="true">✓ </span>
            {result ? `Correct! It's ${result.answer}.` : "Correct!"}
          </>
        ) : result ? (
          `Time's up. It was ${result.answer}.`
        ) : (
          "Time's up."
        )}
      </p>
      {result ? (
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          <strong className="tabular-nums">+{formatPoints(result.points)}</strong> points
          {correct ? <> in {formatSeconds(result.seconds)}</> : null}
        </p>
      ) : null}
      {result?.credit ? <Credit credit={result.credit} /> : null}
      <Button ref={next} disabled={pending} onClick={onNext}>
        {isLastRound ? "See results" : "Next image"}
      </Button>
    </section>
  );
}

/**
 * Image source and license, required by CC BY-SA. Only after the round:
 * the source and file name often give the answer away.
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
    <p className="text-xs text-zinc-600 dark:text-zinc-400">
      Photo: {source} ({credit.license})
    </p>
  );
}
