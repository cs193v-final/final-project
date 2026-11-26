// Shared game types. Each one has an owner (see PROJECT_BRIEF.md); change a type
// only through a PR that its owner reviews.
//
// These started as the PROPOSALs in the brief. Types owned by someone else are
// copied here unchanged so the guessing and round logic can compile; their
// owners make the final call.

/**
 * Owner: Joseph. Finalized in #17; validated by `parsePuzzle` in `puzzles.ts`.
 * Server-only once games run on the server (#54): it holds the answer.
 *
 * #52: `id` is opaque (never contains the answer, checked by `findAnswerLeaks`
 * in `packs.ts`), and `aiSolvedLevel` was added for Beat the AI (#56).
 * How `imageUrl` works once each zoom level is its own image is #57 (Darian);
 * until then it's the full image.
 */
export type Puzzle = {
  id: string; // opaque, e.g. "pz-7c1e9a40"; lowercase letters, digits, "-" and "_"
  imageUrl: string; // file in the app's static assets, or a URL
  answer: string; // canonical answer, shown after the round
  acceptedAnswers: string[]; // alternates, compared after normalization
  reveal: {
    focus: { x: number; y: number }; // crop center, 0–1 fractions of width/height
    zoomLevels: number[]; // e.g. [8, 4, 2, 1]: index 0 = tightest crop, last = full image
  };
  credit: { source: string; license: string; url?: string }; // image source + usage permission
  aiSolvedLevel: RevealLevel | null; // first reveal level the AI solved it at (#56); null = never, or not run yet
  /**
   * Timed-reveal redesign (PROPOSAL): how this photo is hidden while the
   * round's clock runs, chosen per puzzle to suit the photo. Zoom, spotlight
   * and swirl centre on `reveal.focus`. Missing = not chosen yet.
   */
  effect?: PuzzleEffect;
};

/**
 * Owner: Joseph. PROPOSAL (timed-reveal redesign). The ways a photo can be
 * hidden at the start of a round; each clears up as the clock runs. The
 * effects themselves are drawn by the round screen. `EFFECTS` in
 * `puzzles.ts` lists them for the parser and the database check.
 */
export type PuzzleEffect = "pixelate" | "spotlight" | "thermal" | "swirl" | "zoom" | "tiles";

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

/**
 * Owner: Jacky. Timed rounds (#255): ready → (start) playing → correct |
 * timedOut → (next) the next puzzle's ready. `ready` is before the clock
 * starts (no photo yet); `timedOut` is a round that reached the time limit.
 */
export type RoundState = "ready" | "playing" | "correct" | "timedOut";

/**
 * Emitted by Jacky's round logic, consumed by Ethan's scoring (#255, #256).
 * `seconds` is the server's own elapsed time for the round, never one the
 * browser sent. The old `reveal` and `skip` events went with the redesign.
 */
export type ScoringEvent =
  | { type: "wrongGuess"; puzzleId: string }
  | { type: "correct"; puzzleId: string; seconds: number }
  | { type: "timeOut"; puzzleId: string };

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

/**
 * Owner: Ethan. PROPOSAL (timed-reveal redesign, #254/#256). Point values for
 * a timed round: the score starts at `maxPoints` and drains to `minPoints`
 * along a curve until the photo is clear at `revealSeconds`, stays at
 * `minPoints` until `limitSeconds`, then the round ends with 0. Will replace
 * `ScoringConfig` once the server (#255) and the round screen use it.
 * The values in use live in `scoring-config.ts`.
 */
export type TimedScoringConfig = {
  maxPoints: number; // a correct guess at 0 s
  minPoints: number; // a correct guess once the photo is clear
  revealSeconds: number; // when the photo is fully clear
  limitSeconds: number; // when the round ends with 0
  curve: number; // exponent: 1 drains evenly, higher drains faster early on
};

/**
 * Owner: Ethan. The score for one finished timed round: #256's shape (points,
 * seconds, wrong guesses; no reveal or penalty breakdown). Changed in #255,
 * where the server starts scoring by time.
 */
export type RoundResult = {
  puzzleId: string;
  outcome: "correct" | "timedOut";
  /** Server time from the start to the correct guess; `limitSeconds` for a time-out. */
  seconds: number;
  wrongGuesses: number; // counted for stats; they cost nothing
  points: number; // scoreAt(seconds, scoring) when correct, 0 when timed out
};

