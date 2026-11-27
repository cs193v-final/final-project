"use client";

import { useEffect } from "react";
import {
  effectiveReducedMotion,
  readMotionChoice,
  setMotionChoice,
  systemPrefersReducedMotion,
  useMotionChoice,
} from "./game/motion";
import { buttonClass, FOCUS_RING } from "./ui/styles";

/**
 * Keeps `:root[data-reduced-motion]` (globals.css) in step with the choice
 * and the system setting. Reads them fresh in the browser rather than using
 * `reduced`, which is the server's guess on the first (hydration) render: that
 * would briefly undo what the boot script set (#303 review). `reduced` only
 * re-runs the effect when either changes.
 */
function useSyncMotionAttribute(reduced: boolean) {
  useEffect(() => {
    document.documentElement.toggleAttribute(
      "data-reduced-motion",
      effectiveReducedMotion(readMotionChoice(), systemPrefersReducedMotion()),
    );
  }, [reduced]);
}

/**
 * Turns the game's animations on or off (#183), whatever the system's
 * Reduce motion setting says. Many players have that setting on without
 * knowing; this lets them choose here. Remembered in this browser.
 */
export function MotionToggle() {
  const { choice, system } = useMotionChoice();
  const reduced = effectiveReducedMotion(choice, system);
  useSyncMotionAttribute(reduced);
  return (
    <button
      type="button"
      aria-pressed={!reduced}
      onClick={() => setMotionChoice(reduced ? "on" : "off")}
      className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border border-[#776795] bg-paper/90 px-3 text-xs font-semibold text-zinc-700 backdrop-blur-sm hover:bg-paper dark:border-zinc-400 dark:bg-zinc-800/90 dark:text-zinc-200 ${FOCUS_RING}`}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 12c2.5-4 5.5-4 8 0s5.5 4 8 0" />
      </svg>
      Animations
    </button>
  );
}

/**
 * One line on the home screen when animations are off only because of the
 * system setting (#183): says why, and turns them on in one click. Nothing
 * when the player chose in the game, or the system doesn't ask.
 */
export function MotionHint() {
  const { choice, system } = useMotionChoice();
  if (choice !== "system" || !system) return null;
  return (
    <p data-motion-hint className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm text-zinc-700 dark:text-zinc-300">
      <span>Animations are off because your device asks for reduced motion.</span>
      <button type="button" onClick={() => setMotionChoice("on")} className={buttonClass("quiet", "min-h-8 px-1 underline")}>
        Turn on animations
      </button>
    </p>
  );
}
