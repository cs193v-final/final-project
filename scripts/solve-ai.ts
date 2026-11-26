// Beat the AI's solver (#56, #66, by solve time #257): CLIP watches every
// puzzle's effect clear up on its stored photo, a frame every half second of
// the round's clock, and writes the first time it gets it right into
// `aiSolvedSeconds`, in the content files and the database. Run it after the
// final `npm run db:seed`, before content is loaded into production:
//
//   npm run clip:install                    once: CLIP's own install (about 735 MB)
//   npm run db:solve-ai -- --dry-run        print what CLIP gets, write nothing
//   npm run db:solve-ai                     practice pack + every file in content/
//   npm run db:solve-ai -- path/to/a.json   practice pack + these files or folders
//   npm run db:solve-ai -- --show-guesses   also print CLIP's guesses at each frame
//
// Takes the same content as `db:seed`, and the same database
// (DATABASE_URL_UNPOOLED, else the dev database in .env.local). The practice
// pack is always included; its answers are public, so src/puzzles/sample.json
// gets its times too and is committed. Every other content file must be
// outside the repo or git-ignored, like content/.
//
// By default it prints only puzzle ids, effects and times: with
// --show-guesses the output names answers, so don't paste it into an issue or
// PR. Safe to run again: it only writes what changed. About 35 s to load CLIP
// and read the labels, then about a quarter of a second per frame: it stops
// once CLIP gets a puzzle, so up to about 13 s for one it never gets, and all
// the content takes 10 to 15 minutes. See src/images/clip/ for the model and
// the labels, and src/game/effects/ for the frames.
//
// Runs directly in Node 24 (type stripping), so imports keep their `.ts`.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";

import { combineContent, parseContent, type Content } from "../src/game/packs.ts";
import { parsePuzzles } from "../src/game/puzzles.ts";
import { createClassifier } from "../src/images/clip/analyze.ts";
import { isDownloaded, loadClip } from "../src/images/clip/model.ts";
import { cachedTexts, formatJson, saveAiSolvedSeconds, setAiSolvedSeconds, solvePuzzles } from "./ai-solver.ts";
import { connect } from "./seed-db.ts";

const root = resolve(import.meta.dirname, "..");
// npm runs scripts from the repo root; INIT_CWD is where the command was typed.
const cwd = process.env.INIT_CWD ?? process.cwd();

