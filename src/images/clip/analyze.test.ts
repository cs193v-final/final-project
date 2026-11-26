// Spec for running CLIP on a photo's views (#56), with a fake model so it runs
// anywhere: the fake "sees" colours. Red is a strawberry (and stands out, the
// way a bit of the answer does), green is grass, and blue looks like text.
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

import {
  analyzePhoto,
  clipInput,
  createClassifier,
  createRejectCheck,
  openPhoto,
  REJECT_PROMPTS,
  solveLevels,
  type RejectCheck,
} from "./analyze.ts";
import { CLIP_INPUT_SIZE, unit, type ClipModel, type RgbImage } from "./model.ts";

// Dimensions of the fake embeddings: red, green, blue, nothing in particular, a person.
const [R, G, B, N, P] = [0, 1, 2, 3, 4];
const axis = (i: number) => Float32Array.from({ length: 5 }, (_, j) => (j === i ? 1 : 0));

function textAxis(text: string): number {
  if (/\bno\b|plain|nature|animal|food|landscape|building|thing/.test(text)) return N;
  if (/strawberr/i.test(text)) return R;
  if (/grass/.test(text)) return G;
  if (/sky|text|watermark|sign|caption|logo/.test(text)) return B;
  if (/person|people|face/.test(text)) return P;
  return N;
}

function colours({ data }: RgbImage) {
  let r = 0, g = 0, b = 0;
  const pixels = data.length / 3;
  for (let i = 0; i < data.length; i += 3) {
    const [red, green, blue] = [data[i]!, data[i + 1]!, data[i + 2]!];
    if (red > 150 && green < 90 && blue < 90) r++;
    else if (green > 120 && red < 90 && blue < 90) g++;
    else if (blue > 150 && red < 90 && green < 90) b++;
  }
  return { r: r / pixels, g: g / pixels, b: b / pixels };
}

function fakeModel() {
  const model = {
    name: "fake",
    embedTexts: vi.fn(async (texts: readonly string[]) => texts.map((t) => axis(textAxis(t)))),
    embedImages: vi.fn(async (images: readonly RgbImage[]) =>
      images.map((image) => {
        const { r, g, b } = colours(image);
        return unit(Float32Array.from([3 * r, g, b, 0.5, 0]));
      }),
    ),
  } satisfies ClipModel;
  return model;
}

const RED = { r: 220, g: 20, b: 20 };
const GREEN = { r: 20, g: 180, b: 20 };
const BLUE = { r: 20, g: 20, b: 220 };

/** A photo of one colour, encoded. */
const plain = (width: number, height: number, background: typeof RED, format: "png" | "webp" = "png") =>
  sharp({ create: { width, height, channels: 3, background } })[format]().toBuffer();

/** 400 × 300: red on the left 60%, green on the right 40%. */
async function strawberryOnGrass() {
  const red = await plain(240, 300, RED);
  return sharp({ create: { width: 400, height: 300, channels: 3, background: GREEN } })
    .composite([{ input: red, left: 0, top: 0 }])
    .png()
    .toBuffer();
}

const strawberry = { answer: "Strawberry", acceptedAnswers: ["Strawberries"] };
const labels = ["Strawberry", "grass", "sky"];
const noRejects: RejectCheck = async () => ({ text: 0, people: 0 });

