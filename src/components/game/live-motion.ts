"use client";

import { useEffect, useState } from "react";
import { countUpValue } from "@/game/feedback";
import { EASE_OUT, usePrefersReducedMotion } from "./motion";

// Motion for the zoom-level game's monitor (#183): the "worth now" number
// ticking down, the "−20" chip dropping off it, and the viewfinder corners
// widening on a zoom out. Transform and opacity only, with a strong ease-out.
// Every piece is off with reduced motion (the callers use `useAnimateOn` or
// check `usePrefersReducedMotion`).

/** How long the worth number takes to tick down to its new value. */
export const TICK_DOWN_MS = 250;

/**
 * `target`, ticking down to each new lower value over `durationMs` instead of
 * jumping (the count-up's curve, reversed). A higher value (a new image) is
 * shown at once. With reduced motion, or before the browser can animate, it's
 * just `target`.
 */
export function useTickDown(target: number, durationMs: number = TICK_DOWN_MS): number {
  const reduced = usePrefersReducedMotion();
  // The run in progress: from the value on screen when the target changed, to the target.
  const [run, setRun] = useState({ from: target, to: target });
  const [frame, setFrame] = useState<{ to: number; value: number } | null>(null);
  const onScreen = frame !== null && frame.to === run.to ? frame.value : Math.max(run.from, run.to);
  if (run.to !== target) {
    // A new target: tick from what's on screen now (adjusting state while rendering, not in an effect).
    setRun({ from: target < onScreen ? onScreen : target, to: target });
  }

  const canTick = !reduced && typeof requestAnimationFrame === "function";
  useEffect(() => {
    if (!canTick || run.from <= run.to) return;
    let id = 0;
    const start = performance.now();
    const step = (now: number) => {
      const value = run.from - countUpValue(run.from - run.to, now - start, durationMs);
      setFrame({ to: run.to, value });
      if (value !== run.to) id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [run, canTick, durationMs]);

  return canTick && run.to === target ? onScreen : target;
}

/** The viewfinder corners opening a little wider on a zoom out, then settling. */
export const CORNERS_WIDEN: Keyframe[] = [
  { transform: "scale(1)" },
  { transform: "scale(1.14)", offset: 0.4 },
  { transform: "scale(1)" },
];
export const CORNERS_WIDEN_TIMING: KeyframeAnimationOptions = { duration: 280, easing: EASE_OUT };

/**
 * The "−20" chip: it pops in (≈180 ms), holds so it can be read, then drops
 * and fades (≈260 ms). Each move is short; the hold is what makes it 1.2 s.
 */
export const PENALTY_DROP: Keyframe[] = [
  { opacity: 0, transform: "translateY(-4px) scale(0.9)", offset: 0 },
  { opacity: 1, transform: "translateY(0) scale(1)", offset: 0.15 },
  { opacity: 1, transform: "translateY(0) scale(1)", offset: 0.78 },
  { opacity: 0, transform: "translateY(16px) scale(1)", offset: 1 },
];
export const PENALTY_DROP_MS = 1200;
export const PENALTY_DROP_TIMING: KeyframeAnimationOptions = { duration: PENALTY_DROP_MS, easing: EASE_OUT, fill: "both" };
