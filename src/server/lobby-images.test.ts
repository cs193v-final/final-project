// Spec for lobby photo uploads (#67): only photo formats, size limits, and
// every upload re-encoded with no metadata, especially no GPS location.
import { readFileSync } from "node:fs";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

describe("uploaded images and answers are never committed", () => {
  // They go only to the database (encrypted). No lobby code can write a file,
  // so nothing a player uploads or types can end up in the working tree.
  it("no lobby module imports the file system", () => {
    for (const file of ["src/server/lobbies.ts", "src/server/lobby-images.ts", "src/db/lobbies.ts", "src/game/lobby.ts", "src/app/lobby/actions.ts", "src/app/api/lobby-uploads/route.ts"]) {
      const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
      expect(source, file).not.toMatch(/from\s+["'](node:)?fs(\/promises)?["']|require\(["'](node:)?fs/u);
    }
  });
});

import { LOBBY_ZOOM_LEVELS } from "@/game/lobby";

import {
  cutLobbyLevels,
  LOBBY_LEVEL_MAX_WIDTH,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_SIDE,
  reencodeUpload,
  UploadRefusedError,
} from "./lobby-images";

const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 30, g: 120, b: 200 } } });

/** A phone photo: JPEG with a description, camera details and a GPS position (Hoover Tower). */
async function phoneJpeg(width = 800, height = 600, orientation?: number): Promise<Uint8Array> {
  let image = solid(width, height)
    .jpeg({ quality: 90 })
    .withExif({
      IFD0: { ImageDescription: "Secret answer: Hoover Tower", Make: "PhoneCo", Model: "Pocket 9" },
      IFD3: {
        GPSLatitudeRef: "N",
        GPSLatitude: "37/1 25/1 39/1",
        GPSLongitudeRef: "W",
        GPSLongitude: "122/1 10/1 0/1",
      },
    });
  if (orientation !== undefined) image = image.withMetadata({ orientation });
  return new Uint8Array(await image.toBuffer());
}

async function refusal(input: Uint8Array): Promise<string> {
  try {
    await reencodeUpload(input);
  } catch (error) {
    if (error instanceof UploadRefusedError) return error.reason;
    throw error;
  }
  return "accepted";
}

describe("reencodeUpload", () => {
  it("strips all metadata, GPS location included", async () => {
    const original = await phoneJpeg();
    // The original really has it, so the test isn't passing by accident.
    const before = await sharp(original).metadata();
    expect(before.exif).toBeDefined();
    expect(Buffer.from(original).includes("Hoover Tower")).toBe(true);
    // ...including the GPS block: the same photo without it has a smaller EXIF.
    const noGps = await sharp(await solid(800, 600).jpeg().withExif({ IFD0: { ImageDescription: "Secret answer: Hoover Tower", Make: "PhoneCo", Model: "Pocket 9" } }).toBuffer()).metadata();
    expect(before.exif!.length).toBeGreaterThan(noGps.exif!.length);

    const { bytes } = await reencodeUpload(original);
    const after = await sharp(bytes).metadata();
    expect(after.format).toBe("webp");
    expect(after.exif).toBeUndefined();
    expect(after.xmp).toBeUndefined();
    expect(after.iptc).toBeUndefined();
    expect(after.icc).toBeUndefined();
    for (const text of ["Hoover", "PhoneCo", "Pocket", "Exif", "GPS"]) expect(Buffer.from(bytes).includes(text)).toBe(false);
  });

  it("and so do the levels cut from it", async () => {
    const { bytes } = await reencodeUpload(await phoneJpeg());
    const levels = await cutLobbyLevels(bytes, { x: 0.3, y: 0.6 });
    expect(levels.map((l) => l.level)).toEqual(LOBBY_ZOOM_LEVELS.map((_, i) => i));
    for (const level of levels) {
      const meta = await sharp(level.bytes).metadata();
      expect(meta.exif).toBeUndefined();
      expect(meta.width).toBeLessThanOrEqual(LOBBY_LEVEL_MAX_WIDTH);
    }
  });

  it("turns a sideways phone photo upright before dropping its orientation flag", async () => {
    const { width, height, bytes } = await reencodeUpload(await phoneJpeg(800, 600, 6));
    expect({ width, height }).toEqual({ width: 600, height: 800 });
    expect((await sharp(bytes).metadata()).orientation).toBeUndefined();
  });

  it(`scales big photos down to ${MAX_UPLOAD_SIDE} px on the longest side, and never scales up`, async () => {
    const big = new Uint8Array(await solid(4000, 3000).jpeg().toBuffer());
    expect(await reencodeUpload(big)).toMatchObject({ width: MAX_UPLOAD_SIDE, height: 1800 });
    const small = new Uint8Array(await solid(300, 200).png().toBuffer());
    expect(await reencodeUpload(small)).toMatchObject({ width: 300, height: 200 });
  });

  it("accepts JPEG, PNG, WebP and AVIF, whatever the file is called", async () => {
    for (const image of [solid(64, 48).jpeg(), solid(64, 48).png(), solid(64, 48).webp(), solid(64, 48).avif()]) {
      expect(await refusal(new Uint8Array(await image.toBuffer()))).toBe("accepted");
    }
  });

  it("refuses other formats, going by the bytes and not the declared type", async () => {
    const gif = new Uint8Array(await solid(64, 48).gif().toBuffer());
    const tiff = new Uint8Array(await solid(64, 48).tiff().toBuffer());
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
    const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    for (const input of [gif, tiff, svg, html, new Uint8Array(0)]) expect(await refusal(input)).toBe("unsupported-image");
  });

  it("refuses a file cut off partway", async () => {
    const jpeg = new Uint8Array(await solid(400, 300).jpeg().toBuffer());
    expect(await refusal(jpeg.subarray(0, Math.floor(jpeg.length / 3)))).toBe("unsupported-image");
  });

  it("refuses an animated image", async () => {
    const frame = (background: string) =>
      sharp({ create: { width: 32, height: 32, channels: 3, background } })
        .png()
        .toBuffer();
    const animated = new Uint8Array(
      await sharp([await frame("red"), await frame("blue")], { join: { animated: true } })
        .webp({ loop: 0 })
        .toBuffer(),
    );
    expect((await sharp(animated).metadata()).pages).toBe(2);
    expect(await refusal(animated)).toBe("unsupported-image");
  });

  it(`refuses anything over ${MAX_UPLOAD_BYTES} bytes before decoding it, and too many pixels from the header`, async () => {
    expect(await refusal(new Uint8Array(MAX_UPLOAD_BYTES + 1))).toBe("too-large");
    // A tiny PNG that says it's 8000 × 8000 (64 MP): refused from its header.
    const huge = new Uint8Array(await sharp({ create: { width: 8000, height: 8000, channels: 3, background: "black" } }).png({ compressionLevel: 9 }).toBuffer());
    expect(huge.byteLength).toBeLessThan(MAX_UPLOAD_BYTES);
    expect(await refusal(huge)).toBe("too-large");
  });
});
