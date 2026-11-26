// What CLIP makes of a photo (#56): whether it recognizes it, reasons to reject
// it, and the top 3 starting points. The same analysis the review page (#180)
// shows, here for the command line and the images:preview fallback (#181, #182):
//
//   npm run clip:install                                   once: CLIP's own install (about 735 MB)
//   npm run images:clip -- --puzzle <practice id>          a practice puzzle (sample.json)
//   npm run images:clip -- photo.jpg --answer "<answer>" --theme "<answer>,<answer>"
//   npm run images:clip -- photo.jpg --answer "<answer>" --focus 0.4,0.66 --zoom 14,8,4.5,2.5,1
//
// --answer is the photo's answer and --accept its alternates (comma-separated).
// --theme is the day's other answers: CLIP chooses between all of them and the
// committed generic list (src/images/clip/generic-labels.ts). --focus also
// shows CLIP's guesses at each view from that starting point, and the
// aiSolvedLevel it would get. --grid sets the grid of starting points tried
// (default 5, for 5 × 5). Answers come only from the command line and are only
// printed; nothing is written.
//
// The first run downloads the model (about 610 MB) into tools/clip/.cache/
// (git-ignored). After that it runs offline. On a laptop CPU: about 20 s to
// load the model and read the labels, then about 10 s per photo for the 5 × 5
// grid, so a theme's 25 candidates take about 5 minutes. See
// src/images/clip/model.ts for the model.
//
// Runs directly in Node 24 (type stripping), so imports keep their `.ts`.

import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";

import type { Puzzle } from "../src/game/types.ts";
import { analyzePhoto, createClassifier, createRejectCheck, openPhoto, type FocusAnalysis, type LevelResult } from "../src/images/clip/analyze.ts";
import { REJECT_THRESHOLD, type Focus } from "../src/images/clip/decide.ts";
import { buildLabels } from "../src/images/clip/labels.ts";
import { isDownloaded, loadClip } from "../src/images/clip/model.ts";

const root = resolve(import.meta.dirname, "..");

/** The practice pack's zoom levels (#112, #113). */
const DEFAULT_ZOOM = [14, 8, 4.5, 2.5, 1];

const list = (value: string | undefined) => (value ?? "").split(",").map((s) => s.trim()).filter((s) => s !== "");

function numbers(value: string, name: string): number[] {
  const parsed = value.split(",").map(Number);
  if (parsed.length === 0 || parsed.some((n) => !Number.isFinite(n))) throw new Error(`--${name} must be numbers separated by commas`);
  return parsed;
}

type Source = { file: string; answer: string; acceptedAnswers: string[]; theme: string[]; zoomLevels: number[]; focus?: Focus };

function source(values: Record<string, string | undefined>, positionals: string[]): Source {
  const focus = values.focus === undefined ? undefined : numbers(values.focus, "focus");
  if (focus !== undefined && focus.length !== 2) throw new Error("--focus must be x,y");
  const atFocus = focus === undefined ? undefined : { x: focus[0]!, y: focus[1]! };
  if (values.puzzle !== undefined) {
    const puzzles = JSON.parse(readFileSync(join(root, "src/puzzles/sample.json"), "utf8")) as Puzzle[];
    const puzzle = puzzles.find((p) => p.id === values.puzzle);
    if (!puzzle) throw new Error(`no practice puzzle "${values.puzzle}" (ids: ${puzzles.map((p) => p.id).join(", ")})`);
    return {
      file: join(root, "public", puzzle.imageUrl),
      answer: puzzle.answer,
      acceptedAnswers: puzzle.acceptedAnswers,
      theme: puzzles.map((p) => p.answer),
      zoomLevels: puzzle.reveal.zoomLevels,
      focus: atFocus ?? puzzle.reveal.focus,
    };
  }
  const [file] = positionals;
  if (file === undefined || values.answer === undefined) throw new Error('give --puzzle <practice id>, or a photo with --answer "<answer>"');
  return {
    file: resolve(file),
    answer: values.answer,
    acceptedAnswers: list(values.accept),
    theme: list(values.theme),
    zoomLevels: values.zoom === undefined ? DEFAULT_ZOOM : numbers(values.zoom, "zoom"),
    focus: atFocus,
  };
}

