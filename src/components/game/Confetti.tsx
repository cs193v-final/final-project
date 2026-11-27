"use client";

import type { CSSProperties } from "react";
import { usePrefersReducedMotion } from "./motion";

// The Picture Island palette (#183): Meadow, Flash, Peach, lavender and Oat Paper.
const COLORS = ["#c4e983", "#ffcf89", "#ffad94", "#b79fe8", "#fffbec"] as const;
const COUNT = 28;

/** Fixed burst pattern (no randomness, so every render and test is the same). */
const PIECES = Array.from({ length: COUNT }, (_, i) => {
  const angle = (i / COUNT) * 2 * Math.PI;
  const distance = 90 + (i % 4) * 30;
  return {
    "--dx": `${Math.round(Math.cos(angle) * distance)}px`,
    // Pieces drift down a little as they fly out, like they have weight.
    "--dy": `${Math.round(Math.sin(angle) * distance + 30)}px`,
    "--rot": `${(i % 2 === 0 ? 1 : -1) * (180 + i * 20)}deg`,
    "--delay": `${(i % 4) * 30}ms`,
    backgroundColor: COLORS[i % COLORS.length],
  } as CSSProperties;
});

/**
 * A one-off confetti burst over its parent for a correct guess (#48). Mount it
 * when the guess is right; it plays once. Purely decorative: hidden from screen
 * readers (the status message says "Correct!"), never takes clicks, and renders
 * nothing when the player prefers reduced motion.
 */
export function Confetti() {
  const reduced = usePrefersReducedMotion();
  if (reduced) return null;
  return (
    <div aria-hidden="true" data-confetti className="pointer-events-none absolute inset-0 overflow-hidden">
      {PIECES.map((style, i) => (
        <span key={i} className="confetti-piece" style={style} />
      ))}
    </div>
  );
}
