// Cuts a puzzle's original image into one image per reveal level (#57).
// Owner: Darian. Script-only: uses `sharp`, so never import it from app code
// (the app only serves images that are already cut, see src/db/images.ts).
//
// Which pixels each level shows comes from planLevels (src/game/levels.ts),
// the same window the browser's CSS crop used to show.

import sharp from "sharp";

import { MAX_LEVEL_WIDTH, planLevels, type ImageSize } from "../game/levels.ts";
import type { Puzzle, RevealLevel } from "../game/types.ts";

export const LEVEL_CONTENT_TYPE = "image/webp";

export type LevelImage = {
  level: RevealLevel;
  width: number;
  height: number;
  contentType: typeof LEVEL_CONTENT_TYPE;
  bytes: Uint8Array;
};

/** Photo formats an original may be. Not SVG, GIF, TIFF or raw: puzzles are photos (security audit L9, #95). */
const PHOTO_FORMATS = new Set(["jpeg", "png", "webp", "heif"]);

/** Biggest original, in pixels: 50 megapixels is above any phone or camera photo we'd use. */
export const MAX_INPUT_PIXELS = 50_000_000;

export type CutOptions = {
  /** Widest a level is cut to. Default MAX_LEVEL_WIDTH. */
  maxWidth?: number;
  /** WebP quality, 1-100. Default 82: no visible loss at these sizes. */
  quality?: number;
  /** Biggest original accepted, in pixels. Default MAX_INPUT_PIXELS. */
  maxInputPixels?: number;
};

/**
 * The original's size as it's meant to be seen. Phone photos are often stored
 * sideways with an EXIF "rotate me" flag; orientations 5-8 swap width and height.
 * Refuses anything that isn't a photo format, and anything over `maxInputPixels`,
 * before decoding it.
 */
async function uprightSize(original: Uint8Array, maxInputPixels: number): Promise<ImageSize> {
  const { format, width, height, orientation } = await sharp(original).metadata();
  if (format === undefined || !PHOTO_FORMATS.has(format)) {
    throw new Error(`cutLevels: ${format ?? "this file"} isn't a photo format (use JPEG, PNG, WebP or HEIF)`);
  }
  if (width === undefined || height === undefined) throw new Error("cutLevels: can't read the image size");
  if (width * height > maxInputPixels) {
    throw new Error(`cutLevels: ${width}x${height} is over the ${maxInputPixels}-pixel limit; scale the original down first`);
  }
  return orientation !== undefined && orientation >= 5 ? { width: height, height: width } : { width, height };
}

/**
 * One WebP per reveal level, tightest first. Each is turned upright first,
 * then cropped and scaled down (never up). All metadata is dropped: EXIF, GPS
 * location, camera and editing details, so nothing in the file describes the
 * photo or where it was taken.
 */
export async function cutLevels(
  original: Uint8Array,
  reveal: Puzzle["reveal"],
  { maxWidth = MAX_LEVEL_WIDTH, quality = 82, maxInputPixels = MAX_INPUT_PIXELS }: CutOptions = {},
): Promise<LevelImage[]> {
  const size = await uprightSize(original, maxInputPixels);
  const plan = planLevels(size, reveal, maxWidth);
  // One level at a time: each decodes the whole original, so cutting them all
  // at once would hold several full-size copies in memory.
  const levels: LevelImage[] = [];
  for (const { level, crop, output } of plan) {
    // sharp keeps no metadata unless asked (no withMetadata/keepExif here).
    const { data, info } = await sharp(original, { limitInputPixels: maxInputPixels })
      .autoOrient()
      .extract(crop)
      .resize(output.width, output.height, { fit: "fill" })
      .webp({ quality })
      .toBuffer({ resolveWithObject: true });
    levels.push({
      level,
      width: info.width,
      height: info.height,
      contentType: LEVEL_CONTENT_TYPE,
      bytes: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    });
  }
  return levels;
}
