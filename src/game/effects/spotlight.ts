// Spotlight (#257): darkness with a small soft hole that widens, drifting
// from the focus point to the middle of the photo.

import { clamp, focusPoint, lerp, packPixel, words, type EffectSetup } from "./pixels.ts";

/** The hole's radius at the start and at the end, as fractions of the photo's diagonal. */
export const SPOTLIGHT_START_RADIUS = 0.035;
export const SPOTLIGHT_END_RADIUS = 1.1;
/** The outer part of the radius that fades from light to dark. */
export const SPOTLIGHT_SOFT_EDGE = 0.25;
/** Above 1, the hole stays small for longer before it opens up. */
export const SPOTLIGHT_EASE = 1.4;
/** The hole reaches the middle of the photo at 1 / this of the reveal. */
export const SPOTLIGHT_DRIFT_SPEED = 1.3;

const BLACK = packPixel(0, 0, 0);

export const spotlight: EffectSetup = ({ data, width, height }, options) => {
  const focus = focusPoint(options.focus);
  const diagonal = Math.sqrt(width * width + height * height);
  const photo = words(data);
  return (progress, out) => {
    const drift = Math.min(1, progress * SPOTLIGHT_DRIFT_SPEED);
    const cx = lerp(focus.x, 0.5, drift) * width;
    const cy = lerp(focus.y, 0.5, drift) * height;
    const radius = lerp(SPOTLIGHT_START_RADIUS, SPOTLIGHT_END_RADIUS, progress ** SPOTLIGHT_EASE) * diagonal;
    const inner = radius * (1 - SPOTLIGHT_SOFT_EDGE);
    const pixels = words(out);

    /** The soft edge, one pixel at a time, for x in [from, to). */
    const soft = (y: number, dy2: number, from: number, to: number) => {
      for (let x = from; x < to; x++) {
        const dx = x + 0.5 - cx;
        const distance = Math.sqrt(dx * dx + dy2);
        const light = distance <= inner ? 1 : clamp((radius - distance) / (radius - inner), 0, 1);
        const i = (y * width + x) * 4;
        out[i] = data[i]! * light;
        out[i + 1] = data[i + 1]! * light;
        out[i + 2] = data[i + 2]! * light;
        out[i + 3] = 255;
      }
    };

    // Row by row: dark outside the hole, the photo inside its lit middle, and
    // only the soft edge between worked out pixel by pixel. Each span's ends
    // are a pixel inside the exact circle, so rounding never puts a pixel in
    // the wrong span.
    for (let y = 0; y < height; y++) {
      const row = y * width;
      const dy = y + 0.5 - cy, dy2 = dy * dy;
      if (dy2 >= radius * radius) {
        pixels.fill(BLACK, row, row + width);
        continue;
      }
      const outer = Math.sqrt(radius * radius - dy2);
      const softFrom = clamp(Math.floor(cx - outer - 0.5) - 1, 0, width);
      const softTo = clamp(Math.ceil(cx + outer - 0.5) + 2, 0, width);
      pixels.fill(BLACK, row, row + softFrom);
      pixels.fill(BLACK, row + softTo, row + width);
      if (dy2 < inner * inner) {
        const half = Math.sqrt(inner * inner - dy2);
        const litFrom = clamp(Math.ceil(cx - half - 0.5) + 1, softFrom, softTo);
        const litTo = clamp(Math.floor(cx + half - 0.5), litFrom, softTo);
        soft(y, dy2, softFrom, litFrom);
        pixels.set(photo.subarray(row + litFrom, row + litTo), row + litFrom);
        soft(y, dy2, litTo, softTo);
      } else {
        soft(y, dy2, softFrom, softTo);
      }
    }
  };
};
