// Seed script (#52): loads packs, puzzles and the daily schedule into Neon.
// See TECHNICAL.md → Content for who runs it, when, and where content lives.
//
//   npm run db:seed -- --dry-run            check content, touch no database
//   npm run db:seed                          practice pack + every file in content/
//   npm run db:seed -- path/to/a.json dir/   practice pack + these files or folders
//   npm run db:seed -- --recut               also cut every puzzle's images again
//   npm run db:seed -- --no-images           seed without cutting images
//
// The practice pack (src/puzzles/) is always included. Every other content
// path must be outside the repo or git-ignored (like content/), so private
// answers can't be committed by accident. Safe to run again.
//
// After seeding, each puzzle is cut into one image per zoom level and stored
// (#57, ./seed-images.ts), unless it's already cut with the same image, focus
// and zoom levels.
//
// Runs directly in Node 24 (type stripping), so imports keep their `.ts`.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";

import { seedContent } from "../src/db/content.ts";
import { combineContent, parseContent, type Content } from "../src/game/packs.ts";
import { parsePuzzles } from "../src/game/puzzles.ts";
import { assertDatabaseUrlRequiresTls } from "../src/db/tls.ts";
import { connect } from "./seed-db.ts";
import { cutPuzzleImages, originalPath, storedImageSettings } from "./seed-images.ts";

const root = resolve(import.meta.dirname, "..");
// npm runs scripts from the repo root; INIT_CWD is where the command was typed,
// so relative paths mean what the person expects.
const cwd = process.env.INIT_CWD ?? process.cwd();

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${relative(cwd, path)}: not valid JSON (${error instanceof Error ? error.message : error})`);
  }
}

function practiceContent(): { source: string; content: Content }[] {
  const dir = join(root, "src/puzzles");
  return [
    { source: "practice-pack.json", content: parseContent(readJson(join(dir, "practice-pack.json")), "practice-pack.json") },
    { source: "sample.json", content: { packs: [], puzzles: parsePuzzles(readJson(join(dir, "sample.json"))), schedule: [] } },
  ];
}

/** Files to load: each path given (a folder means every .json directly in it). */
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

/** Whether `file` (after following symlinks) is inside the repo. */
function inRepo(file: string): string | null {
  const rel = relative(realpathSync(root), realpathSync(file));
  return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel) ? null : rel;
}

/**
 * Private content must not be committable: outside the repo, or git-ignored.
 * Symlinks are followed first, so `content/` linked to a shared drive counts as
 * outside the repo.
 */
function assertNotCommittable(file: string) {
  const rel = inRepo(file);
  if (rel === null) return;
  try {
    execFileSync("git", ["check-ignore", "-q", rel], { cwd: root, stdio: "pipe" });
  } catch (error) {
    if ((error as { status?: number }).status === 1) {
      throw new Error(
        `${rel}: private content can't live in the repo unless it's git-ignored. Move it to content/ or outside the repo.`,
      );
    }
    throw new Error(`${rel}: couldn't ask git whether it's ignored: ${String((error as { stderr?: unknown }).stderr ?? error).trim()}`);
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      "dry-run": { type: "boolean", default: false },
      recut: { type: "boolean", default: false },
      "no-images": { type: "boolean", default: false },
    },
    allowPositionals: true,
  });
  // `npm run db:seed --dry-run` (no `--`) gives the flag to npm, not to us;
  // npm then sets npm_config_dry_run. Treat that as a dry run too, never as a real seed.
  const dryRun = values["dry-run"] || process.env.npm_config_dry_run === "true";
  const defaultDir = join(root, "content");
  const paths = positionals.length > 0 ? positionals : existsSync(defaultDir) ? [defaultDir] : [];

  const files = contentFiles(paths);
  files.forEach(assertNotCommittable);
  // Which folder each content puzzle came from: its relative imageUrl is the
  // original photo, next to its file. Practice puzzles aren't in here.
  const contentDirOf = new Map<string, string>();
  const content = combineContent([
    ...practiceContent(),
    ...files.map((file) => {
      const source = relative(cwd, file);
      const parsed = parseContent(readJson(file), source);
      for (const p of parsed.puzzles) contentDirOf.set(p.id, dirname(file));
      return { source, content: parsed };
    }),
  ]);

  const kinds = content.packs.map((p) => `${p.kind} "${p.title}"`).join(", ");
  console.log(
    `Checked ${files.length} content file(s) plus the practice pack: ${content.puzzles.length} puzzles, ` +
      `${content.packs.length} packs (${kinds}), ${content.schedule.length} scheduled days.`,
  );
  if (dryRun) {
    console.log("Dry run: no database touched.");
    return;
  }

  // Same rule as drizzle.config.ts: a value in the environment wins, even an
  // empty one; only when it's unset, fall back to the dev database in .env.local.
  if (process.env.DATABASE_URL_UNPOOLED === undefined && existsSync(join(root, ".env.local"))) {
    process.loadEnvFile(join(root, ".env.local"));
  }
  const url = process.env.DATABASE_URL_UNPOOLED;
  if (!url) throw new Error("DATABASE_URL_UNPOOLED is not set (see TECHNICAL.md → Content).");
  // Same TLS rule as the app and drizzle.config.ts (#60): only a database on this machine may skip it.
  assertDatabaseUrlRequiresTls(url, "DATABASE_URL_UNPOOLED");

  const cutImages = !values["no-images"];
  // Find every original before touching the database, so a missing photo stops the seed cleanly.
  const originals = new Map(
    cutImages ? content.puzzles.map((p) => [p.id, originalPath(p, contentDirOf.get(p.id) ?? null, root)] as const) : [],
  );

  const { db, close } = await connect(url);
  try {
    // What the images were cut from before this seed, so changed puzzles are cut again.
    const before = cutImages ? await storedImageSettings(db, content.puzzles.map((p) => p.id)) : new Map();
    const summary = await seedContent(db, content);
    console.log(
      `Seeded ${summary.puzzles} puzzles, ${summary.packs} packs (${summary.packOrders} with a new or changed ` +
        `puzzle list) and ${summary.schedule} scheduled days.`,
    );
    if (cutImages) {
      const images = await cutPuzzleImages(db, content.puzzles, (p) => originals.get(p.id)!, { before, recut: values.recut });
      console.log(`Cut ${images.cut} puzzle(s) into level images (${images.alreadyCut} already cut).`);
    } else {
      console.log("Images not cut (--no-images): puzzles that aren't cut can't be played, except practice ones.");
    }
  } finally {
    await close();
  }
}

try {
  await main();
} catch (error) {
  // For a failed query, drizzle's message is the SQL; the database's own error
  // (missing table, wrong password) is in `cause`.
  let current: unknown = error;
  for (let depth = 0; current !== undefined && depth < 5; depth++) {
    const message = current instanceof Error ? current.message : String(current);
    console.error(depth === 0 ? message : `Caused by: ${message}`);
    current = current instanceof Error ? current.cause : undefined;
  }
  process.exitCode = 1;
}
