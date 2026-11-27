// Thermal camera (#257): a blurry, false-colour heat map that sharpens and
// fades back to the real colours. For simple photos. The heat colours run up
// and down the palette several times across the photo's brightness range, and
// drift as the clock runs, so a dark subject on a bright background doesn't
// simply read as a dark silhouette.

import { clamp, lerp, wordOf, words, type EffectSetup } from "./pixels.ts";
import { resampler } from "./resample.ts";

/** The blur at the start (its standard deviation), as a fraction of the photo's longer side. */
export const THERMAL_START_BLUR = 60 / 600;
/** Above 1, the blur lingers and clears mostly near the end. */
export const THERMAL_BLUR_EASE = 1.3;
/** The heat-map colours are at full strength until this much of the reveal… */
export const THERMAL_HEAT_FULL_UNTIL = 0.5;
/** …and gone by this much. */
export const THERMAL_HEAT_GONE_BY = 0.92;
/** How many times the colours run up and back down the palette across the photo's brightness range. */
export const THERMAL_CYCLES = 2.5;
/** How far the colour bands drift over the whole reveal, in trips up and down the palette. */
export const THERMAL_DRIFT = 0.5;
/** The photo's brightness range is stretched so this fraction of pixels at each end is clipped. */
export const THERMAL_CLIP = 0.02;

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

/**
 * Brightness 0–1 (already stretched) → position on the palette, 0–255: a
 * triangle wave, so the bands meet smoothly instead of jumping from white to
 * black. `drift` shifts the bands; one whole number is one trip up and down.
 */
export function heatLevel(brightness: number, drift = 0): number {
  const t = brightness * THERMAL_CYCLES + drift;
  const phase = t - 2 * Math.floor(t / 2); // 0–2
  return Math.round(255 * (phase <= 1 ? phase : 2 - phase));
}

/** The darkest and brightest luminance (0–255) of `data`, ignoring `THERMAL_CLIP` of the pixels at each end. */
export function brightnessRange(data: Uint8Array | Uint8ClampedArray): [number, number] {
  const counts = new Uint32Array(256);
  for (let i = 0; i < data.length; i += 4) {
    counts[Math.round(0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!)]!++;
  }
  const clip = (data.length / 4) * THERMAL_CLIP;
  let lo = 0, hi = 255;
  for (let seen = 0; lo < 255 && (seen += counts[lo]!) <= clip; ) lo++;
  for (let seen = 0; hi > 0 && (seen += counts[hi]!) <= clip; ) hi--;
  return hi > lo ? [lo, hi] : [0, 255];
}

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

/**
 * The blur is worked out on a copy shrunk by a whole number, as long as the
 * shrunk blur stays at least this many pixels wide (or it's shrunk by 2);
 * stretching a blur that soft back up looks the same (the heat bands show
 * creases from a coarser copy), and costs a fraction of blurring every pixel.
 */
const SHRUNK_BLUR = 4;
/** The smallest blur (in pixels) worked out; below it, the frame fades from that blur to the sharp photo. */
const FADE_BLUR = 3;
/**
 * The blur is worked out only at fixed strengths, each this fraction of the
 * one before, and each frame blends the two nearest. Blurring at whatever
 * strength the clock asks for would jump visibly whenever a box blur's whole-
 * pixel radius steps, and the heat bands make every jump stand out.
 */
const BLUR_STEP = 0.9;

