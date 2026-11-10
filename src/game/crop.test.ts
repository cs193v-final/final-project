import { describe, expect, it } from "vitest";
import { clampRevealLevel, cropTransform, cropTransformCss, zoomAt } from "./crop.ts";

const reveal = { focus: { x: 0.5, y: 0.5 }, zoomLevels: [8, 4, 2, 1] };

/** Which part of the image (0–1 fractions) ends up visible in the frame. */
function visibleWindow(t: { scale: number; translateX: number; translateY: number }) {
  // A point p of the image lands at scale * p + translate / 100 in the frame,
  // so the frame's 0…1 shows the image from -translate / (100 * scale), 1/scale wide.
  const left = -t.translateX / (100 * t.scale);
  const top = -t.translateY / (100 * t.scale);
  return { left, top, right: left + 1 / t.scale, bottom: top + 1 / t.scale };
}

describe("cropTransform", () => {
  it("leaves the image alone at zoom 1", () => {
    expect(cropTransform({ x: 0.2, y: 0.9 }, 1)).toEqual({ scale: 1, translateX: 0, translateY: 0 });
  });

  it("centres the crop on the focus point", () => {
    const t = cropTransform({ x: 0.5, y: 0.5 }, 8);
    expect(t).toEqual({ scale: 8, translateX: -350, translateY: -350 });
    const w = visibleWindow(t);
    expect((w.left + w.right) / 2).toBeCloseTo(0.5);
    expect(w.right - w.left).toBeCloseTo(1 / 8);
  });

  it("centres an off-centre focus when there's room", () => {
    const w = visibleWindow(cropTransform({ x: 0.7, y: 0.3 }, 4));
    expect((w.left + w.right) / 2).toBeCloseTo(0.7);
    expect((w.top + w.bottom) / 2).toBeCloseTo(0.3);
  });

  it("slides the window inward near an edge instead of showing past the image", () => {
    for (const focus of [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 0.02, y: 0.97 },
    ]) {
      for (const zoom of [8, 4, 2, 1.5]) {
        const w = visibleWindow(cropTransform(focus, zoom));
        expect(w.left).toBeGreaterThanOrEqual(-1e-9);
        expect(w.top).toBeGreaterThanOrEqual(-1e-9);
        expect(w.right).toBeLessThanOrEqual(1 + 1e-9);
        expect(w.bottom).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
    expect(cropTransform({ x: 1, y: 0 }, 4)).toEqual({ scale: 4, translateX: -300, translateY: 0 });
  });

  it("treats a zoom below 1 or a bad number as the full image", () => {
    for (const zoom of [0.5, 0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(cropTransform({ x: 0.3, y: 0.3 }, zoom)).toEqual({ scale: 1, translateX: 0, translateY: 0 });
    }
  });

  it("treats an out-of-range or bad focus as clamped or centred", () => {
    expect(cropTransform({ x: 2, y: -1 }, 4)).toEqual(cropTransform({ x: 1, y: 0 }, 4));
    expect(cropTransform({ x: Number.NaN, y: Number.NaN }, 4)).toEqual(cropTransform({ x: 0.5, y: 0.5 }, 4));
  });
});

describe("reveal levels", () => {
  it("level 0 is the tightest crop and the last level is the full image", () => {
    expect(zoomAt(reveal, 0)).toBe(8);
    expect(zoomAt(reveal, 3)).toBe(1);
  });

  it("clamps and rounds levels into range", () => {
    expect(clampRevealLevel(reveal, -1)).toBe(0);
    expect(clampRevealLevel(reveal, 9)).toBe(3);
    expect(clampRevealLevel(reveal, 1.6)).toBe(2);
    expect(clampRevealLevel(reveal, Number.NaN)).toBe(0);
    expect(clampRevealLevel({ ...reveal, zoomLevels: [] }, 2)).toBe(0);
  });

  it("shows the full image when a puzzle has no usable zoom", () => {
    expect(zoomAt({ ...reveal, zoomLevels: [] }, 0)).toBe(1);
    expect(zoomAt({ ...reveal, zoomLevels: [0.5] }, 0)).toBe(1);
  });

  it("builds the CSS transform for a level", () => {
    expect(cropTransformCss(reveal, 0)).toBe("translate(-350%, -350%) scale(8)");
    expect(cropTransformCss(reveal, 3)).toBe("translate(0%, 0%) scale(1)");
  });
});
