// Spec for the reveal effects of the timed rounds (#257). Pure: plain pixels in, pixels out.
import { describe, expect, it } from "vitest";

import { createEffect, EFFECT_SETUPS, type EffectName, type Pixels } from "./index.ts";
import { KALEIDOSCOPE_OPEN_BY, KALEIDOSCOPE_WEDGES } from "./kaleidoscope.ts";
import { pixelateBlock } from "./pixelate.ts";
import { seededRandom, shuffled } from "./pixels.ts";
import { SHARDS_CRACKS_GONE_BY } from "./shards.ts";
import { SPOTLIGHT_DRIFT_SPEED } from "./spotlight.ts";
import { SWIRL_WOBBLE } from "./swirl.ts";
import { THERMAL_PALETTE } from "./thermal.ts";
import { ZOOM_EASE, ZOOM_START } from "./zoom.ts";
import { openTiles, TILES_ACROSS, TILES_DOWN, tileGrid, tileOrder } from "./tiles.ts";

const EFFECTS = Object.keys(EFFECT_SETUPS) as EffectName[];
const options = { focus: { x: 0.7, y: 0.3 }, seed: "pz-test" };

/**
 * A made-up photo: waves at odd angles (so nothing lines up with a grid of
 * blocks or tiles) and a red disc, with detail at several sizes.
 */
function photo(width = 160, height = 120): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  const long = Math.max(width, height);
  for (let y = 0, i = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i += 4) {
      const u = (x / long) * 100, v = (y / long) * 100;
      const disc = Math.hypot(x - width * 0.3, y - height * 0.6) < height / 4;
      data[i] = disc ? 230 : 128 + 90 * Math.sin(0.61 * u + 0.23 * v) + 30 * Math.sin(0.17 * u - 0.41 * v);
      data[i + 1] = disc ? 40 : 128 + 100 * Math.sin(0.29 * u - 0.53 * v + 1);
      data[i + 2] = disc ? 60 : 128 + 80 * Math.sin(0.47 * u + 0.37 * v + 2) + 40 * Math.sin(0.11 * v);
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

/** A photo of one colour, with `paint` choosing another colour for some pixels. */
function solid(width: number, height: number, rgb: number[], paint?: (x: number, y: number) => number[] | undefined): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0, i = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i += 4) data.set([...(paint?.(x, y) ?? rgb), 255], i);
  }
  return { data, width, height };
}

/** How different two frames look: the mean difference per colour channel, 0 (same) to 1 (black and white). */
function difference(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 4) {
    sum += Math.abs(a[i]! - b[i]!) + Math.abs(a[i + 1]! - b[i + 1]!) + Math.abs(a[i + 2]! - b[i + 2]!);
  }
  return sum / ((a.length / 4) * 3 * 255);
}

/**
 * How many bytes two frames differ in (0 = the same). Comparing frames with
 * `toEqual` would print a diff of every byte when a test fails, which takes minutes.
 */
function changedBytes(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) return Math.max(a.length, b.length);
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

const pixel = (frame: Uint8ClampedArray, width: number, x: number, y: number) => [...frame.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)];

