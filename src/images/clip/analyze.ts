// Runs CLIP on a photo's views (#56): what the image picker (#180) and the Beat
// the AI solver (#66) call. Owner: Darian. Scripts only, like the rest of
// src/images/clip.
//
// A view is what a player sees at one level: the same pixels the game cuts
// (levelCrop in src/game/levels.ts), fitted whole into CLIP's 224 × 224 square
// with grey bars, the way the game's frame fits it, so CLIP sees all of it.
// With timed rounds (#257), Beat the AI's views are the frames of the puzzle's
// effect instead (src/game/effects), fitted the same way.

import sharp from "sharp";

import { createEffect, DEFAULT_EFFECT, frameSize, type EffectName } from "../../game/effects/index.ts";
import { levelCrop, type ImageSize, type PixelRect } from "../../game/levels.ts";
import { TIMED_SCORING_CONFIG } from "../../game/scoring-config.ts";
import type { Puzzle, RevealLevel } from "../../game/types.ts";
import { MAX_INPUT_PIXELS } from "../cut.ts";
import {
  answerProbability,
  dot,
  firstSolvedLevel,
  focusGrid,
  isRecognizable,
  rank,
  rejectProbability,
  rejectReasons,
  SOLVE_STEP_SECONDS,
  solves,
  solveTimes,
  suggestStartingPoints,
  type Answer,
  type Focus,
  type FocusResult,
  type Guess,
  type Ranking,
  type RejectKind,
} from "./decide.ts";
import { prompts, PROMPT_TEMPLATES } from "./labels.ts";
import { CLIP_INPUT_SIZE, unit, type ClipModel, type RgbImage } from "./model.ts";

/** The bars around a view that isn't square: mid grey, which CLIP reads as "nothing here". */
const BARS = { r: 128, g: 128, b: 128 };

/** `image` (a file path or encoded bytes) fitted whole into CLIP's square. */
export async function clipInput(image: string | Uint8Array): Promise<RgbImage> {
  return fit(sharp(image, { limitInputPixels: MAX_INPUT_PIXELS }).autoOrient());
}

async function fit(image: ReturnType<typeof sharp>): Promise<RgbImage> {
  const { data, info } = await image
    .resize(CLIP_INPUT_SIZE, CLIP_INPUT_SIZE, { fit: "contain", background: BARS })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height };
}

/** A photo decoded once, upright, to cut many views from. */
export type Photo = { size: ImageSize; view(crop: PixelRect): Promise<RgbImage> };

/** Decodes `original` (a file path or encoded bytes) once, so each view is a quick crop of the pixels in memory. */
export async function openPhoto(original: string | Uint8Array): Promise<Photo> {
  const { data, info } = await sharp(original, { limitInputPixels: MAX_INPUT_PIXELS })
    .autoOrient()
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const raw = { width: info.width, height: info.height, channels: 3 as const };
  return {
    size: { width: info.width, height: info.height },
    view: (crop) => fit(sharp(data, { raw }).extract(crop)),
  };
}

/** Labels CLIP chooses between, embedded once, so every image after that is one model call. */
export type Classifier = {
  labels: readonly string[];
  /** One ranking per image, in order. */
  classify(images: readonly RgbImage[]): Promise<Ranking[]>;
};

/**
 * Embeds each label in every template's sentence and averages them. Pass
 * `templates: ["{}"]` for labels that are already sentences.
 */
export async function createClassifier(
  model: ClipModel,
  labels: readonly string[],
  templates: readonly string[] = PROMPT_TEMPLATES,
): Promise<Classifier> {
  if (labels.length === 0) throw new RangeError("createClassifier: give at least one label");
  const sentences = await model.embedTexts(labels.flatMap((label) => prompts(label, templates)));
  const labelVectors = labels.map((_, i) => {
    const group = sentences.slice(i * templates.length, (i + 1) * templates.length);
    const mean = new Float32Array(group[0]!.length);
    for (const v of group) v.forEach((x, j) => (mean[j]! += x));
    return unit(mean);
  });
  return {
    labels,
    async classify(images) {
      const vectors = await model.embedImages(images);
      return vectors.map((image) => rank(labels, labelVectors.map((label) => dot(label, image))));
    },
  };
}

/**
 * The sentences for each reason to reject a photo. CLIP compares "yes" and
 * "no" for each reason separately; the probability of "yes" is the score.
 *
 * Tried on the practice photos, as they are and with a caption or a watermark
 * added: as they are, text scored 0.38 at most, with text 0.67 at least, and
 * people 0.15 at most. "A travel photo" and "a postcard" are there because
 * CLIP reads a bright landmark photo as a stock photo, so "watermark" alone
 * scored the clean Golden Gate photo 0.79. Tune them on real candidates (#180).
 */
