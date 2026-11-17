// Seed script (#52): loads packs, puzzles and the daily schedule into Neon.
// See TECHNICAL.md → Content for who runs it, when, and where content lives.
//
//   npm run db:seed -- --dry-run            check content, touch no database
//   npm run db:seed                          practice pack + every file in content/
//   npm run db:seed -- path/to/a.json dir/   practice pack + these files or folders
//
// The practice pack (src/puzzles/) is always included. Every other content
// path must be outside the repo or git-ignored (like content/), so private
// answers can't be committed by accident. Safe to run again.
//
// Runs directly in Node 24 (type stripping), so imports keep their `.ts`.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";

import { seedContent } from "../src/db/content.ts";
import { combineContent, parseContent, type Content } from "../src/game/packs.ts";
import { parsePuzzles } from "../src/game/puzzles.ts";
import { connect } from "./seed-db.ts";

const root = resolve(import.meta.dirname, "..");
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

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
    const full = resolve(path);
    if (!existsSync(full)) throw new Error(`${path}: no such file or folder`);
    if (!statSync(full).isDirectory()) return [full];
    return readdirSync(full)
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => join(full, name));
  });
}

/** Private content must not be committable: outside the repo, or git-ignored. */
function assertNotCommittable(file: string) {
  const inRepo = relative(root, file);
  if (inRepo.startsWith("..")) return;
  try {
    execFileSync("git", ["check-ignore", "-q", file], { cwd: root });
  } catch {
    throw new Error(
      `${inRepo}: private content can't live in the repo unless it's git-ignored. Move it to content/ or outside the repo.`,
    );
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    options: { "dry-run": { type: "boolean", default: false } },
    allowPositionals: true,
  });
  const defaultDir = join(root, "content");
  const paths = positionals.length > 0 ? positionals : existsSync(defaultDir) ? [defaultDir] : [];

  const files = contentFiles(paths);
  files.forEach(assertNotCommittable);
  const content = combineContent([
    ...practiceContent(),
    ...files.map((file) => {
      const source = relative(process.cwd(), file);
      return { source, content: parseContent(readJson(file), source) };
    }),
  ]);

  const kinds = content.packs.map((p) => `${p.kind} "${p.title}"`).join(", ");
  console.log(
    `Checked ${files.length} content file(s) plus the practice pack: ${content.puzzles.length} puzzles, ` +
      `${content.packs.length} packs (${kinds}), ${content.schedule.length} scheduled days.`,
  );
  if (values["dry-run"]) {
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

  const { db, close } = await connect(url);
  try {
    const summary = await seedContent(db, content);
    console.log(
      `Seeded ${summary.puzzles} puzzles, ${summary.packs} packs (${summary.packOrders} with a new or changed ` +
        `puzzle list) and ${summary.schedule} scheduled days.`,
    );
  } finally {
    await close();
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