describe.each(EFFECTS)("%s", (effect) => {
  const source = photo();
  const draw = createEffect(effect, source, options);

  it("hides the photo at the start of the round", () => {
    // Two unrelated photos differ by about 0.3; the photo and a copy by 0.
    expect(difference(draw(0), source.data)).toBeGreaterThan(0.15);
  });

  it("is the photo, unchanged, once the reveal time is up", () => {
    for (const progress of [1, 1.2, Infinity]) expect(changedBytes(draw(progress), source.data)).toBe(0);
  });

  it("only gets clearer as the clock runs, never noticeably less clear", () => {
    let previous = difference(draw(0), source.data);
    for (let tenth = 1; tenth <= 10; tenth++) {
      const now = difference(draw(tenth / 10), source.data);
      expect(now, `at ${tenth / 10}`).toBeLessThanOrEqual(previous + 0.02);
      previous = now;
    }
    expect(previous).toBe(0);
  });

  it("treats a clock before the start as the start", () => {
    expect(changedBytes(draw(-0.5), draw(0))).toBe(0);
  });

  it("draws the same frames every time for the same photo, focus and seed", () => {
    const again = createEffect(effect, photo(), options);
    for (const progress of [0, 0.37, 0.8]) expect(changedBytes(again(progress), draw(progress))).toBe(0);
  });

  it("leaves the photo alone, and keeps its own copy of it", () => {
    const mine = photo();
    const before = new Uint8ClampedArray(mine.data);
    const drawMine = createEffect(effect, mine, options);
    const first = drawMine(0.4);
    expect(changedBytes(mine.data, before)).toBe(0);
    mine.data.fill(0);
    expect(changedBytes(drawMine(0.4), first)).toBe(0);
  });

  it("draws into the array it's given, so a frame needs no new memory", () => {
    const out = new Uint8ClampedArray(source.data.length);
    expect(draw(0.5, out)).toBe(out);
    expect(changedBytes(out, draw(0.5))).toBe(0);
    expect(() => draw(0.5, new Uint8ClampedArray(8))).toThrow(RangeError);
    // Even one that doesn't start at a multiple of 4 bytes in its buffer.
    const offset = new Uint8ClampedArray(source.data.length + 1).subarray(1);
    expect(changedBytes(draw(0.5, offset), draw(0.5))).toBe(0);
  });

  it("works on any size and shape of photo, and any focus", () => {
    for (const [width, height] of [[1, 1], [2, 3], [7, 1], [90, 160]] as const) {
      for (const focus of [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0.5, y: 0.5 }, { x: -3, y: Number.NaN }]) {
        const small = photo(width, height);
        const drawSmall = createEffect(effect, small, { focus, seed: "pz-small" });
        for (const progress of [0, 0.5, 0.99]) {
          const frame = drawSmall(progress);
          expect(frame).toHaveLength(width * height * 4);
          expect(frame.filter((value, i) => i % 4 === 3 && value !== 255)).toHaveLength(0); // still opaque
        }
        expect(changedBytes(drawSmall(1), small.data)).toBe(0);
      }
    }
  });
});

describe("createEffect", () => {
  it("refuses pixels that don't match their size", () => {
    const pixels = (width: number, height: number, bytes: number) => ({ data: new Uint8ClampedArray(bytes), width, height });
    expect(() => createEffect("zoom", pixels(2, 2, 15), options)).toThrow(RangeError);
    expect(() => createEffect("zoom", pixels(0, 2, 0), options)).toThrow(RangeError);
    expect(() => createEffect("zoom", pixels(1.5, 2, 12), options)).toThrow(RangeError);
  });

  it("refuses a clock that isn't a number", () => {
    expect(() => createEffect("tiles", photo(), options)(Number.NaN)).toThrow(RangeError);
  });

  it("takes sharp's raw output (a Uint8Array) as well as a canvas's ImageData", () => {
    const { data, width, height } = photo();
    const fromSharp = createEffect("swirl", { data: new Uint8Array(data), width, height }, options);
    expect(changedBytes(fromSharp(0.3), createEffect("swirl", photo(), options)(0.3))).toBe(0);
  });
});

