import { combineContent, parseContent } from "../game/packs.ts";
import { parsePuzzles } from "../game/puzzles.ts";
import type { Pack } from "../game/types.ts";
import practicePack from "./practice-pack.json";
import sample from "./sample.json";

/**
 * The three practice puzzles (#17). Validated when this module loads, so bad
 * data fails the build and the tests instead of breaking a round. Images live
 * in `public/puzzles/`; each puzzle's `credit` records its source and license.
 *
 * This is the only content in the repo (#52). Daily, Stanford and lobby
 * puzzles are loaded into the database by the seed script, never committed.
 */
export const SAMPLE_PUZZLES = parsePuzzles(sample);

/**
 * The practice pack (#52), over `SAMPLE_PUZZLES`. Its id is the one #54 already
 * uses for its `packs` row. The seed script loads the same two files into the
 * database, so the practice puzzles get `puzzles` rows like any other pack.
 */
export const PRACTICE_CONTENT = combineContent([
  { source: "practice-pack.json", content: parseContent(practicePack, "practice-pack.json") },
  { source: "sample.json", content: { packs: [], puzzles: SAMPLE_PUZZLES, schedule: [] } },
]);

export const PRACTICE_PACK: Pack = PRACTICE_CONTENT.packs[0]!;