export const REJECT_PROMPTS: Readonly<Record<RejectKind, { yes: readonly string[]; no: readonly string[] }>> = {
  text: {
    yes: ["a photo with text written on it", "a photo with a caption", "a photo with a logo", "a photo with a watermark"],
    no: ["a photo", "a travel photo", "a postcard", "a photo of an animal", "a photo of food", "a photo of a landscape", "a photo of a thing"],
  },
  people: {
    yes: ["a photo of a person", "a photo of a person's face", "a photo of a group of people"],
    no: ["a photo with no people", "a photo of an animal", "a photo of food", "a photo of a landscape", "a photo of a building", "a photo of a thing"],
  },
};

export type RejectCheck = (image: RgbImage) => Promise<Record<RejectKind, number>>;

/** A check for the reasons to reject a photo, embedded once. */
export async function createRejectCheck(model: ClipModel): Promise<RejectCheck> {
  const kinds = Object.keys(REJECT_PROMPTS) as RejectKind[];
  const classifiers = await Promise.all(
    kinds.map((kind) => createClassifier(model, [...REJECT_PROMPTS[kind].yes, ...REJECT_PROMPTS[kind].no], ["{}"])),
  );
  return async (image) => {
    const scores = await Promise.all(classifiers.map(async (c) => (await c.classify([image]))[0]!));
    return Object.fromEntries(kinds.map((kind, i) => [kind, rejectProbability(scores[i]!, REJECT_PROMPTS[kind].yes)])) as Record<
      RejectKind,
      number
    >;
  };
}

/** What CLIP made of one view. */
export type LevelResult = {
  level: RevealLevel;
  /** Its five most likely labels. */
  top: Guess[];
  /** How likely it thinks the answer is. */
  answerProbability: number;
  /** Its top guess is the answer. */
  solved: boolean;
};

function levelResult(answer: Answer, level: RevealLevel, ranking: Ranking): LevelResult {
  return { level, top: ranking.slice(0, 5), answerProbability: answerProbability(answer, ranking), solved: solves(answer, ranking) };
}

/** A starting point and what CLIP made of each of its views. */
export type FocusAnalysis = FocusResult & { levels: LevelResult[] };

export type PhotoAnalysis = {
  /** CLIP's view of the whole photo. */
  full: LevelResult;
  /** At full view, the answer is CLIP's top guess. If not, the photo is rejected. */
  recognizable: boolean;
  /** How likely each reason to reject applies, and the ones flagged. */
  rejects: { scores: Record<RejectKind, number>; flagged: RejectKind[] };
  /** Every point of the grid tried. */
  grid: FocusAnalysis[];
  /** Up to three starting points to offer (see suggestStartingPoints). */
  suggestions: FocusAnalysis[];
};

export type AnalyzeOptions = {
  /** The grid is `gridSteps` × `gridSteps` focus points. Default 5. */
  gridSteps?: number;
  /** Also try these focus points, e.g. one a person nudged. */
  extraFocus?: readonly Focus[];
};

/**
 * Everything the picker shows for one candidate photo: whether CLIP recognizes
 * it, reasons to reject it, every grid point's views, and the top 3 starting
 * points. Views that come out the same (the full photo, or a wide view slid in
 * from an edge) are only run through CLIP once.
 */
export async function analyzePhoto(
  classifier: Classifier,
  rejectCheck: RejectCheck,
  photo: Photo,
  puzzle: Answer & { zoomLevels: readonly number[] },
  { gridSteps = 5, extraFocus = [] }: AnalyzeOptions = {},
): Promise<PhotoAnalysis> {
  const zoomLevels = [...puzzle.zoomLevels];
  const points = [...focusGrid(gridSteps), ...extraFocus];
  const crops = points.map((focus) => zoomLevels.map((_, level) => levelCrop(photo.size, { focus, zoomLevels }, level)));
  const fullCrop = levelCrop(photo.size, { focus: { x: 0.5, y: 0.5 }, zoomLevels: [1] }, 0);

  const key = ({ left, top, width, height }: PixelRect) => `${left},${top},${width},${height}`;
  const unique = new Map<string, PixelRect>([[key(fullCrop), fullCrop]]);
  for (const crop of crops.flat()) unique.set(key(crop), crop);
  const index = new Map([...unique.keys()].map((k, i) => [k, i]));
  const views = await Promise.all([...unique.values()].map((crop) => photo.view(crop)));
  const rankings = await classifier.classify(views);
  const rankingOf = (crop: PixelRect) => rankings[index.get(key(crop))!]!;

  const grid = points.map((focus, i): FocusAnalysis => {
    const levelRankings = crops[i]!.map(rankingOf);
    return {
      focus,
      solvedLevel: firstSolvedLevel(puzzle, levelRankings),
      openingAnswerProbability: answerProbability(puzzle, levelRankings[0]!),
      levels: levelRankings.map((ranking, level) => levelResult(puzzle, level, ranking)),
    };
  });
  const fullRanking = rankingOf(fullCrop);
  const scores = await rejectCheck(views[0]!);
  return {
    full: levelResult(puzzle, zoomLevels.length - 1, fullRanking),
    recognizable: isRecognizable(puzzle, fullRanking),
    rejects: { scores, flagged: rejectReasons(scores) },
    grid,
    suggestions: suggestStartingPoints(grid, zoomLevels.length),
  };
}