describe("drawing at a size other than the photo's", () => {
  const big = photo(320, 240);
  const size = { width: 160, height: 120 };

  it("shrinks a bigger photo to the frame, each pixel the average of the ones it covers", () => {
    const draw = createEffect("tiles", big, { ...options, size });
    const frame = draw(1);
    expect(frame).toHaveLength(160 * 120 * 4);
    for (const [x, y] of [[0, 0], [37, 81], [159, 119]] as const) {
      const block = [pixel(big.data as Uint8ClampedArray, 320, 2 * x, 2 * y), pixel(big.data as Uint8ClampedArray, 320, 2 * x + 1, 2 * y), pixel(big.data as Uint8ClampedArray, 320, 2 * x, 2 * y + 1), pixel(big.data as Uint8ClampedArray, 320, 2 * x + 1, 2 * y + 1)];
      const average = [0, 1, 2, 3].map((k) => block.reduce((sum, p) => sum + p[k]!, 0) / 4);
      pixel(frame, 160, x, y).forEach((value, k) => expect(Math.abs(value - average[k]!)).toBeLessThanOrEqual(0.5));
    }
  });

  it("draws every effect but zoom exactly as it would from the shrunk photo", () => {
    const shrunk = { width: 160, height: 120, data: createEffect("tiles", big, { ...options, size })(1) };
    for (const effect of EFFECTS.filter((e) => e !== "zoom")) {
      const fromBig = createEffect(effect, big, { ...options, size });
      const fromShrunk = createEffect(effect, shrunk, options);
      for (const progress of [0, 0.5]) expect(changedBytes(fromBig(progress), fromShrunk(progress)), `${effect} at ${progress}`).toBe(0);
    }
  });

  it("zooms into the bigger photo, so the close-up shows detail the frame-sized photo has lost", () => {
    // Pixel-wide stripes: averaged away in the frame-sized photo, visible when zoomed into the big one.
    const stripes = solid(640, 480, [128, 128, 128], (x) => (x % 2 ? [255, 255, 255] : [0, 0, 0]));
    const detail = (frame: Uint8ClampedArray) => {
      let sum = 0;
      for (let i = 4; i < frame.length; i += 4) sum += Math.abs(frame[i]! - frame[i - 4]!);
      return sum / (frame.length / 4) / 255;
    };
    const fromBig = createEffect("zoom", stripes, { ...options, size });
    const fromFrameSized = createEffect("zoom", { width: 160, height: 120, data: createEffect("tiles", stripes, { ...options, size })(1) }, options);
    expect(detail(fromBig(0))).toBeGreaterThan(0.1);
    expect(detail(fromFrameSized(0))).toBe(0);
    expect(changedBytes(fromBig(1), fromFrameSized(1))).toBe(0); // the same photo at the end
  });

  it("zooming into a bigger photo has no jump where it moves from the big photo to the frame-sized one", () => {
    const draw = createEffect("zoom", big, { ...options, size });
    const whole = difference(draw(0), draw(1));
    // The photo is twice the frame, so the blend runs from 2× zoom to the end.
    const progressAt = (z: number) => (1 - Math.log(z) / Math.log(ZOOM_START)) ** (1 / ZOOM_EASE);
    for (const z of [2, 1.5, 1.001]) {
      const p = progressAt(z);
      expect(difference(draw(p - 1e-5), draw(p + 1e-5)) / whole, `at ${z}×`).toBeLessThan(0.01);
    }
    for (let progress = 0; progress < 1; progress += 0.05) {
      expect(difference(draw(progress), draw(progress + 1e-4)) / whole, `at ${progress.toFixed(2)}`).toBeLessThan(0.02);
    }
  });

  it("stretches a smaller photo to the frame", () => {
    const grey = solid(80, 60, [90, 90, 90]);
    const frame = createEffect("pixelate", grey, { ...options, size })(1);
    expect(frame).toHaveLength(160 * 120 * 4);
    expect(new Set(frame).size).toBeLessThanOrEqual(2); // still one grey (and opaque)
  });

  it("refuses a size that isn't whole numbers of at least 1", () => {
    for (const bad of [{ width: 0, height: 10 }, { width: 10.5, height: 10 }, { width: 10, height: Number.NaN }]) {
      expect(() => createEffect("zoom", big, { ...options, size: bad })).toThrow(RangeError);
    }
  });
});

describe("the smooth effects change a little at a time", () => {
  // Spotlight, thermal, swirl, zoom, kaleidoscope and shards move continuously: a step of 1/10,000 of
  // the reveal (far shorter than a frame) changes almost nothing.
  it.each(["spotlight", "thermal", "swirl", "zoom", "kaleidoscope", "shards"] as const)("%s", (effect) => {
    const source = photo();
    const draw = createEffect(effect, source, options);
    const whole = difference(draw(0), source.data);
    for (let progress = 0; progress < 1; progress += 0.05) {
      expect(difference(draw(progress), draw(progress + 1e-4)) / whole, `at ${progress.toFixed(2)}`).toBeLessThan(0.02);
    }
  });
});

describe("pixelate", () => {
  it("starts with blocks about 1/11 of the photo's longer side, and ends with single pixels", () => {
    expect(pixelateBlock(0, 1200)).toBe(110);
    expect(pixelateBlock(0, 600)).toBe(55);
    expect(pixelateBlock(0.99, 600)).toBe(1);
  });

  it("only shrinks the blocks, a few pixels at a time (redrawn 400 times a reveal)", () => {
    for (let step = 0; step < 400; step++) {
      const shrink = pixelateBlock(step / 400, 600) - pixelateBlock((step + 1) / 400, 600);
      expect(shrink).toBeGreaterThanOrEqual(0);
      expect(shrink).toBeLessThanOrEqual(3);
    }
  });

  it("colours each block with the average of the photo under it", () => {
    const source = photo();
    const frame = createEffect("pixelate", source, options)(0);
    const mean = (data: ArrayLike<number>, k: number) => {
      let sum = 0;
      for (let i = k; i < data.length; i += 4) sum += data[i]!;
      return sum / (data.length / 4);
    };
    // Each block is flat, and the blocks' average is the photo's.
    const colours = new Set<string>();
    for (let i = 0; i < frame.length; i += 4) colours.add(frame.subarray(i, i + 3).join());
    expect(colours.size).toBeLessThanOrEqual(11 * 8);
    for (const k of [0, 1, 2]) expect(mean(frame, k)).toBeCloseTo(mean(source.data, k), 0);
  });
});