const percent = (p: number) => `${p >= 0.995 ? 100 : p < 0.005 && p > 0 ? "<1" : Math.round(p * 100)}%`;
const guesses = (r: LevelResult, n = 3) => r.top.slice(0, n).map((g) => `${g.label} ${percent(g.probability)}`).join(", ");
const view = (level: number | null, of: number) => (level === null ? "never" : `view ${level + 1} of ${of} (aiSolvedLevel ${level})`);
const focusArg = ({ x, y }: Focus) => `--focus ${x},${y}`;

function printFocus(result: FocusAnalysis, zoomLevels: readonly number[]) {
  for (const level of result.levels) {
    console.log(`  view ${level.level + 1} (${zoomLevels[level.level]}×): ${guesses(level)}${level.solved ? "  ← solved" : ""}`);
  }
  console.log(`  CLIP solves it at ${view(result.solvedLevel, zoomLevels.length)}`);
}

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      puzzle: { type: "string" },
      answer: { type: "string" },
      accept: { type: "string" },
      theme: { type: "string" },
      zoom: { type: "string" },
      focus: { type: "string" },
      grid: { type: "string" },
    },
    allowPositionals: true,
  });
  const src = source(values, positionals);
  const gridSteps = values.grid === undefined ? 5 : Number(values.grid);
  const started = performance.now();

  if (!isDownloaded()) console.log("Downloading CLIP, about 610 MB (first run only)…");
  const model = await loadClip();
  const labels = buildLabels([src.answer, ...src.theme]);
  const [classifier, rejectCheck, photo] = await Promise.all([
    createClassifier(model, labels),
    createRejectCheck(model),
    openPhoto(new Uint8Array(readFileSync(src.file))),
  ]);
  const loaded = performance.now();
  const result = await analyzePhoto(classifier, rejectCheck, photo, src, {
    gridSteps,
    extraFocus: src.focus === undefined ? [] : [src.focus],
  });
  const n = src.zoomLevels.length;

  console.log(`${relative(process.cwd(), src.file)}: ${photo.size.width}×${photo.size.height}, zoom ${src.zoomLevels.join(", ")}`);
  console.log(`${model.name}, ${labels.length} labels\n`);
  console.log(`Full view: ${guesses(result.full)} → ${result.recognizable ? "recognizable" : "NOT recognizable: reject (the answer isn't CLIP's top guess)"}`);
  const { scores, flagged } = result.rejects;
  const shown = Object.entries(scores).map(([kind, p]) => `${kind} ${p.toFixed(2)}`).join(", ");
  console.log(`Reasons to reject (flagged at ${REJECT_THRESHOLD}): ${shown} → ${flagged.length === 0 ? "none flagged" : `flagged: ${flagged.join(", ")}`}\n`);

  console.log(`Starting points (CLIP misses view 1 and gets it by view ${Math.floor((n - 1) / 2) + 1}):`);
  if (result.suggestions.length === 0) console.log("  none on the grid; try --focus by hand, or --grid 7");
  result.suggestions.forEach((s, i) => {
    console.log(`  ${i + 1}. ${focusArg(s.focus)}  solved at ${view(s.solvedLevel, n)}; first view: ${guesses(s.levels[0]!, 2)}`);
  });

  if (src.focus !== undefined) {
    const at = result.grid.at(-1)!;
    console.log(`\nAt ${focusArg(at.focus)}:`);
    printFocus(at, src.zoomLevels);
  }
  const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
  console.log(`\nTook ${seconds(performance.now() - started)}: ${seconds(loaded - started)} to load, ${seconds(performance.now() - loaded)} for the photo.`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
