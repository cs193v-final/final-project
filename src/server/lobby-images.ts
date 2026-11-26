// Photos uploaded for custom lobbies (#67). Server-only: runs `sharp` on
// untrusted bytes at request time.
//
// Two steps, because a request body on Vercel is at most 4.5 MB, so 3-5
// photos can't arrive in one request:
// 1. Upload (`POST /api/lobby-uploads`, one photo per request):
//    `reencodeUpload` checks the type from the file's own bytes (never the
//    name or Content-Type), refuses anything too big before decoding it,
//    turns it upright, scales it to at most `MAX_UPLOAD_SIDE`, and writes a
//    new WebP **with no metadata** (no EXIF, GPS, XMP, IPTC or ICC profile).
//    Only that re-encoded copy is ever stored, encrypted.
// 2. Create: `cutLobbyLevels` cuts the stored copy into one image per zoom
//    level with the same code as the seeded puzzles (`cutLevels`, #57).
//
// NOTE for AGENTS.md: src/images/ is "scripts only"; lobbies are the first
// app code that needs it at request time, so sharp moves to `dependencies`.
import "server-only";

import sharp from "sharp";

import { LOBBY_ZOOM_LEVELS } from "@/game/lobby";
import { cutLevels, MAX_INPUT_PIXELS, type LevelImage } from "@/images/cut";

/**
 * Biggest upload, in bytes: under Vercel's 4.5 MB request limit with room
 * to spare. A phone photo is usually 2-4 MB as JPEG; bigger ones are scaled
 * down on the phone first (#68's screen can do it in a canvas).
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/** Most pixels an upload may have, checked from its header before decoding: 50 MP, like seeded originals. */
export const MAX_UPLOAD_PIXELS = MAX_INPUT_PIXELS;

/**
 * Longest side of the stored copy. Bigger than a level (1200 px): the 14×
 * level shows 1/14 of the photo, so it needs pixels to spare to not be a blur.
 */
export const MAX_UPLOAD_SIDE = 2400;

/** Biggest stored copy, in bytes (the `lobby_uploads_bytes_max` CHECK allows this plus encryption). */
export const MAX_STORED_UPLOAD_BYTES = 3 * 1024 * 1024;

/** Widest a lobby level is cut to: the viewer is at most 448 CSS px, so this covers 2.5× screens, at less storage than the 1600 px of seeded puzzles. */
export const LOBBY_LEVEL_MAX_WIDTH = 1200;

/**
 * Formats sharp reports that we accept, from the file's own bytes. "heif" is
 * the container of both HEIC and AVIF; the sharp build we ship decodes only
 * AVIF from it (HEIC needs a patented HEVC decoder), so an HEIC photo fails
 * to decode and is refused as unsupported. iPhones convert HEIC to JPEG
 * when a web page asks for JPEG (`accept="image/jpeg,image/png,image/webp"`).
 */
const UPLOAD_FORMATS = new Set(["jpeg", "png", "webp", "heif"]);

export class UploadRefusedError extends Error {
  constructor(readonly reason: "too-large" | "unsupported-image") {
    super(`upload refused: ${reason}`);
    this.name = "UploadRefusedError";
  }
}

export type ReencodedUpload = { bytes: Uint8Array; width: number; height: number };

/**
 * The upload as a fresh WebP with no metadata, upright and at most
 * `MAX_UPLOAD_SIDE` on its longest side (never scaled up). Throws
 * `UploadRefusedError` for anything too big, not a photo format, animated,
 * or that doesn't decode. Never trusts the file name or the declared type.
 */
export async function reencodeUpload(input: Uint8Array): Promise<ReencodedUpload> {
  if (input.byteLength === 0) throw new UploadRefusedError("unsupported-image");
  if (input.byteLength > MAX_UPLOAD_BYTES) throw new UploadRefusedError("too-large");
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    meta = await sharp(input).metadata();
  } catch {
    throw new UploadRefusedError("unsupported-image");
  }
  if (meta.format === undefined || !UPLOAD_FORMATS.has(meta.format)) throw new UploadRefusedError("unsupported-image");
  // An animated WebP or PNG isn't a photo; only its first frame would be kept anyway.
  if ((meta.pages ?? 1) > 1) throw new UploadRefusedError("unsupported-image");
  if (meta.width === undefined || meta.height === undefined) throw new UploadRefusedError("unsupported-image");
  if (meta.width * meta.height > MAX_UPLOAD_PIXELS) throw new UploadRefusedError("too-large");
  try {
    // sharp keeps no metadata unless asked (no withMetadata / keepExif /
    // keepIccProfile here), so the output has no EXIF, GPS, XMP or IPTC.
    const { data, info } = await sharp(input, { limitInputPixels: MAX_UPLOAD_PIXELS, failOn: "error" })
      .autoOrient()
      .resize(MAX_UPLOAD_SIDE, MAX_UPLOAD_SIDE, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer({ resolveWithObject: true });
    if (data.byteLength > MAX_STORED_UPLOAD_BYTES) throw new UploadRefusedError("too-large");
    return { bytes: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height };
  } catch (error) {
    if (error instanceof UploadRefusedError) throw error;
    // e.g. an HEIC photo (no HEVC decoder), or a truncated file.
    throw new UploadRefusedError("unsupported-image");
  }
}

/** A stored upload cut into one WebP per lobby zoom level (`LOBBY_ZOOM_LEVELS`), tightest first. */
export function cutLobbyLevels(stored: Uint8Array, focus: { x: number; y: number }): Promise<LevelImage[]> {
  return cutLevels(stored, { focus, zoomLevels: [...LOBBY_ZOOM_LEVELS] }, { maxWidth: LOBBY_LEVEL_MAX_WIDTH, quality: 80 });
}