describe("zoom", () => {
  // Blue photos with a red patch.
  const red = [255, 0, 0], blue = [0, 0, 255];
  const redShare = (frame: Uint8ClampedArray) => {
    let n = 0;
    for (let i = 0; i < frame.length; i += 4) if (frame[i]! > 200 && frame[i + 2]! < 55) n++;
    return n / (frame.length / 4);
  };

  it("starts 16× in on the focus point", () => {
    // A red patch around the focus fills the first frame if it's a little
    // bigger than 1/16 of the photo, and doesn't if it's a little smaller.
    const [width, height] = [320, 240];
    const patch = (fraction: number) =>
      solid(width, height, blue, (x, y) =>
        Math.abs(x + 0.5 - 0.7 * width) < (width * fraction) / 2 && Math.abs(y + 0.5 - 0.3 * height) < (height * fraction) / 2 ? red : undefined,
      );
    expect(redShare(createEffect("zoom", patch(1 / 14), options)(0))).toBe(1);
    expect(redShare(createEffect("zoom", patch(1 / 18), options)(0))).toBeLessThan(0.9);
  });

  it("near an edge, slides inward instead of showing past the photo", () => {
    const [width, height] = [320, 240];
    const corner = solid(width, height, blue, (x, y) => (x >= width - width / 14 && y >= height - height / 14 ? red : undefined));
    expect(redShare(createEffect("zoom", corner, { ...options, focus: { x: 1, y: 1 } })(0))).toBe(1);
  });
});

describe("spotlight", () => {
  const [width, height] = [160, 120];
  const white = solid(width, height, [255, 255, 255]);
  /** The middle of the lit area, as fractions of the photo's size. */
  const lightCentre = (frame: Uint8ClampedArray) => {
    let sx = 0, sy = 0, total = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const light = frame[(y * width + x) * 4]!;
        sx += (x + 0.5) * light;
        sy += (y + 0.5) * light;
        total += light;
      }
    }
    return { x: sx / total / width, y: sy / total / height };
  };

  it("starts as a small hole of light at the focus point, with the rest dark", () => {
    const frame = createEffect("spotlight", white, options)(0);
    expect(pixel(frame, width, 112, 36)).toEqual([255, 255, 255, 255]); // the focus (0.7, 0.3)
    expect(pixel(frame, width, 0, 0)).toEqual([0, 0, 0, 255]);
    let dark = 0;
    for (let i = 0; i < frame.length; i += 4) if (frame[i] === 0) dark++;
    expect(dark / (width * height)).toBeGreaterThan(0.95);
    const centre = lightCentre(frame);
    expect(centre.x).toBeCloseTo(0.7, 2);
    expect(centre.y).toBeCloseTo(0.3, 2);
  });

  it("drifts from the focus point to the middle of the photo", () => {
    const draw = createEffect("spotlight", white, options);
    const progress = 0.1; // the hole is still small, so the photo's edges don't cut it off
    const drift = progress * SPOTLIGHT_DRIFT_SPEED;
    const centre = lightCentre(draw(progress));
    expect(centre.x).toBeCloseTo(0.7 + (0.5 - 0.7) * drift, 2);
    expect(centre.y).toBeCloseTo(0.3 + (0.5 - 0.3) * drift, 2);
  });
});