type File = { path: string; json: unknown; content: Content };

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${relative(cwd, path)}: not valid JSON (${error instanceof Error ? error.message : error})`);
  }
}

/** Files to load: each path given (a folder means every .json directly in it). The same rule as scripts/seed.ts. */
function contentFiles(paths: string[]): string[] {
  return paths.flatMap((path) => {
    const full = resolve(cwd, path);
    if (!existsSync(full)) throw new Error(`${path}: no such file or folder`);
    if (!statSync(full).isDirectory()) return [full];
    return readdirSync(full)
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => join(full, name));
  });
}

/**
 * Private content must not be committable: outside the repo, or git-ignored,
 * after following symlinks. The same rule as scripts/seed.ts (security audit
 * L8, #95); the solver writes into these files, so it checks them too.
 */
function assertNotCommittable(file: string) {
  const rel = relative(realpathSync(root), realpathSync(file));
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return;
  try {
    execFileSync("git", ["check-ignore", "-q", rel], { cwd: root, stdio: "pipe" });
  } catch (error) {
    if ((error as { status?: number }).status === 1) {
      throw new Error(`${rel}: private content can't live in the repo unless it's git-ignored. Move it to content/ or outside the repo.`);
    }
    throw new Error(`${rel}: couldn't ask git whether it's ignored: ${String((error as { stderr?: unknown }).stderr ?? error).trim()}`);
  }
}

function load(paths: string[]): File[] {
  const practice = join(root, "src/puzzles");
  const samplePath = join(practice, "sample.json");
  const packPath = join(practice, "practice-pack.json");
  const sample = readJson(samplePath);
  const files: File[] = [
    { path: samplePath, json: sample, content: { packs: [], puzzles: parsePuzzles(sample), schedule: [] } },
    { path: packPath, json: null, content: parseContent(readJson(packPath), "practice-pack.json") },
  ];
  for (const path of contentFiles(paths)) {
    assertNotCommittable(path);
    const json = readJson(path);
    files.push({ path, json, content: parseContent(json, relative(cwd, path)) });
  }
  return files;
}

async function main() {
  const { values, positionals } = parseArgs({
    options: { "dry-run": { type: "boolean", default: false }, "show-guesses": { type: "boolean", default: false } },
    allowPositionals: true,
  });
  // `npm run db:solve-ai --dry-run` (no `--`) gives the flag to npm; treat it as a dry run too.
  const dryRun = values["dry-run"] || process.env.npm_config_dry_run === "true";
  const defaultDir = join(root, "content");
  const files = load(positionals.length > 0 ? positionals : existsSync(defaultDir) ? [defaultDir] : []);
  const content = combineContent(files.map((f) => ({ source: relative(cwd, f.path), content: f.content })));
  console.log(`${content.puzzles.length} puzzles in ${files.length - 2} content file(s) plus the practice pack.`);

  if (process.env.DATABASE_URL_UNPOOLED === undefined && existsSync(join(root, ".env.local"))) {
    process.loadEnvFile(join(root, ".env.local"));
  }
  const url = process.env.DATABASE_URL_UNPOOLED;
  if (!url) throw new Error("DATABASE_URL_UNPOOLED is not set (see TECHNICAL.md → Content).");
  const { db, close } = await connect(url, "DATABASE_URL_UNPOOLED");
  try {
    if (!isDownloaded()) console.log("Downloading CLIP, about 610 MB (first run only)…");
    const model = cachedTexts(await loadClip());
    const solved = await solvePuzzles(db, content, (labels) => createClassifier(model, labels));
    const times = new Map([...solved].map(([id, s]) => [id, s.aiSolvedSeconds]));

    const time = (seconds: number | null) => (seconds === null ? "never" : `${seconds} s`);
    for (const puzzle of content.puzzles) {
      const { aiSolvedSeconds, steps } = solved.get(puzzle.id)!;
      const before = puzzle.aiSolvedSeconds ?? null;
      const was = before === aiSolvedSeconds ? "" : `  (was: ${before === null ? "never, or not run" : time(before)})`;
      console.log(`${puzzle.id}: ${time(aiSolvedSeconds)} (${puzzle.effect ?? "no effect chosen"})${was}`);
      if (values["show-guesses"]) {
        for (const s of steps) console.log(`    ${time(s.seconds)}: ${s.top.slice(0, 3).map((g) => `${g.label} ${Math.round(g.probability * 100)}%`).join(", ")}`);
      }
    }
    // A day should mix difficulty (#182): a spread of solve times, not five that are the same.
    const dateOf = new Map(content.schedule.map((e) => [e.packId, e.date]));
    for (const pack of content.packs) {
      const packTimes = pack.puzzleIds.map((id) => time(times.get(id) ?? null));
      console.log(`Pack ${pack.id}${dateOf.has(pack.id) ? ` (${dateOf.get(pack.id)})` : ""}: ${packTimes.join(", ")}`);
    }

    if (dryRun) {
      console.log("Dry run: no file or database changed.");
      return;
    }
    // Files first: they're what a later seed reads, so a run that stops after
    // this is still right after the next seed, and running again finishes it.
    for (const file of files) {
      if (file.json === null || setAiSolvedSeconds(file.json, times).length === 0) continue;
      writeFileSync(file.path, formatJson(file.json));
      const committed = relative(root, file.path).startsWith(`src${sep}puzzles${sep}`);
      console.log(`Wrote ${relative(cwd, file.path)}.${committed ? " It's the practice pack: commit it." : ""}`);
    }
    const changed = await saveAiSolvedSeconds(db, times);
    console.log(`Updated aiSolvedSeconds of ${changed.length} puzzle(s) in the database (${times.size - changed.length} unchanged).`);
  } finally {
    await close();
  }
}

try {
  await main();
} catch (error) {
  // The database's own error (missing table, wrong password) is in `cause`.
  // The solver's queries only carry puzzle ids, image ids and solve times, never answers.
  let current: unknown = error;
  for (let depth = 0; current !== undefined && depth < 5; depth++) {
    console.error(depth === 0 ? String(current instanceof Error ? current.message : current) : `Caused by: ${current instanceof Error ? current.message : current}`);
    current = current instanceof Error ? current.cause : undefined;
  }
  process.exitCode = 1;
}
