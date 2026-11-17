// Cut command (#57 follow-up, #58): store each seeded puzzle's zoom levels as
// their own images, so the game only ever sends the level a player reached.
// See TECHNICAL.md → Images per zoom level.
//
//   npm run db:cut-images -- --dry-run      list what would be cut
//   npm run db:cut-images                    cut every puzzle without current cuts
//   npm run db:cut-images -- --force [ids]   re-cut, all or just these puzzles
//
// Run it after `npm run db:seed`, from the computer that has the private
// content (`content/`), because it reads each puzzle's image from its
// `imageUrl`. Safe to run again: puzzles with current cuts are skipped, and a
// puzzle whose image, focus or zoom changed is cut again. The practice pack is
// skipped: its images are public and the browser crops them itself.
//
// Runs directly in Node 24 (type stripping), so imports keep their `.ts`.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { cutPuzzleImages } from "./cut-images-core.ts";
import { connect } from "./seed-db.ts";

const root = resolve(import.meta.dirname, "..");

async function main() {
  const { values, positionals } = parseArgs({
    options: { "dry-run": { type: "boolean", default: false }, force: { type: "boolean", default: false } },
    allowPositionals: true,
  });
  // `npm run db:cut-images --dry-run` (no `--`) gives the flag to npm; treat it as a dry run too.
  const dryRun = values["dry-run"] || process.env.npm_config_dry_run === "true";

  // Same rule as the seed script and drizzle.config.ts.
  if (process.env.DATABASE_URL_UNPOOLED === undefined && existsSync(join(root, ".env.local"))) {
    process.loadEnvFile(join(root, ".env.local"));
  }
  const url = process.env.DATABASE_URL_UNPOOLED;
  if (!url) throw new Error("DATABASE_URL_UNPOOLED is not set (see TECHNICAL.md → Images per zoom level).");

  const practice = JSON.parse(readFileSync(join(root, "src/puzzles/practice-pack.json"), "utf8")) as {
    packs: { puzzleIds: string[] }[];
  };
  const skip = new Set(practice.packs.flatMap((p) => p.puzzleIds));

  const { db, close } = await connect(url);
  try {
    const report = await cutPuzzleImages(db, { root, force: values.force, only: positionals, skip, dryRun });
    const verb = dryRun ? "Would cut" : "Cut";
    console.log(`${verb} ${report.cut.length} puzzle(s); ${report.current.length} already current.`);
    for (const id of report.cut) console.log(`  ${dryRun ? "would cut" : "cut"} ${id}`);
    for (const { id, problem } of report.failed) console.error(`  FAILED ${id}: ${problem}`);
    if (report.failed.length > 0) process.exitCode = 1;
  } finally {
    await close();
  }
}

try {
  await main();
} catch (error) {
  let current: unknown = error;
  for (let depth = 0; current !== undefined && depth < 5; depth++) {
    const message = current instanceof Error ? current.message : String(current);
    console.error(depth === 0 ? message : `Caused by: ${message}`);
    current = current instanceof Error ? current.cause : undefined;
  }
  process.exitCode = 1;
}