describe("thermal", () => {
  const heatColour = (brightness: number) => [...THERMAL_PALETTE.subarray(brightness * 3, brightness * 3 + 3), 255];
  const grey = (v: number) => solid(64, 48, [v, v, v]);

  it("colours by brightness, brightest hottest: black, purple, red, yellow, white", () => {
    expect(heatColour(0)).toEqual([0, 0, 10, 255]);
    expect(heatColour(255)).toEqual([255, 255, 230, 255]);
    for (let i = 1; i < 256; i++) {
      expect(THERMAL_PALETTE[i * 3]).toBeGreaterThanOrEqual(THERMAL_PALETTE[(i - 1) * 3]!); // red
      expect(THERMAL_PALETTE[i * 3 + 1]).toBeGreaterThanOrEqual(THERMAL_PALETTE[(i - 1) * 3 + 1]!); // green
    }
    // A photo of one grey becomes that grey's heat colour.
    for (const v of [40, 128, 220]) expect(pixel(createEffect("thermal", grey(v), options)(0), 64, 10, 10)).toEqual(heatColour(v));
  });

  it("keeps the heat map until 30% of the reveal, and has the photo's own colours back by 90%, nearly sharp", () => {
    const at = (v: number, progress: number) => pixel(createEffect("thermal", grey(v), options)(progress), 64, 10, 10);
    expect(at(128, 0.3)).toEqual(heatColour(128));
    const halfway = at(128, 0.6); // half heat colour, half grey
    expect(halfway).not.toEqual(heatColour(128));
    expect(halfway).not.toEqual([128, 128, 128, 255]);
    expect(at(128, 0.9)).toEqual([128, 128, 128, 255]); // no heat colour left
    const source = photo();
    expect(difference(createEffect("thermal", source, options)(0.9), source.data)).toBeLessThan(0.03); // only a little soft
  });
});

describe("swirl", () => {
  // A photo whose colour is its own position (red = x, green = y), so a frame
  // shows where each of its pixels was taken from.
  const [width, height] = [200, 150];
  const positions = solid(width, height, [0, 0, 0], (x, y) => [x, y, 0]);
  const [cx, cy] = [0.7 * width, 0.3 * height];
  /** Each pixel of `frame` not taken from the photo's edge: where it is, and where it came from. */
  function* moves(frame: Uint8ClampedArray) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const [fromX, fromY] = pixel(frame, width, x, y) as [number, number];
        if (fromX > 0 && fromX < width - 1 && fromY > 0 && fromY < height - 1) yield { x, y, fromX, fromY };
      }
    }
  }

  it("turns each point around the focus, keeping its distance from it (give or take the smudge)", () => {
    const smudge = SWIRL_WOBBLE * width * Math.SQRT2 + 1; // the smudge at its strongest, plus rounding
    for (const { x, y, fromX, fromY } of moves(createEffect("swirl", positions, options)(0))) {
      expect(Math.abs(Math.hypot(fromX - cx, fromY - cy) - Math.hypot(x - cx, y - cy))).toBeLessThanOrEqual(smudge);
    }
  });

  it("turns the middle of the twirl most and its edge least", () => {
    // Late in the reveal, when the turn is under half a circle and can be measured.
    const turns = { near: [] as number[], far: [] as number[] };
    for (const { x, y, fromX, fromY } of moves(createEffect("swirl", positions, options)(0.85))) {
      const r = Math.hypot(x - cx, y - cy);
      let turn = Math.atan2(fromY - cy, fromX - cx) - Math.atan2(y - cy, x - cx);
      turn = Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn)));
      if (r > 5 && r < 30) turns.near.push(turn);
      else if (r > 100) turns.far.push(turn);
    }
    const mean = (a: number[]) => a.reduce((sum, n) => sum + n, 0) / a.length;
    expect(mean(turns.near)).toBeGreaterThan(1);
    expect(mean(turns.near)).toBeGreaterThan(3 * mean(turns.far));
  });
});

