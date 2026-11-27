// Kaleidoscope (#257): the photo folded into narrow mirrored wedges around
// the focus point, slowly turning. The wedges widen until the last one is the
// whole circle, which is the photo. For photos with a strong shape that a
// plain blur would give away.

import { focusPoint, words, type EffectSetup } from "./pixels.ts";

/** Mirrored wedges at the start (each a mirror pair, so 2 × this many slices). */
export const KALEIDOSCOPE_WEDGES = 6;
/** Above 1, the wedges stay narrow for longer and open up near the end. */
export const KALEIDOSCOPE_EASE = 1.6;
/** How far the slice being mirrored turns over the reveal, in radians. */
export const KALEIDOSCOPE_TURN = 1.2;
/** Fully unfolded by this much of the reveal, so the seam where the last wedge meets the first is gone before the end. */
export const KALEIDOSCOPE_OPEN_BY = 0.9;
/** Angles are looked up in this many steps around the circle. */
const ANGLE_STEPS = 4096;
const TAU = 2 * Math.PI;

export const kaleidoscope: EffectSetup = ({ data, width, height }, options) => {
  const focus = focusPoint(options.focus);
  const cx = focus.x * width, cy = focus.y * height;
  const photo = words(data);
  const n = width * height;
  const dist = new Float32Array(n), angle = new Float32Array(n);
  for (let y = 0, i = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i++) {
      const dx = x - cx, dy = y - cy;
      dist[i] = Math.sqrt(dx * dx + dy * dy);
      const a = Math.atan2(dy, dx);
      angle[i] = a < 0 ? a + TAU : a; // 0 – 2π
    }
  }
  const cosTable = Float32Array.from({ length: ANGLE_STEPS + 1 }, (_, k) => Math.cos((k / ANGLE_STEPS) * TAU));
  const sinTable = Float32Array.from({ length: ANGLE_STEPS + 1 }, (_, k) => Math.sin((k / ANGLE_STEPS) * TAU));

  return (progress, out) => {
    const open = Math.min(1, progress / KALEIDOSCOPE_OPEN_BY) ** KALEIDOSCOPE_EASE; // 0: narrowest; 1: one wedge, the whole circle
    if (open >= 1) {
      out.set(data); // unfolded: the photo, exactly
      return;
    }
    const wedge = (TAU / KALEIDOSCOPE_WEDGES) * (1 - open) + TAU * open;
    const turn = KALEIDOSCOPE_TURN * (1 - open); // 0 at the end, so the last frame is the photo
    const pixels = words(out);
    for (let i = 0; i < n; i++) {
      const a = angle[i]!;
      const k = Math.floor(a / wedge);
      let folded = a - k * wedge;
      if (k & 1) folded = wedge - folded; // every other wedge is mirrored, so the edges meet
      let src = folded + turn;
      src -= Math.floor(src / TAU) * TAU;
      const t = Math.round((src / TAU) * ANGLE_STEPS);
      const r = dist[i]!;
      let sx = cx + r * cosTable[t]!, sy = cy + r * sinTable[t]!;
      // Past an edge, reflect back in, so corners show photo instead of a smear.
      if (sx < 0) sx = -sx; else if (sx > width - 1) sx = 2 * (width - 1) - sx;
      if (sy < 0) sy = -sy; else if (sy > height - 1) sy = 2 * (height - 1) - sy;
      sx = sx < 0 ? 0 : sx > width - 1 ? width - 1 : (sx + 0.5) | 0;
      sy = sy < 0 ? 0 : sy > height - 1 ? height - 1 : (sy + 0.5) | 0;
      pixels[i] = photo[sy * width + sx]!;
    }
  };
};