export const thermal: EffectSetup = ({ data, width, height }) => {
  const startBlur = THERMAL_START_BLUR * Math.max(width, height);
  const a = new Float32Array(width * height * 4);
  const b = new Float32Array(width * height * 4);
  const sums = new Float32Array(width * 4);
  const resample = resampler(width, height);
  // The fixed blur strengths, strongest first, down to FADE_BLUR; then no blur (the photo).
  const weakest = Math.min(FADE_BLUR, startBlur);
  const stepCount = Math.max(1, Math.ceil(Math.log(weakest / startBlur) / Math.log(BLUR_STEP)));
  const sigmas = [...Array.from({ length: stepCount + 1 }, (_, i) => startBlur * (weakest / startBlur) ** (i / stepCount)), 0];
  /** Fixed blurs worked out so far, by step: only the two a frame blends are kept. */
  const cache = new Map<number, Uint8ClampedArray>();
  /** The photo blurred at `sigmas[step]`; keeps `partner`'s, the other one this frame needs. */
  function blurredAt(step: number, partner: number): Uint8Array | Uint8ClampedArray {
    if (sigmas[step] === 0) return data;
    const hit = cache.get(step);
    if (hit) return hit;
    let frame: Uint8ClampedArray | undefined;
    const stale = cache.size >= 2 ? [...cache.keys()].find((k) => k !== partner) : undefined;
    if (stale !== undefined) {
      frame = cache.get(stale);
      cache.delete(stale);
    }
    frame ??= new Uint8ClampedArray(data.length);
    blurred(sigmas[step]!, frame);
    cache.set(step, frame);
    return frame;
  }
  const [lo, hi] = brightnessRange(data);
  /** Luminance 0–255 → offset of its heat colour in `THERMAL_PALETTE`, for this frame's drift. */
  const levels = new Uint16Array(256);
  const setLevels = (drift: number) => {
    for (let v = 0; v < 256; v++) levels[v] = heatLevel(clamp((v - lo) / (hi - lo), 0, 1), drift) * 3;
  };

  /** The photo blurred by `sigma` into `out`. */
  function blurred(sigma: number, out: Uint8ClampedArray) {
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
    // Blur the small copy, then stretch it back to full size.
    for (const r of boxRadii(sigma / shrink)) {
      if (r < 1) continue;
      blurRows(a, b, sw, sh, r);
      blurColumns(b, a, sums, sw, sh, r);
    }
    resample(small, sw, sh, out, { offset: 0, scale: 1 / shrink }, { offset: 0, scale: 1 / shrink });
  }

  return (progress, out) => {
    const sigma = lerp(startBlur, 0, progress ** THERMAL_BLUR_EASE);
    const heat = 1 - clamp((progress - THERMAL_HEAT_FULL_UNTIL) / (THERMAL_HEAT_GONE_BY - THERMAL_HEAT_FULL_UNTIL), 0, 1);
    if (heat > 0) setLevels(clamp(progress, 0, 1) * THERMAL_DRIFT * 2);
    // Blend the two nearest fixed blurs, and add the heat map's colours, in one pass.
    const clamped = clamp(sigma, 0, startBlur);
    let step = 0;
    while (step < sigmas.length - 2 && sigmas[step + 1]! >= clamped) step++;
    const near = blurredAt(step, step + 1), far = blurredAt(step + 1, step); // far is the less blurred one
    const toward = (sigmas[step]! - clamped) / (sigmas[step]! - sigmas[step + 1]!); // 0: near; 1: far
    const pixels = words(out);
    for (let i = 0, o = 0; i < data.length; i += 4, o++) {
      let r = near[i]! + (far[i]! - near[i]!) * toward;
      let g = near[i + 1]! + (far[i + 1]! - near[i + 1]!) * toward;
      let bl = near[i + 2]! + (far[i + 2]! - near[i + 2]!) * toward;
      if (heat > 0) {
        const lum = levels[Math.round(0.299 * r + 0.587 * g + 0.114 * bl)]!;
        r += (THERMAL_PALETTE[lum]! - r) * heat;
        g += (THERMAL_PALETTE[lum + 1]! - g) * heat;
        bl += (THERMAL_PALETTE[lum + 2]! - bl) * heat;
      }
      pixels[o] = wordOf((r + 0.5) | 0, (g + 0.5) | 0, (bl + 0.5) | 0, data[i + 3]!);
    }
  };
};
