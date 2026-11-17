// Preview a puzzle's zoom levels as the game will cut them (#57), to check
// every level by eye before it goes into a pack (#34, #55):
//
//   npm run images:preview -- --puzzle <practice id>               a practice puzzle (sample.json)
//   npm run images:preview -- photo.jpg --focus 0.4,0.66 --zoom 10,5,2.5,1
//   npm run images:preview -- photo.jpg --focus 0.4,0.66 --zoom 20,8,3,1 --out ~/previews
//
// Writes level-0.webp (tightest) … level-N.webp (whole image) and prints each
// level's size. It also says when a level will look soft on a high-resolution
// (2×) phone or laptop screen, which means the original is too small for that
// zoom. Without --out it writes to a new temporary folder. It never writes
// inside the repo unless that folder is git-ignored, so previews of private
// content can't be committed by accident.
//
// Runs directly in Node 24 (type stripping), so imports keep their `.ts`.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";

import { planLevels } from "../src/game/levels.ts";
import type { Puzzle } from "../src/game/types.ts";
import { cutLevels } from "../src/images/cut.ts";

const root = resolve(import.meta.dirname, "..");

/** The viewer is at most 448 CSS px wide; a 2× screen shows that as 896 real pixels. */
const SHARP_WIDTH = 448 * 2;

function numbers(value: string, name: string): number[] {
  const list = value.split(",").map(Number);
  if (list.length === 0 || list.some((n) => !Number.isFinite(n))) throw new Error(`--${name} must be numbers separated by commas`);
  return list;
}

/** The image file and reveal settings to preview, from --puzzle or from a path plus --focus/--zoom. */
function source(args: { puzzle?: string; focus?: string; zoom?: string }, positionals: string[]): { file: string; reveal: Puzzle["reveal"] } {
  if (args.puzzle !== undefined) {
    // Read as is: sample.json is checked by parsePuzzles in the tests. (Importing
    // puzzles.ts here needs #52's change before Node can run it directly.)
    const puzzles = JSON.parse(readFileSync(join(root, "src/puzzles/sample.json"), "utf8")) as Puzzle[];
    const puzzle = puzzles.find((p) => p.id === args.puzzle);
    if (!puzzle) throw new Error(`no practice puzzle "${args.puzzle}" (ids: ${puzzles.map((p) => p.id).join(", ")})`);
    return { file: join(root, "public", puzzle.imageUrl), reveal: puzzle.reveal };
  }
  const [file] = positionals;
  if (file === undefined || args.focus === undefined || args.zoom === undefined) {
    throw new Error("give --puzzle <practice id>, or an image path with --focus x,y and --zoom levels (e.g. 10,5,2.5,1)");
  }
  const [x, y] = numbers(args.focus, "focus");
  if (x === undefined || y === undefined) throw new Error("--focus must be x,y");
  return { file: resolve(file), reveal: { focus: { x, y }, zoomLevels: numbers(args.zoom, "zoom") } };
}

/** `path` with symlinks resolved, even if it doesn't exist yet: resolves the nearest existing parent. */
function realPath(path: string): string {
  if (existsSync(path)) return realpathSync(path);
  const parent = dirname(path);
  return parent === path ? path : join(realPath(parent), basename(path));
}

/**
 * Previews of private content mustn't land somewhere git would commit them.
 * Paths are compared after resolving symlinks, and only a real `..` step
 * counts as outside the repo, so a folder named `..previews` inside it is
 * still checked (security audit L8, #95; the same rule as scripts/seed.ts).
 */
function assertNotCommittable(dir: string) {
  const rel = relative(realpathSync(root), realPath(dir));
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return;
  try {
    execFileSync("git", ["check-ignore", "-q", rel === "" ? "." : rel], { cwd: root, stdio: "pipe" });
  } catch (error) {
    if ((error as { status?: number }).status === 1) {
      throw new Error(`${rel || "."}: inside the repo and not git-ignored. Use --out outside the repo, or content/.`);
    }
    throw new Error(`${rel || "."}: couldn't ask git whether it's ignored: ${String((error as { stderr?: unknown }).stderr ?? error).trim()}`);
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    options: { puzzle: { type: "string" }, focus: { type: "string" }, zoom: { type: "string" }, out: { type: "string" } },
    allowPositionals: true,
  });
  const { file, reveal } = source(values, positionals);
  const out = values.out === undefined ? mkdtempSync(join(tmpdir(), "zoom-out-levels-")) : resolve(values.out);
  assertNotCommittable(out);
  mkdirSync(out, { recursive: true });

  const original = new Uint8Array(readFileSync(file));
  const levels = await cutLevels(original, reveal);
  const sharp = (await import("sharp")).default;
  const { width = 0, height = 0, orientation } = await sharp(original).metadata();
  const upright = orientation !== undefined && orientation >= 5 ? { width: height, height: width } : { width, height };
  const plan = planLevels(upright, reveal);

  console.log(`${relative(process.cwd(), file)}: ${upright.width}×${upright.height}, zoom ${reveal.zoomLevels.join(", ")}`);
  for (const level of levels) {
    const name = `level-${level.level}.webp`;
    writeFileSync(join(out, name), level.bytes);
    const crop = plan[level.level]!.crop;
    const soft = crop.width < SHARP_WIDTH ? `  soft on a 2× screen: ${crop.width} px of the original stretched to ${SHARP_WIDTH}` : "";
    console.log(
      `  ${name}  ${level.width}×${level.height}  ${Math.round(level.bytes.byteLength / 1024)} KB  (${crop.width}×${crop.height} px of the original)${soft}`,
    );
  }
  console.log(`Wrote ${levels.length} levels to ${out}`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
