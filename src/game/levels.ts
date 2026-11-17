// Per-level images (#57). Owner: Darian.
//
// The browser used to get the full image and crop it with CSS (crop.ts). Now
// each reveal level is cut ahead of time into its own image, so the browser
// only ever has the level the player has reached. This file is the math for
// those cuts: which pixels of the original each level shows, and how big the
// cut image is. Framework-free, so the cutting script and the tests share it.
//
// The window for a level is exactly the one the CSS crop showed (cropTransform
// in crop.ts): 1/zoom of the image wide and tall, centred on the focus point,
// slid inward near an edge. So a pre-cut level looks like the old crop.

import { zoomAt } from "./crop.ts";
import type { Puzzle, RevealLevel } from "./types.ts";

export type ImageSize = { width: number; height: number };

/** A rectangle of the original image, in whole pixels. */
export type PixelRect = { left: number; top: number; width: number; height: number };

export type LevelCut = {
  level: RevealLevel;
  /** The part of the original this level shows. */
  crop: PixelRect;
  /** The size of the cut image (`crop`, scaled down if it's wider than the cap). */
  output: ImageSize;
};

/**
 * Widest image any level is cut to. The viewer is at most 448 CSS px wide
 * (`max-w-md`), so this covers 3× screens with room to spare, while a full
 * 4000 px original never reaches the browser.
 */
export const MAX_LEVEL_WIDTH = 1600;

function checkSize({ width, height }: ImageSize): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError(`image size must be whole pixels of at least 1, got ${width}x${height}`);
  }
}

/** One axis of the crop window, in pixels: start and length within `size`. */
function axis(size: number, focus: number, zoom: number): [start: number, length: number] {
  const length = Math.max(1, Math.min(size, Math.round(size / zoom)));
  const half = 1 / (2 * zoom);
  const centre = Math.min(1 - half, Math.max(half, Number.isFinite(focus) ? focus : 0.5));
  // Round the start, then keep the window inside the image.
  const start = Math.min(size - length, Math.max(0, Math.round((centre - half) * size)));
  return [start, length];
}

/**
 * The pixels of the original that `level` shows. The last level (zoom 1) is
 * the whole image. Same window as the CSS crop in crop.ts, rounded to pixels.
 */
export function levelCrop(size: ImageSize, reveal: Puzzle["reveal"], level: RevealLevel): PixelRect {
  checkSize(size);
  const zoom = zoomAt(reveal, level);
  const [left, width] = axis(size.width, reveal.focus.x, zoom);
  const [top, height] = axis(size.height, reveal.focus.y, zoom);
  return { left, top, width, height };
}

/**
 * The size to cut `crop` to: as is, or scaled down to `maxWidth` keeping its
 * shape. Never scaled up: that would only make a bigger, equally blurry file.
 * (Sharper deep zoom needs a bigger original, #34.)
 */
export function levelOutputSize(crop: ImageSize, maxWidth = MAX_LEVEL_WIDTH): ImageSize {
  checkSize(crop);
  if (!Number.isInteger(maxWidth) || maxWidth < 1) throw new RangeError(`maxWidth must be a whole number of at least 1`);
  if (crop.width <= maxWidth) return { width: crop.width, height: crop.height };
  return { width: maxWidth, height: Math.max(1, Math.round((crop.height * maxWidth) / crop.width)) };
}

/** Every level's cut, in order: level 0 (tightest) to the full image. */
export function planLevels(size: ImageSize, reveal: Puzzle["reveal"], maxWidth = MAX_LEVEL_WIDTH): LevelCut[] {
  return reveal.zoomLevels.map((_, level) => {
    const crop = levelCrop(size, reveal, level);
    return { level, crop, output: levelOutputSize(crop, maxWidth) };
  });
}