describe("tiles", () => {
  const source = photo();
  const [across, down] = tileGrid(source.width, source.height);
  /** Which tiles show the photo, by index row by row. */
  const open = (frame: Uint8ClampedArray) => {
    const result = new Set<number>();
    for (let tile = 0; tile < across * down; tile++) {
      const x = Math.floor(((tile % across) + 0.5) * (source.width / across));
      const y = Math.floor((Math.floor(tile / across) + 0.5) * (source.height / down));
      if (pixel(frame, source.width, x, y).join() === pixel(new Uint8ClampedArray(source.data), source.width, x, y).join()) result.add(tile);
    }
    return result;
  };

  it("covers the photo with an 8 × 6 grid, turned for a portrait photo", () => {
    expect(tileGrid(160, 120)).toEqual([TILES_ACROSS, TILES_DOWN]);
    expect(tileGrid(100, 100)).toEqual([8, 6]);
    expect(tileGrid(90, 160)).toEqual([6, 8]);
  });

  it("opens the tiles one at a time, and an open tile stays open", () => {
    const draw = createEffect("tiles", source, options);
    expect(open(draw(0)).size).toBe(0);
    let before = new Set<number>();
    for (const progress of [0.1, 0.3, 0.5, 0.7, 0.9, 0.999]) {
      const now = open(draw(progress));
      expect(now.size, `at ${progress}`).toBe(openTiles(progress));
      for (const tile of before) expect(now.has(tile)).toBe(true);
      before = now;
    }
    expect(openTiles(0.999)).toBe(47);
    // Redrawn 400 times a reveal, no redraw opens more than one.
    for (let step = 0; step < 400; step++) expect(openTiles((step + 1) / 400) - openTiles(step / 400)).toBeLessThanOrEqual(1);
  });

  it("opens them in an order set by the seed: the same for every player, different per puzzle", () => {
    const order = tileOrder("pz-a");
    expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: 48 }, (_, i) => i));
    expect(tileOrder("pz-a")).toEqual(order);
    expect(tileOrder("pz-b")).not.toEqual(order);
    const a = createEffect("tiles", source, { ...options, seed: "pz-a" })(0.5);
    const b = createEffect("tiles", source, { ...options, seed: "pz-b" })(0.5);
    expect(open(a)).not.toEqual(open(b));
  });
});

describe("seeded randomness", () => {
  it("gives numbers from 0 up to 1, the same sequence for the same seed", () => {
    const a = seededRandom("pz-a"), b = seededRandom("pz-a"), c = seededRandom("pz-c");
    const first = Array.from({ length: 100 }, () => a());
    expect(Array.from({ length: 100 }, () => b())).toEqual(first);
    expect(Array.from({ length: 100 }, () => c())).not.toEqual(first);
    for (const n of first) {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1);
    }
  });

  it("shuffles every number in, once each", () => {
    expect(shuffled(0, "x")).toEqual([]);
    expect(shuffled(1, "x")).toEqual([0]);
    expect(new Set(shuffled(100, "x")).size).toBe(100);
  });
});

describe("kaleidoscope", () => {
  const source = photo();
  const centre = { focus: { x: 0.5, y: 0.5 }, seed: "pz-test" };
  const [width, height] = [source.width, source.height];
  /** The pixel at `angle` (radians) and `radius` from the middle of a frame. */
  const at = (frame: Uint8ClampedArray, angle: number, radius: number) =>
    pixel(frame, width, Math.round(width / 2 + radius * Math.cos(angle)), Math.round(height / 2 + radius * Math.sin(angle)));

  it("starts as mirrored wedges: a point and its reflection across a wedge's edge match", () => {
    const frame = createEffect("kaleidoscope", source, centre)(0);
    const wedge = (2 * Math.PI) / KALEIDOSCOPE_WEDGES;
    let same = 0;
    const tries = [0.1, 0.2, 0.3].flatMap((offset) => [15, 25, 35].map((radius) => [offset, radius] as const));
    for (const [offset, radius] of tries) {
      if (at(frame, wedge - offset, radius).join() === at(frame, wedge + offset, radius).join()) same++;
    }
    expect(same).toBeGreaterThanOrEqual(tries.length - 2); // rounding to whole pixels can miss one or two
  });

  it("is fully unfolded, the photo exactly, by 90% of the reveal", () => {
    expect(changedBytes(createEffect("kaleidoscope", source, centre)(KALEIDOSCOPE_OPEN_BY), source.data)).toBe(0);
  });
});

describe("shards", () => {
  const white = solid(160, 120, [255, 255, 255]);

  it("starts with dark cracks between the shards, gone by the end", () => {
    const darkPixels = (frame: Uint8ClampedArray) => {
      let n = 0;
      for (let i = 0; i < frame.length; i += 4) if (frame[i]! < 100) n++;
      return n;
    };
    const draw = createEffect("shards", white, options);
    const start = darkPixels(draw(0));
    expect(start).toBeGreaterThan(160 * 120 * 0.02);
    expect(start).toBeLessThan(160 * 120 * 0.3); // lines, not whole shards
    expect(darkPixels(draw(SHARDS_CRACKS_GONE_BY))).toBe(0);
  });

  it("cracks differently for a different seed", () => {
    const source = photo();
    expect(changedBytes(createEffect("shards", source, options)(0), createEffect("shards", source, { ...options, seed: "pz-other" })(0))).toBeGreaterThan(0);
  });
});
