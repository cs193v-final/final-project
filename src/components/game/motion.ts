"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { MOTION_STORAGE_KEY, REDUCED_MOTION_QUERY } from "../motion-boot";

export { MOTION_STORAGE_KEY };

const REDUCED_MOTION = REDUCED_MOTION_QUERY;

/**
 * The player's in-app choice (#183): "on" or "off" overrides the system's
 * Reduce motion setting; "system" (the default) follows it. Many players have
 * Reduce motion on without knowing, so the game offers a visible switch
 * (`MotionToggle`) instead of ignoring the setting.
 */
export type MotionChoice = "system" | "on" | "off";

const choiceListeners = new Set<() => void>();
// This tab's choice, used if storage isn't available (private mode, blocked).
let chosen: MotionChoice | null = null;

export function readMotionChoice(): MotionChoice {
  if (chosen !== null) return chosen;
  try {
    const stored = window.localStorage.getItem(MOTION_STORAGE_KEY);
    return stored === "on" || stored === "off" ? stored : "system";
  } catch {
    return "system";
  }
}

export function setMotionChoice(choice: MotionChoice) {
  chosen = choice;
  try {
    if (choice === "system") window.localStorage.removeItem(MOTION_STORAGE_KEY);
    else window.localStorage.setItem(MOTION_STORAGE_KEY, choice);
  } catch {
    // Remembered for this tab only.
  }
  choiceListeners.forEach((listener) => listener());
}

/** For tests: forget this tab's choice. */
export function resetMotionChoice() {
  chosen = null;
}

/** Whether the system asks for reduced motion (false where it can't tell). */
export function systemPrefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(REDUCED_MOTION).matches;
}

/** Reduced motion as the game applies it: the player's choice, else the system's setting. */
export function effectiveReducedMotion(choice: MotionChoice, system: boolean): boolean {
  return choice === "off" || (choice === "system" && system);
}

function subscribe(onChange: () => void): () => void {
  choiceListeners.add(onChange);
  const query = typeof window.matchMedia === "function" ? window.matchMedia(REDUCED_MOTION) : null;
  query?.addEventListener("change", onChange);
  return () => {
    choiceListeners.delete(onChange);
    query?.removeEventListener("change", onChange);
  };
}

function getSnapshot(): boolean {
  return effectiveReducedMotion(readMotionChoice(), systemPrefersReducedMotion());
}

// On the server we can't know, so assume reduced motion: nothing animates
// until the browser says it may.
function getServerSnapshot(): boolean {
  return true;
}

/**
 * True when the game should keep motion down (#48): the player turned
 * animations off in the game, or left it to the system and the system asks
 * for less motion. Updates live.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** The player's in-app choice and the system setting, for the switch and the home hint. */
export function useMotionChoice(): { choice: MotionChoice; system: boolean } {
  const choice = useSyncExternalStore(subscribe, readMotionChoice, () => "system" as const);
  const system = useSyncExternalStore(subscribe, systemPrefersReducedMotion, () => false);
  return { choice, system };
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
