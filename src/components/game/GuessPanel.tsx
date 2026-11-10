"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { Round } from "@/game/round";
import type { Feedback } from "./practice";

export type GuessPanelProps = {
  round: Round;
  feedback: Feedback;
  /** True on the last image, so the button after the round says "See results". */
  isLastRound: boolean;
  onGuess: (guess: string) => void;
  onSkip: () => void;
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
 * Guess input, feedback and round controls (#14). Render it with
 * `key={round.puzzleId}` so the input resets for each image.
 */
export function GuessPanel({ round, feedback, isLastRound, onGuess, onSkip, onNext }: GuessPanelProps) {
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
    onGuess(guess);
    // Keep blank input as-is (the hint explains it); clear anything that counted.
    if (guess.trim() !== "") setGuess("");
  }

  const message = feedbackText(feedback);
  const tone =
    feedback.kind === "correct"
      ? "text-emerald-700 dark:text-emerald-400"
      : feedback.kind === "incorrect" || feedback.kind === "empty"
        ? "text-rose-700 dark:text-rose-400"
        : "text-zinc-700 dark:text-zinc-300";

  return (
    <section aria-label="Your guess" className="flex w-full max-w-md flex-col gap-3">
      {playing ? (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <label htmlFor={inputId} className="text-sm font-medium">
            What is it?
          </label>
          <div className="flex gap-2">
            <input
              id={inputId}
              name="guess"
              type="text"
              value={guess}
              onChange={(e) => setGuess(e.target.value)}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="send"
              autoFocus
              className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-900"
            />
            <button
              type="submit"
              className="rounded-lg bg-zinc-900 px-4 py-2 font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              Guess
            </button>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">
              {round.wrongGuesses > 0
                ? `${round.wrongGuesses} wrong ${round.wrongGuesses === 1 ? "guess" : "guesses"}`
                : ""}
            </span>
            <button
              type="button"
              onClick={onSkip}
              className="rounded-lg px-3 py-1.5 font-medium text-zinc-700 underline-offset-4 hover:underline dark:text-zinc-300"
            >
              Skip this image
            </button>
          </div>
        </form>
      ) : (
        <button
          ref={nextButton}
          type="button"
          onClick={onNext}
          className="self-start rounded-lg bg-zinc-900 px-4 py-2 font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {isLastRound ? "See results" : "Next image"}
        </button>
      )}
      {/* Always rendered so screen readers announce changes to it. */}
      <p role="status" aria-live="polite" className={`min-h-6 ${tone}`}>
        {message}
      </p>
    </section>
  );
}
