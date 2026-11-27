"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Round } from "@/game/round";
import { Button, CARD, TextInput } from "../ui/controls";
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
   * True while the last move is still on its way to the server: Guess, Skip
   * and Next are marked disabled and ignored. The text box stays editable so
   * typing the next guess doesn't lose keystrokes.
   */
  pending?: boolean;
  onGuess: (guess: string) => void;
  onSkip: () => void;
  onNext: () => void;
  /** Once the round is over, shown in the result card under the status line: points, the AI verdict, the credit. */
  result?: ReactNode;
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
      return `“${feedback.guess}” isn't it (${n} wrong ${n === 1 ? "guess" : "guesses"}). Try again, zoom out, or skip.`;
    }
    case "correct":
      return feedback.matched === feedback.answer
        ? `Correct! It's ${feedback.answer}.`
        : `Correct! It's ${feedback.answer} (you said ${feedback.matched}).`;
    case "skipped":
      return `Skipped. It was ${feedback.answer}.`;
  }
}

/**
 * Guess input, feedback and round controls (#14). Render it with a key per
 * image (e.g. `key={round.position}`) so the input resets for each image.
 * Once the round is over, the same status line heads a result card (#183),
 * like the timed round's, with `result` and Next image under it.
 */
export function GuessPanel({ round, feedback, isLastRound, pending = false, onGuess, onSkip, onNext, result }: GuessPanelProps) {
  const [guess, setGuess] = useState("");
  const inputId = useId();
  const nextButton = useRef<HTMLButtonElement>(null);
  const playing = round.state === "playing";

  // When the round ends, move focus to the next step so keyboard and
  // screen-reader users aren't left on a control that disappeared.
  useEffect(() => {
    if (!playing) nextButton.current?.focus();
  }, [playing]);

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
  // Rust is the error ink in both modes (globals.css lightens it in the dark).
  const tone =
    feedback.kind === "correct"
      ? "text-emerald-700 dark:text-emerald-400"
      : feedback.kind === "incorrect" || feedback.kind === "empty"
        ? "text-rust"
        : playing
          ? "text-zinc-700 dark:text-zinc-300"
          : "text-zinc-900 dark:text-zinc-50";

  return (
    <section aria-label="Your guess" className="flex w-full max-w-md flex-col gap-3">
      {/* The form and the result card share one status line, at the same place
          in the tree, so it's never re-created and screen readers hear each change. */}
      {playing ? (
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
            {/* The screen's main action while playing, in Peach Flash as in the timed round (#183). */}
            <Button type="submit" variant="flash" disabled={pending}>
              Guess
            </Button>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">
              {round.wrongGuesses > 0
                ? `${round.wrongGuesses} wrong ${round.wrongGuesses === 1 ? "guess" : "guesses"}`
                : ""}
            </span>
            <Button variant="quiet" disabled={pending} onClick={onSkip}>
              Skip this image
            </Button>
          </div>
        </form>
      ) : null}
      <div
        data-round-result={playing ? undefined : ""}
        className={playing ? "contents" : `${CARD} flex flex-col items-center gap-2 px-4 py-4 text-center`}
      >
        {/* Always rendered so screen readers announce changes to it. */}
        <p
          role="status"
          aria-live="polite"
          className={`flex min-h-6 items-start gap-2 ${tone} ${
            playing
              ? feedback.kind === "correct"
                ? "font-semibold"
                : ""
              : "justify-center font-display text-2xl tracking-tight text-balance"
          }`}
        >
          {icon && (
            <span aria-hidden="true" data-feedback-icon className="font-bold">
              {icon}
            </span>
          )}
          <span>{message}</span>
        </p>
        {playing ? null : (
          <>
            {result}
            <Button ref={nextButton} size="lg" disabled={pending} onClick={onNext} className="mt-2">
              {isLastRound ? "See results" : "Next image"}
              <span aria-hidden="true">→</span>
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
