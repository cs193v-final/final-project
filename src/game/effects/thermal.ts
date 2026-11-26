// Thermal camera (#257): a blurry heat map (black, purple, red, yellow, white
// by brightness) that sharpens and fades back to the real colours. For simple
// photos.

import { clamp, lerp, wordOf, words, type EffectSetup } from "./pixels.ts";
import { resampler } from "./resample.ts";

/** The blur at the start (its standard deviation), as a fraction of the photo's longer side. */
export const THERMAL_START_BLUR = 28 / 600;
/** Below 1, the blur clears fast at first. */
export const THERMAL_BLUR_EASE = 0.6;
/** The heat-map colours are at full strength until this much of the reveal… */
export const THERMAL_HEAT_FULL_UNTIL = 0.3;
/** …and gone by this much. */
export const THERMAL_HEAT_GONE_BY = 0.9;

/** Brightness 0–255 → heat-map colour, as 256 × [r, g, b]. */
export const THERMAL_PALETTE: Uint8Array = (() => {
  const stops: [number, [number, number, number]][] = [
    [0, [0, 0, 10]],
    [0.18, [40, 10, 110]],
    [0.38, [150, 20, 140]],
    [0.55, [230, 40, 50]],
    [0.72, [255, 130, 0]],
    [0.88, [255, 220, 40]],
    [1, [255, 255, 230]],
  ];
  const palette = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    let k = 0;
    while (k < stops.length - 2 && v > stops[k + 1]![0]) k++;
    const [a, from] = stops[k]!;
    const [b, to] = stops[k + 1]!;
    const t = (v - a) / (b - a);
    for (let j = 0; j < 3; j++) palette[i * 3 + j] = Math.round(lerp(from[j]!, to[j]!, t));
  }
  return palette;
})();

/** Three box blurs that together approximate a Gaussian blur of `sigma`: their radii. */
function boxRadii(sigma: number): number[] {
  const n = 3;
  let lower = Math.floor(Math.sqrt((12 * sigma * sigma) / n + 1));
  if (lower % 2 === 0) lower--;
  const upper = lower + 2;
  const m = Math.round((12 * sigma * sigma - n * lower * lower - 4 * n * lower - 3 * n) / (-4 * lower - 4));
  return Array.from({ length: n }, (_, i) => ((i < m ? lower : upper) - 1) / 2);
}

/** One box blur of radius `r` along each row of a `width` × `height` image, from `src` into `dst`. Past the edge it repeats the edge pixel. */
function blurRows(src: Float32Array, dst: Float32Array, width: number, height: number, r: number) {
  const scale = 1 / (2 * r + 1);
  const last = (width - 1) * 4;
  for (let y = 0; y < height; y++) {
    const base = y * width * 4;
    let s0 = src[base]! * (r + 1), s1 = src[base + 1]! * (r + 1), s2 = src[base + 2]! * (r + 1), s3 = src[base + 3]! * (r + 1);
    for (let j = 1; j <= r; j++) {
      const o = base + Math.min(j * 4, last);
      s0 += src[o]!;
      s1 += src[o + 1]!;
      s2 += src[o + 2]!;
      s3 += src[o + 3]!;
    }
    for (let x = 0, o = base; x < width; x++, o += 4) {
      dst[o] = s0 * scale;
      dst[o + 1] = s1 * scale;
      dst[o + 2] = s2 * scale;
      dst[o + 3] = s3 * scale;
      const add = base + Math.min((x + r + 1) * 4, last), sub = base + Math.max((x - r) * 4, 0);
      s0 += src[add]! - src[sub]!;
      s1 += src[add + 1]! - src[sub + 1]!;
      s2 += src[add + 2]! - src[sub + 2]!;
      s3 += src[add + 3]! - src[sub + 3]!;
    }
  }
}

/**
 * The same down each column. It goes row by row with a running sum per
 * column, so it reads memory in order, which is much faster on a big image
 * than walking down one column at a time.
 */
function blurColumns(src: Float32Array, dst: Float32Array, sums: Float32Array, width: number, height: number, r: number) {
  const scale = 1 / (2 * r + 1);
  const rowBytes = width * 4;
  const rowAt = (y: number) => Math.min(Math.max(y, 0), height - 1) * rowBytes;
  sums.fill(0, 0, rowBytes);
  for (let j = -r; j <= r; j++) {
    const row = rowAt(j);
    for (let k = 0; k < rowBytes; k++) sums[k] = sums[k]! + src[row + k]!;
  }
  for (let y = 0; y < height; y++) {
    const out = y * rowBytes, add = rowAt(y + r + 1), sub = rowAt(y - r);
    for (let k = 0; k < rowBytes; k++) {
      dst[out + k] = sums[k]! * scale;
      sums[k] = sums[k]! + src[add + k]! - src[sub + k]!;
    }
  }
}

