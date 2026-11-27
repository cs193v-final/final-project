// Shards (#257): the photo seen through shattered glass. The frame is cracked
// into 40 shards; each shows its piece of the photo shifted, turned and
// tinted, with dark cracks between them, and the pieces slide back into place
// as the clock runs. Where the cracks run comes from the seed.

import { lerp, seededRandom, words, wordOf, type EffectSetup } from "./pixels.ts";

/** Shards across and down (a jittered grid of seeds, so they're all roughly the same size). */
export const SHARDS_ACROSS = 8;
export const SHARDS_DOWN = 5;
/** How far a shard's piece is shifted at the start, at most, as a fraction of the longer side. */
export const SHARDS_SHIFT = 0.32;
/** How far it's turned at the start, at most, in radians. */
export const SHARDS_TURN = 1.4;
/** How much lighter or darker a shard is at the start, at most (0–1). */
export const SHARDS_TINT = 0.35;
/** Above 1, the pieces slide most of the way early and settle slowly. */
export const SHARDS_EASE = 1.8;
/** The cracks fade out by this much of the reveal. */
export const SHARDS_CRACKS_GONE_BY = 0.85;

export const shards: EffectSetup = ({ data, width, height }, options) => {
  const random = seededRandom(`${options.seed}:shards`);
  const long = Math.max(width, height);
  const photo = words(data);
  // The shards' seeds, and how each one's piece is moved.
  const seeds: { x: number; y: number; dx: number; dy: number; turn: number; tint: number }[] = [];
  for (let gy = 0; gy < SHARDS_DOWN; gy++) {
    for (let gx = 0; gx < SHARDS_ACROSS; gx++) {
      const angle = random() * 2 * Math.PI, shift = (0.4 + 0.6 * random()) * SHARDS_SHIFT * long;
      seeds.push({
        x: ((gx + 0.15 + 0.7 * random()) / SHARDS_ACROSS) * width,
        y: ((gy + 0.15 + 0.7 * random()) / SHARDS_DOWN) * height,
        dx: Math.cos(angle) * shift,
        dy: Math.sin(angle) * shift,
        turn: (random() * 2 - 1) * SHARDS_TURN,
        tint: (random() * 2 - 1) * SHARDS_TINT,
      });
    }
  }
  // Which shard each pixel is in (the nearest seed), and whether it's on a crack.
  const n = width * height;
  const shard = new Uint8Array(n);
  for (let y = 0, i = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i++) {
      let best = 0, bestD = Infinity;
      for (let k = 0; k < seeds.length; k++) {
        const s = seeds[k]!, d = (x - s.x) ** 2 + (y - s.y) ** 2;
        if (d < bestD) { bestD = d; best = k; }
      }
      shard[i] = best;
    }
  }
  const crackWidth = Math.max(1, Math.round(long / 300));
  const crack = new Uint8Array(n);
  for (let y = 0, i = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i++) {
      for (let d = 1; d <= crackWidth && !crack[i]; d++) {
        if ((x + d < width && shard[i + d] !== shard[i]) || (y + d < height && shard[i + d * width] !== shard[i])) crack[i] = 1;
      }
    }
  }
  const cos = new Float32Array(seeds.length), sin = new Float32Array(seeds.length);
  const offX = new Float32Array(seeds.length), offY = new Float32Array(seeds.length), gain = new Float32Array(seeds.length);

  return (progress, out) => {
    const left = (1 - progress) ** SHARDS_EASE; // 1 at the start, 0 at the end
    const cracks = Math.max(0, 1 - progress / SHARDS_CRACKS_GONE_BY);
    seeds.forEach((s, k) => {
      cos[k] = Math.cos(s.turn * left);
      sin[k] = Math.sin(s.turn * left);
      offX[k] = s.dx * left;
      offY[k] = s.dy * left;
      gain[k] = 1 + s.tint * left;
    });
    const pixels = words(out);
    const bytes = new Uint8Array(4), word = new Uint32Array(bytes.buffer);
    for (let y = 0, i = 0; y < height; y++) {
      for (let x = 0; x < width; x++, i++) {
        const k = shard[i]!, s = seeds[k]!;
        // Turn around the shard's seed, then shift.
        const rx = x - s.x, ry = y - s.y;
        let sx = s.x + rx * cos[k]! - ry * sin[k]! + offX[k]!;
        let sy = s.y + rx * sin[k]! + ry * cos[k]! + offY[k]!;
        if (sx < 0) sx = -sx; else if (sx > width - 1) sx = 2 * (width - 1) - sx;
        if (sy < 0) sy = -sy; else if (sy > height - 1) sy = 2 * (height - 1) - sy;
        sx = sx < 0 ? 0 : sx > width - 1 ? width - 1 : (sx + 0.5) | 0;
        sy = sy < 0 ? 0 : sy > height - 1 ? height - 1 : (sy + 0.5) | 0;
        word[0] = photo[sy * width + sx]!;
        let g = gain[k]!;
        if (crack[i]) g = lerp(g, 0.15, cracks);
        const r = Math.min(255, bytes[0]! * g), gr = Math.min(255, bytes[1]! * g), b = Math.min(255, bytes[2]! * g);
        pixels[i] = wordOf(r | 0, gr | 0, b | 0, bytes[3]!);
      }
    }
  };
};
