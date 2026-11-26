// The real model on the practice photos (#56), whose answers are public. Opt-in,
// because it needs `npm run clip:install` and the model downloaded once (about
// 610 MB): CLIP_SMOKE=1 npx vitest run src/images/clip/model.smoke.test.ts
import { readFileSync } from "node:fs";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import type { Puzzle } from "../../game/types.ts";
import { cutLevels } from "../cut.ts";
import { clipInput, createClassifier, createRejectCheck, solveLevels } from "./analyze.ts";
import { REJECT_THRESHOLD } from "./decide.ts";
import { buildLabels } from "./labels.ts";
import { loadClip, splitRows, unit } from "./model.ts";

const root = new URL("../../../", import.meta.url);
const practice = JSON.parse(readFileSync(new URL("src/puzzles/sample.json", root), "utf8")) as Omit<Puzzle, "aiSolvedLevel">[];
const original = (p: { imageUrl: string }) => readFileSync(new URL(`public${p.imageUrl}`, root));

describe("unit and splitRows", () => {
  it("make unit vectors, one per row", () => {
    const close = (v: Float32Array, expected: number[]) => expected.forEach((x, i) => expect(v[i]).toBeCloseTo(x, 6));
    close(unit(new Float32Array([3, 4])), [0.6, 0.8]);
    expect([...unit(new Float32Array([0, 0]))]).toEqual([0, 0]);
    const [a, b] = splitRows(new Float32Array([3, 4, 0, 2]), 2);
    close(a!, [0.6, 0.8]);
    close(b!, [0, 1]);
    expect(() => splitRows(new Float32Array(3), 2)).toThrow();
    expect(splitRows(new Float32Array(0), 0)).toEqual([]);
  });
});

describe.runIf(process.env.CLIP_SMOKE === "1")("CLIP on the practice photos", () => {
  // Loaded by the first test that needs it: Vitest runs this block even when it skips it.
  let loading: ReturnType<typeof loadClip> | undefined;
  const clip = () => (loading ??= loadClip());
  const labels = buildLabels(practice.map((p) => p.answer));

  it("recognizes each practice photo at full view", { timeout: 300_000 }, async () => {
    const classifier = await createClassifier(await clip(), labels);
    const rankings = await classifier.classify(await Promise.all(practice.map((p) => clipInput(original(p)))));
    expect(rankings.map((r) => r[0]!.label)).toEqual(practice.map((p) => p.answer));
  });

  it("doesn't flag them for text or people, but does once a caption is added", { timeout: 300_000 }, async () => {
    const check = await createRejectCheck(await clip());
    for (const p of practice) {
      const scores = await check(await clipInput(original(p)));
      expect(scores.text, p.id).toBeLessThan(REJECT_THRESHOLD);
      expect(scores.people, p.id).toBeLessThan(REJECT_THRESHOLD);

      const { width = 0, height = 0 } = await sharp(original(p)).metadata();
      const caption = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect y="${height * 0.8}" width="${width}" height="${height * 0.2}" fill="white"/><text x="40" y="${height * 0.95}" font-size="${height * 0.12}" font-family="sans-serif">Photo by A. Photographer</text></svg>`;
      const captioned = await sharp(original(p)).composite([{ input: Buffer.from(caption) }]).jpeg().toBuffer();
      expect((await check(await clipInput(captioned))).text, `${p.id} with a caption`).toBeGreaterThanOrEqual(REJECT_THRESHOLD);
    }
  });

  it("solves each one at some view, playing on the game's own cut levels", { timeout: 300_000 }, async () => {
    const classifier = await createClassifier(await clip(), labels);
    for (const p of practice) {
      const levels = await cutLevels(original(p), p.reveal);
      const { aiSolvedLevel } = await solveLevels(classifier, levels.map((l) => l.bytes), p);
      expect(aiSolvedLevel).not.toBeNull();
    }
  });
});
