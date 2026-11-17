import sharp, { type Sharp } from "sharp";
import { describe, expect, it } from "vitest";

import { cutLevels, LEVEL_CONTENT_TYPE } from "./cut.ts";

// Spec for cutting a puzzle image into levels (#57): each level is the right
// part of the picture, upright, the right size, a WebP, and carries no
// metadata that could describe the photo or where it was taken.

const RED = { r: 220, g: 30, b: 30 };
const GREEN = { r: 30, g: 200, b: 30 };
const BLUE = { r: 30, g: 30, b: 220 };
const WHITE = { r: 245, g: 245, b: 245 };

/** A 400×300 photo in four solid quarters: red, green / blue, white. */
async function quarters(): Promise<Sharp> {
  const tile = (background: typeof RED) =>
    sharp({ create: { width: 200, height: 150, channels: 3, background } }).png().toBuffer();
  const [tl, tr, bl, br] = await Promise.all([tile(RED), tile(GREEN), tile(BLUE), tile(WHITE)]);
  return sharp({ create: { width: 400, height: 300, channels: 3, background: WHITE } }).composite([
    { input: tl, left: 0, top: 0 },
    { input: tr, left: 200, top: 0 },
    { input: bl, left: 0, top: 150 },
    { input: br, left: 200, top: 150 },
  ]);
}

/** The photo as a camera would save it: a JPEG with a description, an artist and a GPS block. */
async function cameraJpeg(orientation?: number): Promise<Uint8Array> {
  let image = (await quarters()).jpeg({ quality: 95 }).withExif({
    IFD0: { ImageDescription: "Giraffe at Ithala", Artist: "Someone" },
    IFD3: { GPSLatitudeRef: "S", GPSLongitudeRef: "E" },
  });
  if (orientation !== undefined) image = image.withMetadata({ orientation });
  return new Uint8Array(await image.toBuffer());
}

/** The average colour of an image. */
async function averageColour(bytes: Uint8Array) {
  const { channels } = await sharp(bytes).stats();
  const [r, g, b] = channels.map((c) => Math.round(c.mean));
  return { r: r!, g: g!, b: b! };
}

function near(actual: { r: number; g: number; b: number }, expected: { r: number; g: number; b: number }) {
  for (const k of ["r", "g", "b"] as const) expect(Math.abs(actual[k] - expected[k])).toBeLessThan(25);
}

const twoLevels = { focus: { x: 0.25, y: 0.25 }, zoomLevels: [2, 1] };

describe("cutLevels", () => {
  it("cuts one image per level: the focus area first, then the whole picture", async () => {
    const levels = await cutLevels(await cameraJpeg(), twoLevels);
    expect(levels.map((l) => [l.level, l.width, l.height])).toEqual([
      [0, 200, 150],
      [1, 400, 300],
    ]);
    near(await averageColour(levels[0]!.bytes), RED); // 2× on the top-left quarter
    const full = await sharp(levels[1]!.bytes).metadata();
    expect([full.width, full.height]).toEqual([400, 300]);
  });

  it("follows the focus point", async () => {
    const [bottomRight] = await cutLevels(await cameraJpeg(), { focus: { x: 0.75, y: 0.75 }, zoomLevels: [2, 1] });
    near(await averageColour(bottomRight!.bytes), WHITE);
    const [topRight] = await cutLevels(await cameraJpeg(), { focus: { x: 0.75, y: 0.25 }, zoomLevels: [2, 1] });
    near(await averageColour(topRight!.bytes), GREEN);
  });

  it("writes WebP files and says so", async () => {
    const levels = await cutLevels(await cameraJpeg(), twoLevels);
    for (const level of levels) {
      expect(level.contentType).toBe(LEVEL_CONTENT_TYPE);
      expect((await sharp(level.bytes).metadata()).format).toBe("webp");
    }
  });

  it("drops all metadata: no description, artist or GPS block survives", async () => {
    const original = await cameraJpeg();
    // The original really has it, so the test isn't passing by accident.
    expect((await sharp(original).metadata()).exif).toBeDefined();
    expect(Buffer.from(original).includes("Giraffe at Ithala")).toBe(true);

    for (const level of await cutLevels(original, twoLevels)) {
      const meta = await sharp(level.bytes).metadata();
      expect(meta.exif).toBeUndefined();
      expect(meta.xmp).toBeUndefined();
      expect(meta.iptc).toBeUndefined();
      expect(Buffer.from(level.bytes).includes("Giraffe")).toBe(false);
    }
  });

  it("turns a sideways phone photo upright before cutting", async () => {
    // Orientation 6: stored landscape, shown rotated 90° clockwise, so upright it's
    // 300×400 and the stored bottom-left (blue) quarter ends up top-left.
    const levels = await cutLevels(await cameraJpeg(6), twoLevels);
    expect(levels.map((l) => [l.width, l.height])).toEqual([
      [150, 200],
      [300, 400],
    ]);
    near(await averageColour(levels[0]!.bytes), BLUE);
  });

  it("scales a level down to maxWidth, never up", async () => {
    const levels = await cutLevels(await cameraJpeg(), twoLevels, { maxWidth: 100 });
    expect(levels.map((l) => [l.width, l.height])).toEqual([
      [100, 75],
      [100, 75],
    ]);
    const wide = await cutLevels(await cameraJpeg(), { focus: { x: 0.5, y: 0.5 }, zoomLevels: [8, 1] });
    expect([wide[0]!.width, wide[0]!.height]).toEqual([50, 38]); // 400/8 × 300/8, as is
  });
});
