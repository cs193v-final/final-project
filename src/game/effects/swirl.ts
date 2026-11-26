// Swirl (#257): a Photo Booth twirl around the focus point, about four turns
// at the centre with a wobbly smudge on top, both unwinding as the photo
// clears. The heaviest effect, so the per-pixel work avoids trigonometry: the
// turn depends only on the distance from the centre, and the smudge's waves
// only on the row or column, so both are looked up instead.

import { focusPoint, words, type EffectSetup } from "./pixels.ts";

/** The turn at the very centre at the start, in radians: about four full turns. */
export const SWIRL_SPIN = 26;
/** The smudge at the start, as a fraction of the photo's longer side. */
export const SWIRL_WOBBLE = 18 / 600;
/** The smudge's waves, in radians per longer side, down the rows and across the columns. */
export const SWIRL_WAVE_DOWN = 0.045 * 600;
export const SWIRL_WAVE_ACROSS = 0.04 * 600;
/** Above 1, the twirl unwinds fastest at the start and settles gently at the end. */
export const SWIRL_EASE = 1.3;
/** The twirl reaches a little past the photo's farthest corner from the centre, so nothing is left unturned. */
const REACH = 1.05;
/** Distances are looked up in steps of this many pixels. */
const STEP = 0.5;

export const swirl: EffectSetup = ({ data, width, height }, options) => {
  const focus = focusPoint(options.focus);
  const long = Math.max(width, height);
  const cx = focus.x * width, cy = focus.y * height;
  const farX = Math.max(cx, width - cx), farY = Math.max(cy, height - cy);
  const reach = Math.sqrt(farX * farX + farY * farY) * REACH;
  const photo = words(data);

  // Per pixel: its distance from the centre, that distance as a lookup index,
  // and the direction to it.
  const n = width * height;
  const dist = new Float32Array(n), ring = new Uint32Array(n);
  const cos = new Float32Array(n), sin = new Float32Array(n);
  for (let y = 0, i = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i++) {
      const dx = x - cx, dy = y - cy, r = Math.sqrt(dx * dx + dy * dy);
      dist[i] = r;
      ring[i] = Math.round(r / STEP);
      cos[i] = r > 0 ? dx / r : 1;
      sin[i] = r > 0 ? dy / r : 0;
    }
  }
  const rings = Math.ceil(reach / STEP) + 2;
  // Per row and column: the smudge's waves.
  const wave = (count: number, perLongSide: number, f: (a: number) => number) =>
    Float32Array.from({ length: count }, (_, i) => f((i * perLongSide) / long));
  const sinDown = wave(height, SWIRL_WAVE_DOWN, Math.sin), cosDown = wave(height, SWIRL_WAVE_DOWN, Math.cos);
  const sinAcross = wave(width, SWIRL_WAVE_ACROSS, Math.sin), cosAcross = wave(width, SWIRL_WAVE_ACROSS, Math.cos);
  // Per ring and frame: the turn's cosine and sine.
  const turnCos = new Float32Array(rings), turnSin = new Float32Array(rings);

  return (progress, out) => {
    const unwound = (1 - progress) ** SWIRL_EASE;
    const spin = SWIRL_SPIN * unwound;
    const wobble = SWIRL_WOBBLE * long * unwound;
    for (let k = 0; k < rings; k++) {
      const f = Math.max(0, 1 - (k * STEP) / reach); // 1 at the centre, 0 at the twirl's edge
      const turn = spin * f * f;
      turnCos[k] = Math.cos(turn);
      turnSin[k] = Math.sin(turn);
    }
    const pixels = words(out);
    for (let y = 0, i = 0; y < height; y++) {
      const sy0 = sinDown[y]!, cy0 = cosDown[y]!;
      for (let x = 0; x < width; x++, i++) {
        const k = ring[i]!, tc = turnCos[k]!, ts = turnSin[k]!;
        // The direction to the pixel, turned: angle a = its own angle + the ring's turn.
        const ca = cos[i]! * tc - sin[i]! * ts;
        const sa = sin[i]! * tc + cos[i]! * ts;
        const r = dist[i]!;
        // The smudge: sin(wave down + 2a) and cos(wave across − 2a), from double-angle identities.
        const c2 = ca * ca - sa * sa, s2 = 2 * sa * ca;
        let sx = cx + r * ca + wobble * (sy0 * c2 + cy0 * s2);
        let sy = cy + r * sa + wobble * (cosAcross[x]! * c2 + sinAcross[x]! * s2);
        sx = sx < 0 ? 0 : sx > width - 1 ? width - 1 : (sx + 0.5) | 0;
        sy = sy < 0 ? 0 : sy > height - 1 ? height - 1 : (sy + 0.5) | 0;
        pixels[i] = photo[sy * width + sx]!;
      }
    }
  };
};