describe("clipInput and openPhoto", () => {
  it("fits a whole view into CLIP's square, with grey bars, not cropping any of it", async () => {
    const image = await clipInput(await plain(400, 100, RED));
    expect([image.width, image.height]).toEqual([CLIP_INPUT_SIZE, CLIP_INPUT_SIZE]);
    const pixel = (x: number, y: number) => [...image.data.slice((y * image.width + x) * 3, (y * image.width + x) * 3 + 3)];
    expect(pixel(112, 5)).toEqual([128, 128, 128]); // a bar above
    expect(pixel(2, 112)).toEqual([RED.r, RED.g, RED.b]); // the left edge is still there
    expect(pixel(221, 112)).toEqual([RED.r, RED.g, RED.b]); // and the right
  });

  it("turns a sideways phone photo upright, like the game's cut", async () => {
    const sideways = await sharp({ create: { width: 300, height: 200, channels: 3, background: RED } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    expect((await openPhoto(sideways)).size).toEqual({ width: 200, height: 300 });
  });

  it("cuts a view from the decoded photo", async () => {
    const photo = await openPhoto(await strawberryOnGrass());
    expect(photo.size).toEqual({ width: 400, height: 300 });
    const right = await photo.view({ left: 300, top: 0, width: 100, height: 300 });
    expect(colours(right).g).toBeCloseTo(1 / 3, 1); // a tall view: a third of the square, grey bars either side
    expect(colours(right).r).toBe(0);
  });
});

describe("createClassifier", () => {
  it("embeds the labels once, then only the images", async () => {
    const model = fakeModel();
    const classifier = await createClassifier(model, labels);
    await classifier.classify([await clipInput(await plain(50, 50, GREEN))]);
    await classifier.classify([await clipInput(await plain(50, 50, RED))]);
    expect(model.embedTexts).toHaveBeenCalledTimes(1);
    expect(model.embedTexts.mock.calls[0]![0]).toHaveLength(labels.length * 4); // four sentences per label
  });

  it("ranks the labels for each image, in order", async () => {
    const classifier = await createClassifier(fakeModel(), labels);
    const [green, red] = await classifier.classify([
      await clipInput(await plain(50, 50, GREEN)),
      await clipInput(await plain(50, 50, RED)),
    ]);
    expect(green![0]!.label).toBe("grass");
    expect(red![0]!.label).toBe("Strawberry");
  });

  it("needs at least one label", async () => {
    await expect(createClassifier(fakeModel(), [])).rejects.toThrow(RangeError);
  });
});

describe("createRejectCheck", () => {
  it("scores text high on a photo that looks like it has text, and people low with none", async () => {
    const check = await createRejectCheck(fakeModel());
    const textLike = await check(await clipInput(await plain(50, 50, BLUE)));
    expect(textLike.text).toBeGreaterThan(0.9);
    expect(textLike.people).toBeLessThan(0.1);
    const clean = await check(await clipInput(await plain(50, 50, GREEN)));
    expect(clean.text).toBeLessThan(0.1);
  });

  it("has 'yes' and 'no' sentences for every reason", () => {
    for (const { yes, no } of Object.values(REJECT_PROMPTS)) {
      expect(yes.length).toBeGreaterThan(0);
      expect(no.length).toBeGreaterThan(0);
    }
  });
});

describe("analyzePhoto", () => {
  // 5 views, middle = view 2. On the grid, x = 0.1–0.5 is red at the first
  // view (too easy), x = 0.7 turns red by view 2 (suggested), x = 0.9 only
  // by view 3 (too late).
  const puzzle = { ...strawberry, zoomLevels: [8, 4, 2, 1.5, 1] };

  async function analyze(rejectCheck = noRejects) {
    const model = fakeModel();
    const classifier = await createClassifier(model, labels);
    const result = await analyzePhoto(classifier, rejectCheck, await openPhoto(await strawberryOnGrass()), puzzle);
    return { model, result };
  }

  it("says whether CLIP recognizes the whole photo", async () => {
    const { result } = await analyze();
    expect(result.recognizable).toBe(true);
    expect(result.full).toMatchObject({ level: 4, solved: true });
    expect(result.full.top[0]!.label).toBe("Strawberry");
  });

  it("finds the view CLIP solves each grid point at", async () => {
    const { result } = await analyze();
    expect(result.grid).toHaveLength(25);
    const solvedAt = (x: number) => result.grid.filter((r) => r.focus.x === x).map((r) => r.solvedLevel);
    expect(solvedAt(0.1)).toEqual([0, 0, 0, 0, 0]);
    expect(solvedAt(0.5)).toEqual([0, 0, 0, 0, 0]);
    expect(solvedAt(0.7)).toEqual([2, 2, 2, 2, 2]);
    expect(solvedAt(0.9)).toEqual([3, 3, 3, 3, 3]);
    const point = result.grid.find((r) => r.focus.x === 0.7)!;
    expect(point.levels.map((l) => l.top[0]!.label)).toEqual(["grass", "grass", "Strawberry", "Strawberry", "Strawberry"]);
    expect(point.openingAnswerProbability).toBeLessThan(0.01);
  });

  it("suggests three starting points that CLIP solves by the middle view, spread out", async () => {
    const { result } = await analyze();
    expect(result.suggestions.map((s) => s.focus)).toEqual([
      { x: 0.7, y: 0.1 },
      { x: 0.7, y: 0.5 },
      { x: 0.7, y: 0.9 },
    ]);
    expect(result.suggestions.every((s) => s.solvedLevel === 2)).toBe(true);
  });

  it("runs each distinct view through CLIP once", async () => {
    const { model } = await analyze();
    const embedded = model.embedImages.mock.calls.reduce((sum, [images]) => sum + images.length, 0);
    expect(embedded).toBeLessThan(25 * 4 + 1); // 25 points × 4 cropped views + the full photo, at most
  });

  it("checks the whole photo for reasons to reject, and flags the likely ones", async () => {
    const rejectCheck = vi.fn<RejectCheck>(async () => ({ text: 0.7, people: 0.1 }));
    const { result } = await analyze(rejectCheck);
    expect(rejectCheck).toHaveBeenCalledTimes(1);
    expect(colours(rejectCheck.mock.calls[0]![0]).r).toBeGreaterThan(0.4); // the whole photo, red on the left
    expect(result.rejects).toEqual({ scores: { text: 0.7, people: 0.1 }, flagged: ["text"] });
  });

  it("also tries extra focus points, e.g. one a person nudged", async () => {
    const model = fakeModel();
    const classifier = await createClassifier(model, labels);
    const photo = await openPhoto(await strawberryOnGrass());
    const result = await analyzePhoto(classifier, noRejects, photo, puzzle, { gridSteps: 1, extraFocus: [{ x: 0.75, y: 0.5 }] });
    expect(result.grid.map((r) => r.focus)).toEqual([
      { x: 0.5, y: 0.5 },
      { x: 0.75, y: 0.5 },
    ]);
  });

  it("isn't recognizable when the whole photo's top guess is something else", async () => {
    const classifier = await createClassifier(fakeModel(), labels);
    const grass = await openPhoto(await plain(400, 300, GREEN));
    const result = await analyzePhoto(classifier, noRejects, grass, puzzle, { gridSteps: 1 });
    expect(result.recognizable).toBe(false);
    expect(result.suggestions).toEqual([]);
  });
});

describe("solveLevels (Beat the AI)", () => {
  it("gives the first stored level CLIP gets right as aiSolvedLevel", async () => {
    const classifier = await createClassifier(fakeModel(), labels);
    const levels = await Promise.all([GREEN, GREEN, RED, RED].map((colour) => plain(80, 60, colour, "webp")));
    const { aiSolvedLevel, levels: results } = await solveLevels(classifier, levels, strawberry);
    expect(aiSolvedLevel).toBe(2);
    expect(results.map((r) => r.solved)).toEqual([false, false, true, true]);
  });

  it("gives null when CLIP never gets it", async () => {
    const classifier = await createClassifier(fakeModel(), labels);
    const levels = await Promise.all([GREEN, GREEN, BLUE].map((colour) => plain(80, 60, colour, "webp")));
    expect((await solveLevels(classifier, levels, strawberry)).aiSolvedLevel).toBeNull();
  });
});
