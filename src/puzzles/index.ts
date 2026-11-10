import { parsePuzzles } from "../game/puzzles.ts";
import sample from "./sample.json";

/**
 * The three practice puzzles (#17). Validated when this module loads, so bad
 * data fails the build and the tests instead of breaking a round. Images live
 * in `public/puzzles/`; each puzzle's `credit` records its source and license.
 */
export const SAMPLE_PUZZLES = parsePuzzles(sample);
