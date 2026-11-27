// The reveal effects of the timed rounds (#257, redesign #254). Each one hides
// a puzzle's photo at the start of a round and clears it as the clock runs.
// They work on plain pixels, with no DOM, so one implementation serves:
//
// - the round screen (#256), which draws a frame on a canvas as the clock runs
//   (src/components/game/EffectCanvas.tsx):
//
//     const size = frameSize(photo.width, photo.height);
//     const draw = createEffect(puzzle.effect, photo, { focus: puzzle.reveal.focus, seed: puzzle.id, size });
//     const frame = ctx.createImageData(size.width, size.height);
//     draw(seconds / revealSeconds, frame.data);
//     ctx.putImageData(frame, 0, 0);
//
//   where `photo` is the whole clear photo's `getImageData`, bigger than the
//   frame, so zoom starts on a sharp close-up;
// - the Beat the AI solver, which renders the same frames in Node (sharp
//   decodes the photo) and asks CLIP at each step. Both start from the same
//   photo and draw at `frameSize`, so CLIP sees what players see.
//
// `progress` is the clock (seconds / the reveal time), not the score, so the
// effects and the scoring are tuned separately. At 0 the photo is hidden; at
// 1 or later it's the photo (at the frame's size), unchanged. Each effect
// eases progress its own way so it reads well over the whole reveal. The
// values come from the team's prototype (#254) and are exported from each
// effect's file for tuning.

import { kaleidoscope } from "./kaleidoscope.ts";
import { pixelate } from "./pixelate.ts";
import { resampler, shrinkTo } from "./resample.ts";
import { shards } from "./shards.ts";
import type { EffectOptions, EffectSetup, Pixels } from "./pixels.ts";
import { spotlight } from "./spotlight.ts";
import { swirl } from "./swirl.ts";
import { thermal } from "./thermal.ts";
import { tiles } from "./tiles.ts";
import { zoom } from "./zoom.ts";

export type { EffectOptions, Pixels } from "./pixels.ts";

/** Every effect, coarse ones (for simple photos) first. The names are `Puzzle.effect`'s values (#258). */
export const EFFECT_SETUPS = { pixelate, spotlight, thermal, swirl, zoom, tiles, kaleidoscope, shards } as const satisfies Record<string, EffectSetup>;

export type EffectName = keyof typeof EFFECT_SETUPS;

/** The effect a puzzle plays while it has none chosen (`Puzzle.effect` missing). */
export const DEFAULT_EFFECT: EffectName = "pixelate";

/**
 * The longer side, in pixels, of every frame. The effects were tuned at this
 * size in the team's prototype (#254), and the round screen and the AI solver
 * both draw at it, so CLIP's solve times are for the frames players see.
 */
export const FRAME_LONG_SIDE = 600;

/** The size to draw a photo's frames at: `FRAME_LONG_SIDE` on its longer side, the photo's shape. */
export function frameSize(width: number, height: number): { width: number; height: number } {
  const scale = FRAME_LONG_SIDE / Math.max(width, height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Draws one frame. Writes into `out` if given (e.g. an `ImageData`'s `data`,
 * so nothing is allocated per frame), else into a new array, and returns it.
 */
export type Effect = (progress: number, out?: Uint8ClampedArray) => Uint8ClampedArray;

/**
 * Sets `effect` up for one photo. Frames are `options.size`, or the photo's
 * size. The photo is copied, so changing `source` afterwards doesn't change
 * the frames. Throws a RangeError for pixels that don't match their size or a
 * size that isn't whole numbers, and the returned function throws one for a
 * progress that isn't a number or an `out` of the wrong length.
 */
export function createEffect(effect: EffectName, source: Pixels, options: EffectOptions): Effect {
  const { width, height } = source;
  const isSize = (w: number, h: number) => Number.isInteger(w) && Number.isInteger(h) && w >= 1 && h >= 1;
  if (!isSize(width, height)) {
    throw new RangeError(`createEffect: width and height must be whole numbers of at least 1, got ${width} × ${height}`);
  }
  if (source.data.length !== width * height * 4) {
    throw new RangeError(`createEffect: ${width} × ${height} RGBA pixels need ${width * height * 4} bytes, got ${source.data.length}`);
  }
  const frameWidth = options.size?.width ?? width, frameHeight = options.size?.height ?? height;
  if (!isSize(frameWidth, frameHeight)) {
    throw new RangeError(`createEffect: size must be whole numbers of at least 1, got ${frameWidth} × ${frameHeight}`);
  }

  // The photo at the frame's size: copied, shrunk (averaging) or stretched (blending).
  let data: Uint8ClampedArray;
  if (frameWidth === width && frameHeight === height) {
    data = new Uint8ClampedArray(source.data);
  } else if (frameWidth <= width && frameHeight <= height) {
    data = shrinkTo(source, frameWidth, frameHeight);
  } else {
    data = new Uint8ClampedArray(frameWidth * frameHeight * 4);
    resampler(frameWidth, frameHeight)(source.data, width, height, data, { offset: 0, scale: width / frameWidth }, { offset: 0, scale: height / frameHeight });
  }
  const photo = { width: frameWidth, height: frameHeight, data };
  const bigger = effect === "zoom" && data.length < source.data.length ? { width, height, data: new Uint8ClampedArray(source.data) } : undefined;
  const drawFrame = EFFECT_SETUPS[effect](photo, options, bigger);

  // The effects copy whole pixels as 32-bit words, which needs an array that
  // starts at a multiple of 4 bytes. One that doesn't gets a copy of the frame.
  let aligned: Uint8ClampedArray | undefined;
  return (progress, out = new Uint8ClampedArray(data.length)) => {
    if (Number.isNaN(progress)) throw new RangeError("effect: progress must be a number, got NaN");
    if (out.length !== data.length) {
      throw new RangeError(`effect: out must be ${data.length} bytes for ${frameWidth} × ${frameHeight}, got ${out.length}`);
    }
    const target = out.byteOffset % 4 === 0 ? out : (aligned ??= new Uint8ClampedArray(data.length));
    if (progress >= 1) target.set(data);
    else drawFrame(Math.max(0, progress), target);
    if (target !== out) out.set(target);
    return out;
  };
}
