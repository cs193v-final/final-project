import type { Puzzle, RevealLevel } from "./types.ts";

/**
 * How to show one reveal level: scale the image by `scale` around its top-left
 * corner, then shift it by `translateX` / `translateY` (percent of the image's
 * own size) so the crop window lands in the viewer.
 */
export type CropTransform = {
  scale: number;
  translateX: number;
  translateY: number;
};

/** Clamp a level to `0 … zoomLevels.length - 1`, rounding to an integer. */
export function clampRevealLevel(reveal: Puzzle["reveal"], level: RevealLevel): RevealLevel {
  const max = Math.max(0, reveal.zoomLevels.length - 1);
  if (!Number.isFinite(level)) return 0;
  return Math.min(max, Math.max(0, Math.round(level)));
}

/** The zoom factor for a reveal level. Anything below 1 (or missing) shows the full image. */
export function zoomAt(reveal: Puzzle["reveal"], level: RevealLevel): number {
  const zoom = reveal.zoomLevels[clampRevealLevel(reveal, level)];
  return zoom !== undefined && Number.isFinite(zoom) && zoom >= 1 ? zoom : 1;
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5;
}

/**
 * The transform that shows a crop `1/zoom` of the image wide and tall, centred
 * on `focus` (0–1 fractions of width and height). Near an edge the window
 * slides inward instead of showing empty space past the image.
 */
export function cropTransform(focus: Puzzle["reveal"]["focus"], zoom: number): CropTransform {
  const z = Number.isFinite(zoom) && zoom >= 1 ? zoom : 1;
  const half = 1 / (2 * z); // half the window, as a fraction of the image
  const axis = (c: number) => {
    const centre = Math.min(1 - half, Math.max(half, clamp01(c)));
    // The window's left/top edge (centre - half) must land at 0 after scaling.
    const t = -(z * centre - 0.5) * 100;
    return Object.is(t, -0) ? 0 : t;
  };
  return { scale: z, translateX: axis(focus.x), translateY: axis(focus.y) };
}

/** `cropTransform` for a puzzle at a reveal level, as a CSS `transform` value. */
export function cropTransformCss(reveal: Puzzle["reveal"], level: RevealLevel): string {
  const { scale, translateX, translateY } = cropTransform(reveal.focus, zoomAt(reveal, level));
  return `translate(${translateX}%, ${translateY}%) scale(${scale})`;
}