// ---------------------------------------------------------------------------
// Week 9 plan (#46): PROPOSALs for the server-side game, packs, accounts and
// leaderboards. Types only. The owner of each type makes the final call; change
// one only through a PR that its owner reviews. `PackKind`, `Pack` and
// `DailyEntry` are settled in #52 and validated by `parseContent` (`packs.ts`).
// ---------------------------------------------------------------------------

/** Owner: Joseph. Settled (#52). Which mode a pack belongs to. */
export type PackKind = "practice" | "daily" | "stanford" | "lobby";

/** Owner: Joseph. Settled (#52). A set of puzzles played together, in order. */
export type Pack = {
  id: string; // opaque; never derived from the theme or the answers
  kind: PackKind;
  title: string; // e.g. "Landmarks"
  theme: string; // shown before play (open decision: hide it for a bonus?)
  puzzleIds: string[]; // play order; usually 5
  scoring?: ScoringConfig; // per-pack override (type: Ethan; storage: Jacky, #64); default when absent. Set with `npm run db:scoring`, not by the seed script.
};

/** Owner: Joseph. Settled (#52). Which pack is a given day's daily challenge. */
export type DailyEntry = {
  date: string; // "YYYY-MM-DD" in the reset time zone: midnight America/Los_Angeles (#58, DEFAULT_DAILY_RESET)
  packId: string;
};

/**
 * Owner: Jacky. PROPOSAL (#54). Everything a player can do in a game.
 *
 * Moved here from `round.ts` (which re-exports it) so the browser and the
 * server share one definition. The field is `guess`, as `step` already uses.
 */
export type GameAction =
  | { type: "start" } // starts the current round's clock (#255)
  | { type: "guess"; guess: string }
  | { type: "next" };

/**
 * Owner: Jacky (`aiSolvedLevel`: Darian). PROPOSAL (#54; timed rounds, #255).
 * Everything the browser may see about the current puzzle. No answer until
 * the round is over, and no photo until its clock has started.
 */
export type PublicRound = {
  position: number; // 1-based
  puzzleCount: number;
  state: RoundState;
  /**
   * The round's time on the server's clock when this view was made: null
   * while `ready`; while `playing`, the time so far (the browser counts on
   * from it with its own clock, so a wrong device clock doesn't matter); once
   * the round is over, its final time (as in its `RoundResult`).
   */
  elapsedSeconds: number | null;
  /** The full photo, only once the round has started (never while `ready`). The browser draws `effect` over it. */
  imageSrc?: string;
  effect: PuzzleEffect | null; // null = not chosen yet (#258); the screen picks one
  focus: { x: number; y: number }; // `Puzzle.reveal.focus`: where zoom, spotlight and swirl centre
  scoring: TimedScoringConfig; // what this game is scored with, so the live score is the server's
  wrongGuesses: number; // counted, but they cost nothing
  aiSolvedLevel: RevealLevel | null; // Darian (Beat the AI, #56); becomes a solve time in #257
  answer?: string; // only once the round is over (correct or timedOut)
  credit?: Puzzle["credit"]; // only once the round is over
};

/** Owner: Jacky. PROPOSAL (#54). Returned by every game call (`startGame`, `act`, `getGame`). */
export type GameView = {
  gameId: string;
  /** The stored game's revision. The client sends it back with each action, so one from a stale tab is rejected (#107). */
  revision: number;
  pack: Pick<Pack, "id" | "kind" | "title" | "theme">;
  round: PublicRound | null; // null once the game is over
  lastOutcome?: GuessOutcome;
  results: RoundResult[]; // finished rounds so far, scored on the server
  total: number;
  finished: boolean;
  /**
   * Once the whole game is finished (never while a round is played, #54): each
   * image's answer, index = position - 1, so a result loaded later (a reload,
   * the daily the next visit) can name the images (#58).
   */
  answers?: string[];
  /** Darian (Beat the AI, #66): once the whole game is finished, how many images the player beat the AI on. */
  beatAi?: BeatAiSummary;
};

/**
 * Owner: Darian. PROPOSAL (#66). A finished game against the AI: images the
 * player got right at an earlier view than the AI did, of the images the AI
 * has a result for (`aiSolvedLevel` not null). The rule is `aiVerdict` in
 * `beat-ai.ts`.
 */
export type BeatAiSummary = { beaten: number; played: number };

/** Owner: Ethan. PROPOSAL (#53). What other code and the browser may know about a user. */
export type PublicUser = { id: string; username: string };

/** Owner: Ethan. PROPOSAL (#62). One row of a leaderboard. */
export type LeaderboardEntry = {
  rank: number;
  username: string;
  score: number;
  beatAiCount: number;
};
