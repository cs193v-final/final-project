"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { Round } from "@/game/round";
import { Button, TextInput } from "../ui/controls";
import { SHAKE, SHAKE_TIMING, useAnimateOn } from "./motion";
import type { Feedback } from "./practice";

/**
 * Icon shown before the message, so right and wrong never rely on color alone
 * (#48). Decorative: the message text already says "Correct!" or "isn't it".
 */
function feedbackIcon(feedback: Feedback): string | null {
  switch (feedback.kind) {
    case "correct":
      return "✓";
    case "incorrect":
      return "✗";
    default:
      return null;
  }
}

export type GuessPanelProps = {
  round: Pick<Round, "state" | "wrongGuesses">;
  feedback: Feedback;
  /** True on the last image, so the button after the round says "See results". */
  isLastRound: boolean;
  /**
   * True while the last move is still on its way to the server: Start, Guess
   * and Next are marked disabled and ignored. The text box stays editable so
   * typing the next guess doesn't lose keystrokes.
   */
  pending?: boolean;
  /** Starts the round's clock (#255). */
  onStart: () => void;
  onGuess: (guess: string) => void;
  onNext: () => void;
};

function feedbackText(feedback: Feedback): string {
  switch (feedback.kind) {
    case "none":
      return "";
    case "empty":
      return "Type a guess first.";
    case "incorrect": {
      // The count makes each wrong guess change the live region's text, so a
      // screen reader announces a repeated guess too.
      const n = feedback.wrongGuesses;
      return `“${feedback.guess}” isn't it (${n} wrong ${n === 1 ? "guess" : "guesses"}). Keep going.`;
    }
    case "correct":
      return feedback.matched === feedback.answer
        ? `Correct! It's ${feedback.answer}.`
        : `Correct! It's ${feedback.answer} (you said ${feedback.matched}).`;
    case "timedOut":
      return `Time's up. It was ${feedback.answer}.`;
  }
}

/**
 * Start, guess input, feedback and round controls (#14; timed rounds, #255).
 * Render it with a key per image (e.g. `key={round.position}`) so the input
 * resets for each image.
 */
export function GuessPanel({ round, feedback, isLastRound, pending = false, onStart, onGuess, onNext }: GuessPanelProps) {
  const [guess, setGuess] = useState("");
  const inputId = useId();
  const nextButton = useRef<HTMLButtonElement>(null);
  const ready = round.state === "ready";
  const playing = round.state === "playing";
  const over = !ready && !playing;

  // When the round ends, move focus to the next step so keyboard and
  // screen-reader users aren't left on a control that disappeared.
  useEffect(() => {
    if (over) nextButton.current?.focus();
  }, [over]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return; // keep the text; it can be sent once the last move is back
    onGuess(guess);
    // Keep blank input as-is (the hint explains it); clear anything that counted.
    if (guess.trim() !== "") setGuess("");
  }

  // Shake the guess box on each wrong guess. Every wrong guess makes a new
  // feedback object, so a repeated guess shakes again (#48). Not for the
  // feedback the panel mounts with: a game resumed after a refresh shows its
  // last wrong guess, but the player didn't just make it.
  const [mountFeedback] = useState(feedback);
  const guessRow = useAnimateOn<HTMLDivElement>(
    feedback.kind === "incorrect" && feedback !== mountFeedback ? feedback : null,
    SHAKE,
    SHAKE_TIMING,
  );

  const message = feedbackText(feedback);
  const icon = feedbackIcon(feedback);
  const tone =
    feedback.kind === "correct"
      ? "text-emerald-700 dark:text-emerald-400"
      : feedback.kind === "incorrect" || feedback.kind === "empty"
        ? "text-rose-700 dark:text-rose-400"
        : "text-zinc-700 dark:text-zinc-300";

  return (
    <section aria-label="Your guess" className="flex w-full max-w-md flex-col gap-3">
      {ready ? (
        // The screen's main action before the clock starts.
        <Button disabled={pending} onClick={onStart} className="self-start">
          Start round
        </Button>
      ) : playing ? (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <label htmlFor={inputId} className="text-sm font-medium">
            What is it?
          </label>
          <div ref={guessRow} data-guess-row className="flex gap-2">
            <TextInput
              id={inputId}
              name="guess"
              value={guess}
              onChange={(e) => setGuess(e.target.value)}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="send"
              autoFocus
              className="min-w-0 flex-1"
            />
            {/* The screen's main action while playing (#89). */}
            <Button type="submit" disabled={pending}>
              Guess
            </Button>
          </div>
          <div className="flex items-center text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">
              {round.wrongGuesses > 0
                ? `${round.wrongGuesses} wrong ${round.wrongGuesses === 1 ? "guess" : "guesses"}`
                : ""}
            </span>
          </div>
        </form>
      ) : (
        <Button ref={nextButton} disabled={pending} onClick={onNext} className="self-start">
          {isLastRound ? "See results" : "Next image"}
        </Button>
      )}
      {/* Always rendered so screen readers announce changes to it. */}
      <p
        role="status"
        aria-live="polite"
        className={`flex min-h-6 items-start gap-2 ${tone} ${feedback.kind === "correct" ? "font-semibold" : ""}`}
      >
        {icon && (
          <span aria-hidden="true" data-feedback-icon className="font-bold">
            {icon}
          </span>
        )}
        <span>{message}</span>
      </p>
    </section>
  );
}
