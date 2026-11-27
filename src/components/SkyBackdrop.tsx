import type { CSSProperties } from "react";

/**
 * The "Picture Island" sky (#183): faceted clouds, like the island's own,
 * drifting slowly across every screen behind the content. Purely
 * decorative: hidden from screen readers, never takes clicks, and behind
 * everything (`-z-10`). The drift is CSS (globals.css: `.sky-cloud`), on
 * `transform` only; `CloudsToggle` pauses it, and with reduced motion the
 * clouds stand still.
 *
 * Each cloud's height, size, speed and starting point are fixed (no
 * randomness), so every render and test is the same. Smaller clouds are
 * further away: slower and fainter.
 */
const CLOUDS: readonly { top: string; width: number; seconds: number; start: number; opacity: number; flip?: boolean }[] = [
  { top: "6%", width: 190, seconds: 110, start: 0.15, opacity: 0.9 },
  { top: "18%", width: 96, seconds: 160, start: 0.62, opacity: 0.6, flip: true },
  { top: "34%", width: 150, seconds: 130, start: 0.38, opacity: 0.75 },
  { top: "52%", width: 80, seconds: 175, start: 0.86, opacity: 0.5, flip: true },
  { top: "64%", width: 220, seconds: 120, start: 0.05, opacity: 0.85, flip: true },
  { top: "80%", width: 120, seconds: 145, start: 0.5, opacity: 0.65 },
  { top: "92%", width: 170, seconds: 125, start: 0.74, opacity: 0.8, flip: true },
];

export function SkyBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {CLOUDS.map((c, i) => (
        <svg
          key={i}
          viewBox="0 0 120 56"
          className="sky-cloud absolute left-0"
          style={
            {
              top: c.top,
              width: c.width,
              opacity: c.opacity,
              animationDuration: `${c.seconds}s`,
              // A negative delay starts each cloud part-way across, so the sky is full on arrival.
              animationDelay: `${-c.start * c.seconds}s`,
            } as CSSProperties
          }
        >
          <g transform={c.flip ? "translate(120 0) scale(-1 1)" : undefined}>
            {/* Puffy, faceted: three bumps on a flat-ish shadowed base, like the island's clouds. */}
            <polygon className="fill-[var(--cloud-lo)]" points="4,40 116,40 108,49 84,53 40,53 14,49" />
            <polygon
              className="fill-[var(--cloud-hi)]"
              points="4,40 9,31 20,27 26,18 38,13 50,17 58,9 72,7 84,13 90,21 102,22 111,30 116,40"
            />
            <polygon className="fill-[var(--cloud-mid)]" points="58,9 72,7 84,13 70,22" />
            <polygon className="fill-[var(--cloud-mid)]" points="90,21 102,22 111,30 116,40 98,36" />
            <polygon className="fill-[var(--cloud-mid)]" points="4,40 9,31 20,27 18,38" />
          </g>
        </svg>
      ))}
    </div>
  );
}
