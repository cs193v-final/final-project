// Shared game types. Each one has an owner (see PROJECT_BRIEF.md); change a type
// only through a PR that its owner reviews.
//
// These started as the PROPOSALs in the brief. Types owned by someone else are
// copied here unchanged so the guessing and round logic can compile; their
// owners make the final call.

/** Owner: Joseph. Finalized in #17 unchanged from the brief; validated by `parsePuzzle` in `puzzles.ts`. */
export type Puzzle = {
  id: string;
  imageUrl: string; // file in the app's static assets, or a URL
  answer: string; // canonical answer, shown after the round
  acceptedAnswers: string[]; // alternates, compared after normalization
  reveal: {
    focus: { x: number; y: number }; // crop center, 0–1 fractions of width/height
    zoomLevels: number[]; // e.g. [8, 4, 2, 1]: index 0 = tightest crop, last = full image
  };
  credit: { source: string; license: string; url?: string }; // image source + usage permission
};

/**
 * Owner: Darian. An integer from 0 (tightest crop) to
 * `puzzle.reveal.zoomLevels.length - 1` (full image).
 */
export type RevealLevel = number;

/**
 * Owner: Jacky. The result of checking one guess.
 *
 * Change from the brief's proposal: added `empty`, so a blank or
 * whitespace-only submission can be ignored instead of costing a wrong guess.
 */
export type GuessOutcome =
  | { kind: "correct"; matched: string } // which answer matched, as written in the puzzle
  | { kind: "incorrect"; normalizedGuess: string }
  | { kind: "empty" };

/** Owner: Jacky. playing → correct | skipped → next puzzle. */
export type RoundState = "playing" | "correct" | "skipped";

/** Emitted by Jacky's round logic, consumed by Ethan's scoring. Unchanged from the brief. */
export type ScoringEvent =
  | { type: "reveal"; puzzleId: string; revealLevel: RevealLevel }
  | { type: "wrongGuess"; puzzleId: string }
  | { type: "correct"; puzzleId: string; revealLevel: RevealLevel }
  | { type: "skip"; puzzleId: string };

/**
 * Owner: Ethan. Point values for scoring. Unchanged from the brief's proposal.
 * The values in use live in `scoring-config.ts`; they're placeholders for
 * playtesting (#21), not decided.
 */
export type ScoringConfig = {
  basePoints: number;
  revealPenalty: number; // per reveal step
  wrongGuessPenalty: number; // per wrong guess
  minPoints: number; // floor for a correct answer
  skipPoints: number;
};

/** Owner: Ethan. The score for one finished round. Unchanged from the brief's proposal. */
export type RoundResult = {
  puzzleId: string;
  outcome: "correct" | "skipped";
  revealLevelReached: number;
  wrongGuesses: number;
  points: number;
  breakdown: { base: number; revealPenalty: number; wrongGuessPenalty: number };
};

// ---------------------------------------------------------------------------
// Week 9 plan (#46): PROPOSALs for the server-side game, packs, accounts and
// leaderboards. Types only. The owner of each type makes the final call; change
// one only through a PR that its owner reviews. `Puzzle` changes (opaque `id`,
// `aiSolvedLevel`, per-level images) are planned in #52 and not made here yet.
// ---------------------------------------------------------------------------

/** Owner: Joseph. PROPOSAL (#52). Which mode a pack belongs to. */
export type PackKind = "practice" | "daily" | "stanford" | "lobby";

/** Owner: Joseph. PROPOSAL (#52). A set of puzzles played together, in order. */
export type Pack = {
  id: string; // opaque; never derived from the theme or the answers
  kind: PackKind;
  title: string; // e.g. "Landmarks"
  theme: string; // shown before play (open decision: hide it for a bonus?)
  puzzleIds: string[]; // play order; usually 5
  scoring?: ScoringConfig; // per-pack override (type: Ethan; storage: Jacky, #64); default when absent
};

/** Owner: Joseph. PROPOSAL (#52, #58). Which pack is a given day's daily challenge. */
export type DailyEntry = {
  date: string; // "YYYY-MM-DD" in the reset time zone (open decision; default America/Los_Angeles)
  packId: string;
};

/**
 * Owner: Jacky. PROPOSAL (#54). Everything a player can do in a game.
 *
 * Moved here from `round.ts` (which re-exports it) so the browser and the
 * server share one definition. The field is `guess`, as `step` already uses.
 */
export type GameAction =
  | { type: "reveal" }
  | { type: "guess"; guess: string }
  | { type: "skip" }
  | { type: "next" };

/**
 * Owner: Jacky (image fields: Darian). PROPOSAL (#54, #57).
 * Everything the browser may see about the current puzzle. No answer until the round ends.
 */
export type PublicRound = {
  position: number; // 1-based
  puzzleCount: number;
  state: RoundState;
  revealLevel: RevealLevel;
  levelCount: number;
  imageSrc: string; // Darian (#57): the image for revealLevel ONLY
  /**
   * TEMPORARY (#54 → #57, Darian): while each puzzle has one full image,
   * `imageSrc` is that image and the browser crops it with this (focus point
   * and zoom per level; no answer in it). Remove once `imageSrc` is the
   * per-level image.
   */
  reveal?: Puzzle["reveal"];
  wrongGuesses: number;
  pointsAvailable: number;
  aiSolvedLevel: RevealLevel | null; // Darian (Beat the AI, #56); null = the AI never got it
  answer?: string; // only once state !== "playing"
  credit?: Puzzle["credit"]; // only once state !== "playing"
};

/** Owner: Jacky. PROPOSAL (#54). Returned by every game call (`startGame`, `act`, `getGame`). */
export type GameView = {
  gameId: string;
  pack: Pick<Pack, "id" | "kind" | "title" | "theme">;
  round: PublicRound | null; // null once the game is over
  lastOutcome?: GuessOutcome;
  results: RoundResult[]; // finished rounds so far, scored on the server
  total: number;
  finished: boolean;
};

/** Owner: Ethan. PROPOSAL (#53). What other code and the browser may know about a user. */
export type PublicUser = { id: string; username: string };

/** Owner: Ethan. PROPOSAL (#62). One row of a leaderboard. */
export type LeaderboardEntry = {
  rank: number;
  username: string;
  score: number;
  beatAiCount: number;
};
