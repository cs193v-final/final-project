"use client";

import { useId, type MouseEvent } from "react";
import type { Round } from "../../game/round";

export type ZoomOutButtonProps = {
  /** The current round. The button reads its level; the round logic owns it. */
  round: Pick<Round, "state" | "revealLevel" | "maxRevealLevel">;
  /** Ask the round logic for the next level, e.g. `dispatch({ type: "reveal" })`. */
  onZoomOut: () => void;
};

/** True while the round is being played and there's more of the image to show. */
export function canZoomOut(round: ZoomOutButtonProps["round"]): boolean {
  return round.state === "playing" && round.revealLevel < round.maxRevealLevel;
}

/**
 * What a click does: ask for the next level when there is one, otherwise
 * ignore it. Separate from the component so it can be tested without a DOM.
 */
export function handleZoomOutClick(
  round: ZoomOutButtonProps["round"],
  onZoomOut: () => void,
  event: Pick<MouseEvent, "preventDefault">,
): void {
  if (!canZoomOut(round)) {
    event.preventDefault();
    return;
  }
  onZoomOut();
}

function hint(round: ZoomOutButtonProps["round"]): string {
  if (round.revealLevel >= round.maxRevealLevel) return "Showing the full image";
  if (round.state !== "playing") return "Round over";
  const left = round.maxRevealLevel - round.revealLevel;
  return `${left} ${left === 1 ? "step" : "steps"} left`;
}

/**
 * The Zoom out button (#11). It doesn't change the level itself: it asks the
 * round logic, which emits the `reveal` scoring event.
 *
 * When there's nothing left to reveal it uses `aria-disabled` instead of
 * `disabled`, so a keyboard user who just pressed it keeps focus on it
 * instead of being dropped back to the top of the page.
 */
export function ZoomOutButton({ round, onZoomOut }: ZoomOutButtonProps) {
  const enabled = canZoomOut(round);
  const hintId = useId();

  return (
    <div className="flex items-center justify-center gap-3">
      <button
        type="button"
        onClick={(event) => handleZoomOutClick(round, onZoomOut, event)}
        aria-disabled={!enabled}
        aria-describedby={hintId}
        className="rounded-lg border border-zinc-300 bg-white px-4 py-2 font-medium text-zinc-900 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-white dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800 dark:focus-visible:outline-zinc-100 dark:aria-disabled:hover:bg-zinc-900"
      >
        Zoom out
      </button>
      <span id={hintId} className="text-sm text-zinc-600 dark:text-zinc-400">
        {hint(round)}
      </span>
    </div>
  );
}