/** Blends RGBA `pixels` towards their heat-map colours by `heat` (0–1). */
function addHeat(pixels: Float32Array, heat: number) {
  for (let i = 0; i < pixels.length; i += 4) {
    const lum = Math.round(clamp(0.299 * pixels[i]! + 0.587 * pixels[i + 1]! + 0.114 * pixels[i + 2]!, 0, 255)) * 3;
    pixels[i] = pixels[i]! + (THERMAL_PALETTE[lum]! - pixels[i]!) * heat;
    pixels[i + 1] = pixels[i + 1]! + (THERMAL_PALETTE[lum + 1]! - pixels[i + 1]!) * heat;
    pixels[i + 2] = pixels[i + 2]! + (THERMAL_PALETTE[lum + 2]! - pixels[i + 2]!) * heat;
  }
}

/**
 * The blur is worked out on a copy shrunk by a whole number, as long as the
 * shrunk blur stays at least this many pixels wide; stretching a blur that
 * soft back up looks the same, and costs a fraction of blurring every pixel.
 */
const SHRUNK_BLUR = 1.5;
/**
 * Below this blur (in pixels; the smallest that can still be shrunk by 2),
 * the frame fades from the photo blurred this much, worked out once, to the
 * sharp photo, instead of blurring every pixel of every frame.
 */
const FADE_BLUR = 2 * SHRUNK_BLUR;

export const thermal: EffectSetup = ({ data, width, height }) => {
  const startBlur = THERMAL_START_BLUR * Math.max(width, height);
  const a = new Float32Array(width * height * 4);
  const b = new Float32Array(width * height * 4);
  const sums = new Float32Array(width * 4);
  const resample = resampler(width, height);
  let faded: Uint8ClampedArray | undefined;

  /** The photo blurred by `sigma` (at least `FADE_BLUR`), with `heat`, into `out`. */
  function blurred(sigma: number, heat: number, out: Uint8ClampedArray) {
    // Shrink: each small pixel is the average of a `shrink` × `shrink` block.
    const shrink = Math.max(2, Math.floor(sigma / SHRUNK_BLUR));
    const sw = Math.ceil(width / shrink), sh = Math.ceil(height / shrink);
    const small = a.subarray(0, sw * sh * 4);
    small.fill(0);
    for (let y = 0, i = 0; y < height; y++) {
      const row = Math.floor(y / shrink) * sw * 4;
      for (let sx = 0, x = 0; sx < sw; sx++) {
        let r = 0, g = 0, b = 0, alpha = 0;
        for (const end = Math.min(x + shrink, width); x < end; x++, i += 4) {
          r += data[i]!;
          g += data[i + 1]!;
          b += data[i + 2]!;
          alpha += data[i + 3]!;
        }
        const s = row + sx * 4;
        small[s] = small[s]! + r;
        small[s + 1] = small[s + 1]! + g;
        small[s + 2] = small[s + 2]! + b;
        small[s + 3] = small[s + 3]! + alpha;
      }
    }
    for (let y = 0, s = 0; y < sh; y++) {
      const rows = Math.min(shrink, height - y * shrink);
      for (let x = 0; x < sw; x++, s += 4) {
        const n = 1 / (rows * Math.min(shrink, width - x * shrink));
        small[s] = small[s]! * n;
        small[s + 1] = small[s + 1]! * n;
        small[s + 2] = small[s + 2]! * n;
        small[s + 3] = small[s + 3]! * n;
      }
    }
    // Blur and colour the small copy, then stretch it back to full size.
    for (const r of boxRadii(sigma / shrink)) {
      if (r < 1) continue;
      blurRows(a, b, sw, sh, r);
      blurColumns(b, a, sums, sw, sh, r);
    }
    if (heat > 0) addHeat(small, heat);
    resample(small, sw, sh, out, { offset: 0, scale: 1 / shrink }, { offset: 0, scale: 1 / shrink });
  }

  return (progress, out) => {
    const sigma = lerp(startBlur, 0, progress ** THERMAL_BLUR_EASE);
    const heat = 1 - clamp((progress - THERMAL_HEAT_FULL_UNTIL) / (THERMAL_HEAT_GONE_BY - THERMAL_HEAT_FULL_UNTIL), 0, 1);
    if (sigma >= FADE_BLUR) {
      blurred(sigma, heat, out);
      return;
    }
    // The fade, and the heat map's colours, in one pass.
    if (!faded) {
      faded = new Uint8ClampedArray(data.length);
      blurred(FADE_BLUR, 0, faded);
    }
    const fade = Math.max(0, sigma) / FADE_BLUR; // 1: blurred by FADE_BLUR; 0: the photo
    const pixels = words(out);
    for (let i = 0, o = 0; i < data.length; i += 4, o++) {
      let r = data[i]! + (faded[i]! - data[i]!) * fade;
      let g = data[i + 1]! + (faded[i + 1]! - data[i + 1]!) * fade;
      let bl = data[i + 2]! + (faded[i + 2]! - data[i + 2]!) * fade;
      if (heat > 0) {
        const lum = Math.round(0.299 * r + 0.587 * g + 0.114 * bl) * 3;
        r += (THERMAL_PALETTE[lum]! - r) * heat;
        g += (THERMAL_PALETTE[lum + 1]! - g) * heat;
        bl += (THERMAL_PALETTE[lum + 2]! - bl) * heat;
      }
      pixels[o] = wordOf((r + 0.5) | 0, (g + 0.5) | 0, (bl + 0.5) | 0, data[i + 3]!);
    }
  };
};