/** The effect the game plays while a puzzle has none chosen (`DEFAULT_EFFECT` in src/game/effects). */
export const SOLVER_DEFAULT_EFFECT: EffectName = DEFAULT_EFFECT;

/** What CLIP made of one frame of a puzzle's effect. */
export type StepResult = {
  /** Seconds after the round's clock started. */
  seconds: number;
  /** Its five most likely labels. */
  top: Guess[];
  /** How likely it thinks the answer is. */
  answerProbability: number;
  /** Its top guess is the answer. */
  solved: boolean;
};

export type SolveOptions = {
  /** When the photo is clear: the frame at `t` is the effect at `t / revealSeconds`. Default: the game's (`TIMED_SCORING_CONFIG`). */
  revealSeconds?: number;
  /** Seconds between frames. Default `SOLVE_STEP_SECONDS` (0.5). */
  step?: number;
  /** Frames per call to CLIP. It stops after the first batch it solves. Default 10. */
  batch?: number;
};

/** The puzzle fields the solver needs: what counts as right, and how its effect plays. */
export type SolvablePuzzle = Answer & Pick<Puzzle, "id" | "reveal" | "effect">;

/**
 * Beat the AI by solve time (#257): CLIP watches `puzzle`'s effect clear up on
 * `image` (what players see: a file path or encoded bytes), one frame every
 * `step` seconds of the round's clock, drawn by the same code as the round
 * screen. `aiSolvedSeconds` is the first time its top guess is the answer, or
 * `null` if it never is, even once the photo is clear. `steps` has each frame
 * CLIP looked at, up to the end of the batch that solved it.
 */
export async function solveTimed(
  classifier: Classifier,
  image: string | Uint8Array,
  puzzle: SolvablePuzzle,
  { revealSeconds = TIMED_SCORING_CONFIG.revealSeconds, step = SOLVE_STEP_SECONDS, batch = 10 }: SolveOptions = {},
): Promise<{ aiSolvedSeconds: number | null; steps: StepResult[] }> {
  if (!Number.isInteger(batch) || batch < 1) throw new RangeError(`solveTimed: batch must be a whole number of at least 1, got ${batch}`);
  const times = solveTimes(revealSeconds, step);
  const { data, info } = await sharp(image, { limitInputPixels: MAX_INPUT_PIXELS })
    .autoOrient()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  // The round screen's frame size (EffectCanvas), so CLIP sees what players see.
  const raw = { ...frameSize(info.width, info.height), channels: 4 as const };
  const draw = createEffect(
    puzzle.effect ?? SOLVER_DEFAULT_EFFECT,
    { data, width: info.width, height: info.height },
    { focus: puzzle.reveal.focus, seed: puzzle.id, size: { width: raw.width, height: raw.height } },
  );

  const steps: StepResult[] = [];
  for (let start = 0; start < times.length; start += batch) {
    const chunk = times.slice(start, start + batch);
    const views = await Promise.all(chunk.map((seconds) => fit(sharp(draw(seconds / revealSeconds), { raw }))));
    const rankings = await classifier.classify(views);
    rankings.forEach((ranking, i) => {
      steps.push({
        seconds: chunk[i]!,
        top: ranking.slice(0, 5),
        answerProbability: answerProbability(puzzle, ranking),
        solved: solves(puzzle, ranking),
      });
    });
    const solved = steps.find((s) => s.solved);
    if (solved !== undefined) return { aiSolvedSeconds: solved.seconds, steps };
  }
  return { aiSolvedSeconds: null, steps };
}
