// Shared pieces of the reveal effects (#257): the pixel format, the options
// every effect takes, and small helpers. No DOM, so the same code runs in the
// browser (the round screen, #256) and in Node (the Beat the AI solver).

/**
 * RGBA pixels, 4 bytes per pixel, row by row from the top left. The browser's
 * `ImageData` has this shape, and so does sharp's `.ensureAlpha().raw()` output.
 */
export type Pixels = {
  readonly data: Uint8ClampedArray | Uint8Array;
  readonly width: number;
  readonly height: number;
};

/** What an effect needs to know about the puzzle besides its photo. */
export type EffectOptions = {
  /** The puzzle's `reveal.focus` (0–1 fractions of width and height). Zoom, spotlight and swirl centre on it. */
  readonly focus: { readonly x: number; readonly y: number };
  /**
   * Fixes the random parts, like the order the tiles open in. Pass the
   * puzzle's id, so every player and the AI solver see the same reveal.
   */
  readonly seed: string;
  /**
   * The size to draw frames at, if not the photo's. A bigger photo is shrunk
   * to it once (each pixel the average of the ones it covers), except that
   * zoom also keeps the whole photo to zoom into, so its first frames are a
   * sharp close-up. Frames cost the same whatever the photo's size.
   */
  readonly size?: { readonly width: number; readonly height: number };
};

/**
 * An effect set up for one photo: writes the frame at `progress`
 * (0 ≤ progress < 1) into `out`, which starts at a multiple of 4 bytes.
 */
export type DrawFrame = (progress: number, out: Uint8ClampedArray) => void;

/**
 * Sets an effect up for one photo, at the frame's size. Anything that only
 * depends on the photo is worked out here, once. `original` is the photo as
 * given, which may be bigger (only zoom uses it).
 */
export type EffectSetup = (source: Pixels, options: EffectOptions, original?: Pixels) => DrawFrame;

/**
 * The same bytes as one 32-bit word per pixel, so a pixel is copied, or a run
 * of pixels filled, in one step. `bytes` must start at a multiple of 4 bytes
 * (`createEffect` makes sure of that).
 */
export function words(bytes: Uint8ClampedArray | Uint8Array): Uint32Array {
  return new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.length >> 2);
}

/** True on little-endian machines (every phone and computer we'll see), where a word's lowest byte is red. */
export const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

/** A word from four bytes that are already whole numbers from 0 to 255: faster than `packPixel` in a loop. */
export function wordOf(r: number, g: number, b: number, a: number): number {
  return (LITTLE_ENDIAN ? (a << 24) | (b << 16) | (g << 8) | r : (r << 24) | (g << 16) | (b << 8) | a) >>> 0;
}

const packBytes = new Uint8ClampedArray(4);
const packWord = new Uint32Array(packBytes.buffer);

/** One pixel as a word (see `words`), in this machine's byte order. Values are rounded and clamped to 0–255. */
export function packPixel(r: number, g: number, b: number, a = 255): number {
  packBytes[0] = r;
  packBytes[1] = g;
  packBytes[2] = b;
  packBytes[3] = a;
  return packWord[0]!;
}

export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * A focus point inside the photo: 0–1, with anything that isn't a finite
 * number read as the middle (as `cropTransform` does for the old zoom levels).
 */
export function focusPoint(focus: EffectOptions["focus"]): { x: number; y: number } {
  const axis = (n: number) => (Number.isFinite(n) ? clamp(n, 0, 1) : 0.5);
  return { x: axis(focus.x), y: axis(focus.y) };
}

/** A whole number from a string (FNV-1a), the same in every browser and in Node. */
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A seeded random number generator (mulberry32): numbers from 0 up to 1, the same sequence for the same seed. */
export function seededRandom(seed: string): () => number {
  let a = hashSeed(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `0 … n-1` in a seeded random order (Fisher–Yates). */
export function shuffled(n: number, seed: string): number[] {
  const random = seededRandom(seed);
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
}
