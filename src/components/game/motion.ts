"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(REDUCED_MOTION).matches;
}

// On the server we can't know, so assume reduced motion: nothing animates
// until the browser says it may.
function getServerSnapshot(): boolean {
  return true;
}

/** True when the player has asked their system for less motion (#48). Updates live. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Plays a Web Animations API animation on the returned ref's element each time
 * `trigger` changes to a new truthy value, unless the player prefers reduced
 * motion. A new trigger cancels the previous run, so repeated wrong guesses
 * each get their own shake.
 *
 * `keyframes` and `options` should be module-level constants.
 */
export function useAnimateOn<T extends HTMLElement>(
  trigger: unknown,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
) {
  const ref = useRef<T>(null);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!trigger || reduced || !el || typeof el.animate !== "function") return;
    const animation = el.animate(keyframes, options);
    return () => animation.cancel();
  }, [trigger, reduced, keyframes, options]);

  return ref;
}

/** A quick side-to-side shake for a wrong guess. */
export const SHAKE: Keyframe[] = [
  { transform: "translateX(0)" },
  { transform: "translateX(-8px)" },
  { transform: "translateX(7px)" },
  { transform: "translateX(-5px)" },
  { transform: "translateX(3px)" },
  { transform: "translateX(0)" },
];
export const SHAKE_TIMING: KeyframeAnimationOptions = { duration: 400, easing: "ease-in-out" };

/** A small grow-and-settle for the image when a guess is right. */
export const POP: Keyframe[] = [
  { transform: "scale(1)" },
  { transform: "scale(1.04)" },
  { transform: "scale(0.99)" },
  { transform: "scale(1)" },
];
export const POP_TIMING: KeyframeAnimationOptions = { duration: 500, easing: "ease-out" };

/** A strong ease-out for things that land (#283): quick to arrive, gentle to settle. */
export const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";

/** The live score's beat in the last seconds (#283). */
export const PULSE: Keyframe[] = [{ transform: "scale(1)" }, { transform: "scale(1.08)" }, { transform: "scale(1)" }];
export const PULSE_TIMING: KeyframeAnimationOptions = { duration: 220, easing: EASE_OUT };

/** A final-score row arriving (#283). */
export const ROW_IN: Keyframe[] = [
  { opacity: 0, transform: "translateY(6px)" },
  { opacity: 1, transform: "translateY(0)" },
];
export const ROW_IN_TIMING: KeyframeAnimationOptions = { duration: 220, easing: EASE_OUT, fill: "backwards" };
