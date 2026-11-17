import { describe, expect, it } from "vitest";
import { cropTransform, zoomAt } from "./crop.ts";
import { levelCrop, levelOutputSize, MAX_LEVEL_HEIGHT, MAX_LEVEL_WIDTH, planLevels } from "./levels.ts";
import type { Puzzle } from "./types.ts";

// Spec for #57's cut math: each level shows exactly the window the CSS crop
// used to show, in whole pixels inside the image, and is never upscaled.

const reveal = (x: number, y: number, zoomLevels = [10, 5, 2.5, 1]): Puzzle["reveal"] => ({
  focus: { x, y },
  zoomLevels,
});
const GIRAFFE = { width: 1920, height: 1280 }; // the practice photos' size

describe("levelCrop", () => {
  it("shows the whole image at the last level", () => {
    expect(levelCrop(GIRAFFE, reveal(0.4, 0.66), 3)).toEqual({ left: 0, top: 0, ...GIRAFFE });
  });

  it("shows 1/zoom of the image, centred on the focus point", () => {
    // 4× at the centre of 1920×1280: a 480×320 window starting at (720, 480).
    expect(levelCrop(GIRAFFE, reveal(0.5, 0.5, [4, 1]), 0)).toEqual({ left: 720, top: 480, width: 480, height: 320 });
  });

  it("slides the window inward at an edge instead of going past the image", () => {
    expect(levelCrop(GIRAFFE, reveal(0, 0, [4, 1]), 0)).toMatchObject({ left: 0, top: 0 });
    expect(levelCrop(GIRAFFE, reveal(1, 1, [4, 1]), 0)).toEqual({ left: 1440, top: 960, width: 480, height: 320 });
  });

  it("matches the window the browser's CSS crop showed (crop.ts), to the pixel", () => {
    const sizes = [GIRAFFE, { width: 1920, height: 1080 }, { width: 1001, height: 667 }, { width: 640, height: 4000 }];
    const focuses = [0, 0.07, 0.36, 0.5, 0.62, 0.93, 1];
    const zooms = [1, 1.5, 2.5, 4, 5, 10, 20];
    for (const size of sizes) {
      for (const x of focuses) {
        for (const zoom of zooms) {
          const r = reveal(x, 1 - x, [zoom, 1]);
          const crop = levelCrop(size, r, 0);
          const css = cropTransform(r.focus, zoomAt(r, 0));
          // The CSS crop shifts the image by -left/width of itself, as a percentage, before scaling.
          const cssLeft = (-css.translateX / 100 / css.scale) * size.width;
          const cssTop = (-css.translateY / 100 / css.scale) * size.height;
          expect(Math.abs(crop.left - cssLeft)).toBeLessThanOrEqual(1);
          expect(Math.abs(crop.top - cssTop)).toBeLessThanOrEqual(1);
          expect(Math.abs(crop.width - size.width / zoom)).toBeLessThanOrEqual(1);
          expect(Math.abs(crop.height - size.height / zoom)).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("always gives whole pixels inside the image, at least 1×1", () => {
    for (const size of [{ width: 7, height: 3 }, { width: 1, height: 1 }, GIRAFFE]) {
      for (const level of [0, 1, 2, 3]) {
        const c = levelCrop(size, reveal(0.99, 0.01, [1000, 50, 2.5, 1]), level);
        for (const n of [c.left, c.top, c.width, c.height]) expect(Number.isInteger(n)).toBe(true);
        expect(c.width).toBeGreaterThanOrEqual(1);
        expect(c.height).toBeGreaterThanOrEqual(1);
        expect(c.left + c.width).toBeLessThanOrEqual(size.width);
        expect(c.top + c.height).toBeLessThanOrEqual(size.height);
      }
    }
  });

  it("rejects a size that isn't whole pixels", () => {
    expect(() => levelCrop({ width: 0, height: 10 }, reveal(0.5, 0.5), 0)).toThrow(RangeError);
    expect(() => levelCrop({ width: 10.5, height: 10 }, reveal(0.5, 0.5), 0)).toThrow(RangeError);
  });
});

describe("levelOutputSize", () => {
  it("keeps a crop that fits as it is: never upscaled", () => {
    expect(levelOutputSize({ width: 192, height: 128 })).toEqual({ width: 192, height: 128 });
  });

  it("scales a wide crop down to the cap, keeping its shape", () => {
    expect(levelOutputSize({ width: 4000, height: 3000 })).toEqual({ width: MAX_LEVEL_WIDTH, height: 1200 });
    expect(levelOutputSize({ width: 1920, height: 1280 }, 960)).toEqual({ width: 960, height: 640 });
  });

  it("scales a tall crop down to the height cap too, so no level is too big to serve", () => {
    // A 1200 × 12000 original used to give a 9.3 MB level.
    expect(levelOutputSize({ width: 1200, height: 12000 })).toEqual({ width: 160, height: MAX_LEVEL_HEIGHT });
    expect(levelOutputSize({ width: 1600, height: 1601 })).toEqual({ width: 1599, height: MAX_LEVEL_HEIGHT });
  });

  it("uses whichever cap the crop is further over", () => {
    expect(levelOutputSize({ width: 6400, height: 3200 })).toEqual({ width: MAX_LEVEL_WIDTH, height: 800 });
    expect(levelOutputSize({ width: 3200, height: 6400 })).toEqual({ width: 800, height: MAX_LEVEL_HEIGHT });
  });
});

describe("planLevels", () => {
  it("plans one cut per zoom level, tightest first, ending with the whole image", () => {
    const plan = planLevels(GIRAFFE, reveal(0.4, 0.66));
    expect(plan.map((p) => p.level)).toEqual([0, 1, 2, 3]);
    expect(plan.map((p) => p.crop.width)).toEqual([192, 384, 768, 1920]);
    expect(plan.at(-1)).toEqual({ level: 3, crop: { left: 0, top: 0, ...GIRAFFE }, output: { width: 1600, height: 1067 } });
  });

  it("shows more of the image at each level than at the one before", () => {
    const plan = planLevels({ width: 4000, height: 3000 }, reveal(0.3, 0.7, [20, 8, 3, 1]));
    for (let i = 1; i < plan.length; i++) {
      expect(plan[i]!.crop.width).toBeGreaterThan(plan[i - 1]!.crop.width);
    }
  });
});
