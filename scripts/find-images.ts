// Image picker, step 1 (#179): find and download openly licensed photo
// candidates for a theme, for a person to review (#180).
//
//   npm run images:find -- --theme <theme> --answers "<answer>,<answer>,…"
//   npm run images:find -- --theme <theme> --answers "<answer>" --per-answer 8 --pages 8
//
// For each answer it searches Openverse (Wikimedia Commons, the only source
// whose full-size originals it links) and saves up to
// --per-answer photos (default 6) to content/candidates/<theme>/, named with
// random pz- ids, plus their credits in candidates.json there. Run it again to
// add more: photos already saved are skipped. --out puts them somewhere else,
// which must be outside the repo or git-ignored: nothing it downloads is ever
// committed (the repo is public).
//
// Filters (src/images/openverse.ts): CC0, Public Domain Mark, CC BY and
// CC BY-SA only (no NC or ND: cropping is a change); at least --min-width px
// wide (default 3000); JPEG files only; not marked mature or sensitive; BY and BY-SA need a
// named creator. Credits of BY and BY-SA photos say "cropped".
//
// Rate limits: one request at a time, a pause between requests (--pause-ms,
// default 1500), and a back-off on HTTP 429 or 503. Anonymous Openverse use
// allows about 100 requests a minute and 1,000 a day, which is plenty for a
// few themes a day. No token is used. If we ever add one, it goes only in
// .env.local, and a person records it in SECRETS.md and COST-CONTROLS.md.
//
// Never write real daily or Stanford answers in issues or PRs.
//
// Runs directly in Node 24 (type stripping), so imports keep their `.ts`.

import { isAbsolute, join, resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  DEFAULT_MIN_WIDTH,
  findCandidates,
  realSleep,
  themeSlug,
  type Fetch,
} from "../src/images/openverse.ts";
import { assertNotCommittable, REPO_ROOT } from "./not-committable.ts";

const USAGE = 'Usage: npm run images:find -- --theme <theme> --answers "<answer>,<answer>" [--per-answer 6] [--pages 5] [--min-width 3000] [--out <folder>]';

function positiveInt(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--${name} must be a whole number of at least 1`);
  return n;
}

export async function main(argv: string[], fetchFn: Fetch = fetch): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      theme: { type: "string" },
      answers: { type: "string" },
      "per-answer": { type: "string" },
      pages: { type: "string" },
      "min-width": { type: "string" },
      "pause-ms": { type: "string" },
      out: { type: "string" },
    },
  });
  if (values.theme === undefined || values.answers === undefined) {
    console.error(USAGE);
    return 2;
  }
  const answers = values.answers.split(",").map((a) => a.trim()).filter((a) => a !== "");
  if (answers.length === 0) throw new Error("--answers needs at least one answer");
  const outDir =
    values.out === undefined
      ? join(REPO_ROOT, "content", "candidates", themeSlug(values.theme))
      : isAbsolute(values.out)
        ? values.out
        : resolve(values.out);
  assertNotCommittable(outDir);

  const { saved, skipped } = await findCandidates({
    answers,
    outDir,
    perAnswer: positiveInt(values["per-answer"], 6, "per-answer"),
    maxPages: positiveInt(values.pages, 5, "pages"),
    minWidth: positiveInt(values["min-width"], DEFAULT_MIN_WIDTH, "min-width"),
    pauseMs: positiveInt(values["pause-ms"], 1500, "pause-ms"),
    fetch: fetchFn,
    sleep: realSleep,
    log: (line) => console.log(line),
  });
  console.log(`Saved ${saved.length} photo(s) to ${outDir} (${skipped} result(s) skipped by the filters).`);
  console.log("Next: review them (#180). Nothing in that folder is ever committed.");
  return 0;
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    },
  );
}
