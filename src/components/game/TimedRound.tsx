"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type HTMLAttributes } from "react";
import { speedLabel, speedTier, STREAK_SHOWN_FROM, type SpeedTier } from "@/game/feedback";
import { formatPoints, formatSeconds, readClock, secondsNow, type ClockReading } from "@/game/round-clock";
import type { Puzzle, PuzzleEffect, TimedScoringConfig } from "@/game/types";
import { Button, chipClass, TextInput } from "../ui/controls";
import { Confetti } from "./Confetti";
import { EffectCanvas } from "./EffectCanvas";
import {
  POP,
  POP_TIMING,
  PULSE,
  PULSE_TIMING,
  SHAKE,
  SHAKE_TIMING,
  useAnimateOn,
  usePrefersReducedMotion,
} from "./motion";
import { CAPS, Corners, CropMark, MONITOR } from "./monitor";
import { buzz, sounds, unlockAudio } from "./sound";
import { SoundToggle } from "./SoundToggle";

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
  /** Rounds guessed in a row just before this one (#283). Shown from 2, and raises the correct sound's pitch. */
  streak?: number;
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
  streak = 0,
  pending = false,
  onStart,
  onGuess,
  onNext,
  onTimeUp,
}: TimedRoundProps) {
  const clock = useRoundClock(phase === "playing", elapsedSeconds, scoring);
  // Celebrate only what happens while this is on screen: a round resumed
  // after a refresh, already over, doesn't replay its confetti or sounds.
  const [mountPhase] = useState(phase);
  const justWon = phase === "correct" && mountPhase !== "correct";
  const tier: SpeedTier | null = phase === "correct" && result ? speedTier(result.seconds, scoring) : null;
  // A time-out ends the streak, so the chip goes with it.
  const streakNow = phase === "correct" ? streak + 1 : phase === "timedOut" ? 0 : streak;
  useRoundSounds({ phase, wrongGuesses, clock, streak, tier });
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
    <div className="relative flex w-full max-w-md flex-col items-center gap-4">
      <div className="flex min-h-10 w-full items-center justify-between gap-2">
        {streakNow >= STREAK_SHOWN_FROM ? <StreakChip count={streakNow} /> : <span />}
        <SoundToggle />
      </div>

      {/* The "monitor" (#183): the photo in a deep-plum frame, with the score and clock on it. */}
      <div
        data-monitor
        className={MONITOR}
      >
        {/* The instrument rows stay in every phase, so the monitor never changes height (#183). */}
        {phase === "playing" ? (
          <LiveScore clock={clock} timeUp={localTimeUp} scoring={scoring} />
        ) : phase === "ready" ? (
          <Readout
            left={{ label: "points if you guess now", value: formatPoints(scoring.maxPoints), tone: "text-meadow" }}
            right={{ label: "Time left", value: formatClock(scoring.limitSeconds), tone: "text-meadow" }}
          />
        ) : (
          <Readout
            left={{
              label: phase === "correct" ? "round score" : "time's up",
              value: `+${formatPoints(result?.points ?? 0)}`,
              unit: "pts",
              tone: phase === "correct" ? "text-meadow" : "text-peach",
            }}
            right={{
              label: "Time",
              value: phase === "correct" && result ? formatSeconds(result.seconds) : formatClock(0),
              tone: phase === "correct" ? "text-meadow" : "text-peach",
            }}
          />
        )}
        <PhotoStage
          phase={phase}
          imageSrc={imageSrc}
          effect={effect}
          focus={focus}
          seed={seed}
          progress={over ? 1 : clock.progress}
          wrongGuesses={wrongGuesses}
          wonPoints={justWon && result ? result.points : null}
        />
        {phase === "playing" ? (
          <TimerBar clock={clock} scoring={scoring} />
        ) : (
          <TimeTrack
            scoring={scoring}
            filled={phase === "ready" ? 0 : Math.min((result?.seconds ?? scoring.limitSeconds) / scoring.limitSeconds, 1)}
            clearing={phase !== "timedOut" && (result?.seconds ?? 0) < scoring.revealSeconds}
          />
        )}
      </div>
      {justWon ? <Confetti /> : null}

      {phase === "ready" ? (
        <div className="flex flex-col items-center gap-2 text-center">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            The score starts at {formatPoints(scoring.maxPoints)} and drains until you guess right.
          </p>
          <Button
            size="lg"
            disabled={pending}
            onClick={() => {
              // A click is what lets the browser play this round's sounds.
              unlockAudio();
              onStart();
            }}
            autoFocus
          >
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
        <RoundOver
          phase={phase}
          result={result}
          tier={tier}
          isLastRound={isLastRound}
          pending={pending}
          onNext={onNext}
        />
      )}
    </div>
  );
}

