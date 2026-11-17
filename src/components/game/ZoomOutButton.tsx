"use client";

import { useId, type MouseEvent } from "react";
import type { Round } from "../../game/round";
import { Button } from "../ui/controls";

export type ZoomOutButtonProps = {
  /** The current round. The button reads its level; the round logic owns it. */
  round: Pick<Round, "state" | "revealLevel" | "maxRevealLevel">;
  /** Ask the round logic for the next level, e.g. `dispatch({ type: "reveal" })`. */
  onZoomOut: () => void;
  /** True while the last move is still on its way to the server: clicks are ignored. */
  pending?: boolean;
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
export function ZoomOutButton({ round, onZoomOut, pending = false }: ZoomOutButtonProps) {
  const enabled = canZoomOut(round) && !pending;
  const hintId = useId();

  return (
    <div className="flex items-center justify-center gap-3">
      {/* The shared secondary button (#89): `disabled` keeps it focusable at the full image. */}
      <Button
        variant="secondary"
        disabled={!enabled}
        onClick={(event) => handleZoomOutClick(round, onZoomOut, event)}
        aria-describedby={hintId}
      >
        Zoom out
      </Button>
      <span id={hintId} className="text-sm text-zinc-600 dark:text-zinc-400">
        {hint(round)}
      </span>
    </div>
  );
}
