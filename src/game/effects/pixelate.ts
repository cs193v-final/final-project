// Pixelate (#257): huge blocks that shrink until the photo is sharp. For
// simple photos. Each block is the average colour of the photo under it.

import { lerp, packPixel, words, type EffectSetup } from "./pixels.ts";

/** The block size at the start, as a fraction of the photo's longer side: about 11 blocks across. */
export const PIXELATE_START_BLOCK = 110 / 1200;
/** Below 1, the blocks shrink fast at first and slowly at the end, when they're small enough to read. */
export const PIXELATE_EASE = 0.55;

/** The block size in pixels at `progress` (0–1) for a photo whose longer side is `longSide` pixels. */
export function pixelateBlock(progress: number, longSide: number): number {
  return Math.max(1, Math.round(lerp(PIXELATE_START_BLOCK * longSide, 1, progress ** PIXELATE_EASE)));
}

export const pixelate: EffectSetup = ({ data, width, height }) => {
  const longSide = Math.max(width, height);
  return (progress, out) => {
    const block = pixelateBlock(progress, longSide);
    if (block <= 1) {
      out.set(data);
      return;
    }
    const cols = Math.max(1, Math.round(width / block));
    const rows = Math.max(1, Math.round(height / block));
    const left = Int32Array.from({ length: cols + 1 }, (_, c) => Math.floor((c * width) / cols));
    const pixels = words(out);
    for (let row = 0; row < rows; row++) {
      const y0 = Math.floor((row * height) / rows);
      const y1 = Math.floor(((row + 1) * height) / rows);
      for (let c = 0; c < cols; c++) {
        const x0 = left[c]!, x1 = left[c + 1]!;
        let r = 0, g = 0, b = 0, a = 0;
        for (let y = y0; y < y1; y++) {
          for (let i = (y * width + x0) * 4, end = (y * width + x1) * 4; i < end; i += 4) {
            r += data[i]!;
            g += data[i + 1]!;
            b += data[i + 2]!;
            a += data[i + 3]!;
          }
        }
        const n = (x1 - x0) * (y1 - y0);
        const colour = packPixel(r / n, g / n, b / n, a / n);
        for (let y = y0; y < y1; y++) pixels.fill(colour, y * width + x0, y * width + x1);
      }
    }
  };
};