/**
 * The round's sounds and haptics (#283), on changes seen while mounted: the
 * start, each new wrong guess, each of the last 5 seconds, and the result.
 */
function useRoundSounds({
  phase,
  wrongGuesses,
  clock,
  streak,
  tier,
}: {
  phase: TimedRoundPhase;
  wrongGuesses: number;
  clock: ClockReading;
  streak: number;
  tier: SpeedTier | null;
}) {
  const last = useRef({ phase, wrongGuesses, second: Math.ceil(clock.secondsLeft) });

  useEffect(() => {
    const before = last.current.phase;
    last.current.phase = phase;
    if (before === phase) return;
    if (before === "ready" && phase === "playing") sounds.start();
    if (before === "playing" && phase === "correct") {
      sounds.correct(streak, tier === "lightning");
      buzz([15, 40, 25]);
    }
    if (before === "playing" && phase === "timedOut") {
      sounds.timeUp();
      buzz(120);
    }
  }, [phase, streak, tier]);

  useEffect(() => {
    const before = last.current.wrongGuesses;
    last.current.wrongGuesses = wrongGuesses;
    if (wrongGuesses > before) {
      sounds.wrong();
      buzz(50);
    }
  }, [wrongGuesses]);

  const second = Math.ceil(clock.secondsLeft);
  useEffect(() => {
    const before = last.current.second;
    last.current.second = second;
    if (phase === "playing" && second < before && second >= 1 && second <= URGENT_SECONDS) sounds.tick(second);
  }, [phase, second]);
}

/** The last seconds tick and pulse (#283). */
const URGENT_SECONDS = 5;

/** "🔥 3 in a row": rounds guessed in a row, counting this one once it's right (#283). */
function StreakChip({ count }: { count: number }) {
  return (
    <p data-streak className={chipClass("flash", "badge-pop")}>
      <LineIcon d={FLAME} />
      {count} in a row
    </p>
  );
}

/**
 * The live score's colour by how much is left (#283): green while most of the
 * points are there, amber as they drain, red near the bottom. Colour is never
 * the only signal: the number itself says the same.
 */
function scoreTone(points: number, scoring: TimedScoringConfig): string {
  const span = scoring.maxPoints - scoring.minPoints;
  const share = span > 0 ? (points - scoring.minPoints) / span : 0;
  // On the deep-plum monitor: Meadow, then Flash, then Peach (all above 8:1).
  if (share >= 0.5) return "text-meadow";
  if (share >= 0.15) return "text-flash";
  return "text-peach";
}

