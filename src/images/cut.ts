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

export type CutOptions = {
  /** Widest a level is cut to. Default MAX_LEVEL_WIDTH. */
  maxWidth?: number;
  /** WebP quality, 1-100. Default 82: no visible loss at these sizes. */
  quality?: number;
};

/**
 * The original's size as it's meant to be seen. Phone photos are often stored
 * sideways with an EXIF "rotate me" flag; orientations 5-8 swap width and height.
 */
async function uprightSize(original: Uint8Array): Promise<ImageSize> {
  const { width, height, orientation } = await sharp(original).metadata();
  if (width === undefined || height === undefined) throw new Error("cutLevels: can't read the image size");
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
  { maxWidth = MAX_LEVEL_WIDTH, quality = 82 }: CutOptions = {},
): Promise<LevelImage[]> {
  const size = await uprightSize(original);
  const plan = planLevels(size, reveal, maxWidth);
  return Promise.all(
    plan.map(async ({ level, crop, output }) => {
      // sharp keeps no metadata unless asked (no withMetadata/keepExif here).
      const { data, info } = await sharp(original)
        .autoOrient()
        .extract(crop)
        .resize(output.width, output.height, { fit: "fill" })
        .webp({ quality })
        .toBuffer({ resolveWithObject: true });
      return {
        level,
        width: info.width,
        height: info.height,
        contentType: LEVEL_CONTENT_TYPE,
        bytes: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      };
    }),
  );
}
