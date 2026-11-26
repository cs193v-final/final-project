// Stretching pixels onto a frame with bilinear blending, shared by zoom and
// thermal (#257). It blends across each source row once, then only blends
// between two cached rows per output row. Bilinear blending works the same
// either way round, so this matches blending four pixels per output pixel,
// at a fraction of the cost when the source has fewer rows than the frame.

import { clamp, wordOf, words, type Pixels } from "./pixels.ts";

/** Where one axis of the frame samples the source: `source = offset + (pixel + 0.5) × scale − 0.5`. */
export type Axis = { offset: number; scale: number };

/** Buffers for `resample`, made once per photo, for frames `width` × `height`. */
export function resampler(width: number, height: number) {
  const lo = new Int32Array(width), hi = new Int32Array(width), frac = new Float32Array(width);
  let upper = new Float32Array(width * 4), lower = new Float32Array(width * 4);

  /** Source row `y` of `src`, blended across into `row`. */
  function across(src: ArrayLike<number>, srcWidth: number, y: number, row: Float32Array) {
    const start = y * srcWidth * 4;
    for (let x = 0, o = 0; x < width; x++, o += 4) {
      const a = start + lo[x]!, b = start + hi[x]!, f = frac[x]!;
      let p = src[a]!;
      row[o] = p + (src[b]! - p) * f;
      p = src[a + 1]!;
      row[o + 1] = p + (src[b + 1]! - p) * f;
      p = src[a + 2]!;
      row[o + 2] = p + (src[b + 2]! - p) * f;
      p = src[a + 3]!;
      row[o + 3] = p + (src[b + 3]! - p) * f;
    }
  }

  /**
   * Draws `src` (`srcWidth` × `srcHeight` RGBA, values 0–255) onto `out`
   * (`width` × `height`), sampling where `x` and `y` say.
   */
  return function resample(src: ArrayLike<number>, srcWidth: number, srcHeight: number, out: Uint8ClampedArray, x: Axis, y: Axis) {
    for (let i = 0; i < width; i++) {
      const s = clamp(x.offset + (i + 0.5) * x.scale - 0.5, 0, srcWidth - 1);
      const f = Math.floor(s);
      lo[i] = f * 4;
      hi[i] = Math.min(f + 1, srcWidth - 1) * 4;
      frac[i] = s - f;
    }
    const pixels = words(out);
    let upperRow = -1, lowerRow = -1;
    for (let j = 0, o = 0; j < height; j++) {
      const s = clamp(y.offset + (j + 0.5) * y.scale - 0.5, 0, srcHeight - 1);
      const top = Math.floor(s), bottom = Math.min(top + 1, srcHeight - 1), v = s - top;
      // Rows only move down the source, so the old lower row is often the new upper one.
      if (top !== upperRow) {
        if (top === lowerRow) [upper, lower] = [lower, upper];
        else across(src, srcWidth, top, upper);
        upperRow = top;
        lowerRow = -1;
      }
      if (bottom !== lowerRow) {
        across(src, srcWidth, bottom, lower);
        lowerRow = bottom;
      }
      // Whole pixels at a time: rounding to whole numbers and writing one word
      // is about twice as fast as writing four fractional bytes.
      for (let k = 0; k < width * 4; k += 4, o++) {
        pixels[o] = wordOf(
          (upper[k]! + (lower[k]! - upper[k]!) * v + 0.5) | 0,
          (upper[k + 1]! + (lower[k + 1]! - upper[k + 1]!) * v + 0.5) | 0,
          (upper[k + 2]! + (lower[k + 2]! - upper[k + 2]!) * v + 0.5) | 0,
          (upper[k + 3]! + (lower[k + 3]! - upper[k + 3]!) * v + 0.5) | 0,
        );
      }
    }
  };
}

/**
 * `src` shrunk to `width` × `height` (no bigger than it either way): each new
 * pixel is the average of the block of pixels it covers.
 */
export function shrinkTo(src: Pixels, width: number, height: number): Uint8ClampedArray {
  const { data } = src;
  const out = new Uint8ClampedArray(width * height * 4);
  const left = Int32Array.from({ length: width + 1 }, (_, x) => Math.floor((x * src.width) / width));
  for (let y = 0, o = 0; y < height; y++) {
    const y0 = Math.floor((y * src.height) / height), y1 = Math.floor(((y + 1) * src.height) / height);
    for (let x = 0; x < width; x++, o += 4) {
      const x0 = left[x]!, x1 = left[x + 1]!;
      let r = 0, g = 0, b = 0, a = 0;
      for (let row = y0; row < y1; row++) {
        for (let i = (row * src.width + x0) * 4, end = (row * src.width + x1) * 4; i < end; i += 4) {
          r += data[i]!;
          g += data[i + 1]!;
          b += data[i + 2]!;
          a += data[i + 3]!;
        }
      }
      const n = (x1 - x0) * (y1 - y0);
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = a / n;
    }
  }
  return out;
}