/** "0:21": whole seconds left, for the monitor's clock (#183). */
function formatClock(secondsLeft: number): string {
  const whole = Math.ceil(Math.max(0, secondsLeft));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * The monitor's instrument row (#183): the big draining number on the left,
 * the time left on the right. Not a live region: it changes 20 times a second.
 */
function LiveScore({ clock, timeUp, scoring }: { clock: ClockReading; timeUp: boolean; scoring: TimedScoringConfig }) {
  const second = Math.ceil(clock.secondsLeft);
  const urgent = !timeUp && second >= 1 && second <= URGENT_SECONDS ? second : null;
  const number = useAnimateOn<HTMLSpanElement>(urgent, PULSE, PULSE_TIMING);
  return (
    <div
      className="flex items-end justify-between gap-3 px-2 pt-1 pb-2.5"
      role="timer"
      aria-label="Points if you guess now"
    >
      <div className="flex flex-col items-start">
        <span className={CAPS} aria-hidden="true">
          {clock.phase === "clearing" ? "points if you guess now" : timeUp ? "time's up" : "photo is clear"}
        </span>
        <span
          ref={number}
          data-live-points
          className={`inline-block font-display text-4xl tracking-[-0.05em] tabular-nums transition-colors duration-300 sm:text-5xl ${scoreTone(clock.points, scoring)}`}
          aria-hidden="true"
        >
          {formatPoints(clock.points)}
        </span>
      </div>
      {/* Read on demand by screen readers, rounded so it doesn't flicker. */}
      <span className="sr-only">
        {timeUp ? "Time's up" : `${formatPoints(clock.points)} points, ${Math.ceil(clock.secondsLeft)} seconds left`}
      </span>
      <div className="flex flex-col items-end" aria-hidden="true">
        <span className={CAPS}>Time left</span>
        <span
          data-time-left
          className={`font-mono text-3xl font-bold tabular-nums sm:text-4xl ${urgent !== null || timeUp ? "text-peach" : "text-meadow"}`}
        >
          {formatClock(clock.secondsLeft)}
        </span>
      </div>
    </div>
  );
}

/**
 * The round's time as a bar (#183): Meadow while the photo clears, Peach in
 * the last stretch after it's clear, with a mark where it's clear and labels
 * under it.
 */
function TimerBar({ clock, scoring }: { clock: ClockReading; scoring: TimedScoringConfig }) {
  const filled = Math.min(clock.seconds / scoring.limitSeconds, 1);
  const whole = Math.min(Math.floor(clock.seconds), scoring.limitSeconds);
  return (
    <TimeTrack
      scoring={scoring}
      filled={filled}
      clearing={clock.phase === "clearing"}
      bar={{
        role: "progressbar",
        "aria-label": "Time",
        "aria-valuemin": 0,
        "aria-valuemax": scoring.limitSeconds,
        "aria-valuenow": whole,
        "aria-valuetext": `${whole} of ${scoring.limitSeconds} seconds`,
      }}
    />
  );
}

/**
 * The time track and its labels (#183). The fill is a `scaleX` transform, not
 * a width, so ticking 20 times a second never re-lays out the page. Outside
 * the playing phase it's decorative (no `bar` attributes, aria-hidden).
 */
function TimeTrack({
  scoring,
  filled,
  clearing,
  bar,
}: {
  scoring: TimedScoringConfig;
  filled: number;
  clearing: boolean;
  bar?: HTMLAttributes<HTMLDivElement> & Record<`aria-${string}`, string | number>;
}) {
  const clearAt = scoring.revealSeconds / scoring.limitSeconds;
  return (
    <div className="px-0.5 pt-2.5" aria-hidden={bar ? undefined : true}>
      <div {...bar} className="relative h-1.5 w-full overflow-hidden rounded-full bg-[#615174]">
        <div
          data-timer-fill
          className={`h-full w-full origin-left rounded-full ${clearing ? "bg-meadow" : "bg-peach"}`}
          style={{ transform: `scaleX(${filled})` }}
        />
        {/* Where the photo is clear and the score bottoms out. */}
        <div
          data-clear-mark
          aria-hidden="true"
          className="absolute top-0 h-full w-1 bg-plum"
          style={{ left: `${clearAt * 100}%` }}
        />
      </div>
      <div className={`flex justify-between pt-1.5 ${CAPS}`} aria-hidden="true">
        <span>Start</span>
        <span>
          Clear {scoring.revealSeconds}s / {scoring.limitSeconds}s
        </span>
      </div>
    </div>
  );
}

/**
 * The instrument row outside the playing phase (#183): what the round starts
 * at, or what it scored. Decorative: the page says the same in words.
 */
function Readout({
  left,
  right,
}: {
  left: { label: string; value: string; tone: string; unit?: string };
  right: { label: string; value: string; tone: string };
}) {
  return (
    <div data-readout className="flex items-end justify-between gap-3 px-2 pt-1 pb-2.5" aria-hidden="true">
      <div className="flex flex-col items-start">
        <span className={CAPS}>{left.label}</span>
        <span className={`font-display text-4xl tracking-[-0.05em] whitespace-nowrap tabular-nums sm:text-5xl ${left.tone}`}>
          {left.value}
          {left.unit ? <span className="ml-1 font-mono text-base tracking-normal">{left.unit}</span> : null}
        </span>
      </div>
      <div className="flex flex-col items-end">
        <span className={CAPS}>{right.label}</span>
        <span className={`font-mono text-3xl font-bold whitespace-nowrap tabular-nums sm:text-4xl ${right.tone}`}>{right.value}</span>
      </div>
    </div>
  );
}

/** Line icons in the brand glyph's stroke style, instead of emoji (#183). Decorative. */
const FLAME = "M12 21c-3.9 0-6.5-2.6-6.5-6 0-2.7 1.6-4.4 3-6 .4 1.4 1.2 2.4 2.3 2.9C10.6 8.6 12 5.6 14.6 3c.3 2.8 1.6 4.6 2.8 6.2 1 1.4 1.6 2.9 1.6 4.8 0 3.9-2.9 7-7 7z";
const BOLT = "M13 2 4 14h7l-1 8 9-12h-7z";
const EYE = "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z";

function LineIcon({ d }: { d: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
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
  wonPoints,
}: {
  phase: TimedRoundPhase;
  imageSrc: string | null;
  effect?: PuzzleEffect | undefined;
  focus?: Puzzle["reveal"]["focus"] | undefined;
  seed?: string | undefined;
  progress: number;
  wrongGuesses: number;
  /** Points just won while this was on screen: the photo pops and "+points" floats up (#283). */
  wonPoints: number | null;
}) {
  const popRef = useAnimateOn<HTMLDivElement>(wonPoints !== null ? "won" : null, POP, POP_TIMING);
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
    "relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-[10px] bg-[#393052]";

  if (imageSrc === null || phase === "ready") {
    return (
      <div
        className={`${frame} bg-[repeating-linear-gradient(45deg,#352b4b_0px,#352b4b_13px,#3b3054_13px,#3b3054_26px)] text-[#e5d2fc]`}
      >
        <div className="flex flex-col items-center gap-3 px-6 text-center">
          <CropMark className="size-14" />
          <p className="text-sm">The photo appears when you start.</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={popRef} className="w-full">
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
        {phase === "playing" ? <Corners /> : null}
        <div
          data-wrong-flash={flashOn ? "on" : "off"}
          aria-hidden="true"
          className={`pointer-events-none absolute inset-0 rounded-xl ring-4 ring-inset ring-peach ${reduced ? "" : "transition-opacity duration-300"} ${flashOn ? "bg-peach/30 opacity-100" : "opacity-0"}`}
        />
        {wonPoints !== null && !reduced ? (
          // Decorative: the result below says the points in words.
          <span
            data-points-float
            aria-hidden="true"
            className="points-float pointer-events-none absolute rounded-lg border border-[#5a793a] bg-meadow px-4 py-1 font-display text-3xl tabular-nums text-plum shadow-[0_4px_0_#668446]"
          >
            +{formatPoints(wonPoints)}
          </span>
        ) : null}
      </div>
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
            placeholder="What’s in the picture?"
            autoFocus
            className="min-w-0 flex-1"
          />
          <Button type="submit" variant="flash" disabled={pending || disabled}>
            Guess
          </Button>
        </div>
      </form>
      <p role="status" aria-live="polite" className="flex min-h-6 items-start gap-2 font-semibold text-rust">
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
  tier,
  isLastRound,
  pending,
  onNext,
}: {
  phase: "correct" | "timedOut";
  result: TimedRoundProps["result"];
  tier: SpeedTier | null;
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
    <section
      aria-label="Round result"
      className="flex w-full flex-col items-center gap-2 rounded-xl border border-zinc-300 bg-paper px-4 py-4 text-center shadow-[0_4px_0_var(--color-zinc-300)] dark:border-zinc-700 dark:bg-zinc-800 dark:shadow-[0_4px_0_var(--color-zinc-700)]"
    >
      <p
        role="status"
        className={`font-display text-2xl tracking-tight ${correct ? "text-emerald-700 dark:text-emerald-400" : "text-zinc-900 dark:text-zinc-50"}`}
      >
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
      {tier ? (
        <p data-speed={tier} className={chipClass("meadow", "badge-pop")}>
          <LineIcon d={tier === "lightning" ? BOLT : EYE} />
          {speedLabel(tier)}
        </p>
      ) : null}
      {result?.credit ? <Credit credit={result.credit} /> : null}
      <Button ref={next} disabled={pending} onClick={onNext} className="mt-1">
        {isLastRound ? "See results" : "Next image"}
        <span aria-hidden="true">→</span>
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
