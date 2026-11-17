// Server-side games (#54): the browser sends a `GameAction` and gets back a
// `GameView`. Answers, accepted answers and scoring stay here.
//
// Framework-free on purpose (no React, Next or database imports), so it stays
// unit-testable. The Postgres store (#47) and the Route Handlers / Server
// Actions that call these functions are separate, server-only modules. Never
// import this file from a "use client" component: it handles full `Puzzle`s.
//
// Game rules are not reimplemented here: `step` (round.ts) runs the round,
// `checkGuess` (guess.ts, via `step`) checks guesses, and `scoreGame` /
// `pointsIfCorrect` (scoring.ts) turn the server's own scoring events into
// points. There is no way for a client to submit a score.

import { createGame, step, type Game, type Round } from "./round.ts";
import { pointsIfCorrect, scoreGame, validateScoringConfig } from "./scoring.ts";
import type {
  GameAction,
  GameView,
  GuessOutcome,
  Pack,
  PublicRound,
  Puzzle,
  ScoringConfig,
  ScoringEvent,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Owners
// ---------------------------------------------------------------------------

/**
 * Who a game belongs to: a logged-in user, or an anonymous visitor identified
 * by a server-issued id (e.g. from an httpOnly cookie). Whether anonymous play
 * is allowed is an open decision (#54, #62); this module supports both and
 * leaves the policy to the caller.
 */
export type GameOwner = { userId: string } | { anonId: string };

function sameOwner(a: GameOwner, b: GameOwner): boolean {
  if ("userId" in a) return "userId" in b && a.userId === b.userId;
  return "anonId" in b && a.anonId === b.anonId;
}

function checkOwner(owner: GameOwner): void {
  const id = "userId" in owner ? owner.userId : owner.anonId;
  if (typeof id !== "string" || id === "") throw new Error("GameOwner: id must be a non-empty string");
}

// ---------------------------------------------------------------------------
// Stored record
// ---------------------------------------------------------------------------

/**
 * Everything the server needs to resume a game: the round state machine's
 * state, every scoring event so far, and the scoring config the game started
 * with. Plain JSON (no Dates, Maps, classes or `undefined` fields), so it can
 * go straight into the `games.state` jsonb column (#47).
 *
 * Puzzles are referenced by id, not copied, so answers aren't duplicated into
 * every game row. Results and the total aren't stored either: they're always
 * recomputed from `events` with `scoring`.
 */
export type GameState = {
  /** Bump when this shape changes, so old rows can be migrated or rejected. */
  schemaVersion: 1;
  pack: GameView["pack"];
  /** Play order, copied from the pack when the game started. */
  puzzleIds: string[];
  /** Snapshot of the config at start, so tuning it (#64) doesn't rescore games in progress. */
  scoring: ScoringConfig;
  /** From round.ts `Game`: index of the current puzzle. */
  index: number;
  /** From round.ts `Game`. */
  round: Round;
  /** From round.ts `Game`. */
  finished: boolean;
  /** Every ScoringEvent `step` emitted, in order. The only input to scoring. */
  events: ScoringEvent[];
  /** Outcome of the last accepted action if it was a guess, else null. */
  lastOutcome: GuessOutcome | null;
};

/**
 * One stored game. `id`, `owner`, `packId` and `revision` are meant to be
 * their own columns (for lookups, ownership checks and leaderboards); `state`
 * is the jsonb payload.
 */
export type StoredGame = {
  id: string;
  owner: GameOwner;
  packId: string;
  /** Starts at 0 and goes up by 1 on every save. Used to reject concurrent writes. */
  revision: number;
  state: GameState;
};

export type NewStoredGame = Omit<StoredGame, "id" | "revision">;

/** Where games are kept. In-memory for tests; Postgres (#47) in the app. */
export interface GameStore {
  /** The game with this id, or null. Doesn't check the owner; the service does. */
  get(id: string): Promise<StoredGame | null>;
  /** Store a new game with a fresh, unguessable id and revision 0. */
  create(game: NewStoredGame): Promise<StoredGame>;
  /**
   * Replace a game's state if its stored revision still equals `game.revision`,
   * and return it with `revision + 1`. Otherwise throw `GameConflictError`
   * (another request changed it first). In SQL:
   * `UPDATE games SET state = $s, revision = revision + 1 WHERE id = $id AND revision = $rev`.
   */
  save(game: StoredGame): Promise<StoredGame>;
}

/** Looks up full puzzles (with answers) by id. Server-only. */
export interface PuzzleSource {
  /** The puzzles with these ids, in the same order. Throws if any is missing. */
  getPuzzles(ids: readonly string[]): Promise<Puzzle[]>;
}

/**
 * Where each puzzle's pre-cut level images are (#57): one `/img/<id>.webp`
 * URL per zoom level, tightest first. Server-only: the browser only ever gets
 * the URL of the level the player has reached.
 */
export interface LevelImageSource {
  /**
   * Each of these puzzles that has been cut, mapped to its level URLs in order:
   * a complete list from level 0, with no gaps. Puzzles not cut yet, or only
   * partly, are left out.
   */
  getLevelSrcs(puzzleIds: readonly string[]): Promise<ReadonlyMap<string, readonly string[]>>;
}

/**
 * What the game functions need. Without `levels` (tests of the game rules),
 * every puzzle is shown the old way: its one image, cropped in the browser.
 */
export type GameDeps = { games: GameStore; puzzles: PuzzleSource; levels?: LevelImageSource };

/**
 * Where the public practice images live (`public/puzzles/`, #52). Only these
 * may still be sent whole before they're cut (#57); anything else is private.
 */
const PUBLIC_IMAGE_PREFIX = "/puzzles/";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * No game with this id belongs to this owner. Also thrown when the game exists
 * but belongs to someone else, so callers can't tell the two apart (and
 * neither can the browser): respond 404 either way.
 */
export class GameNotFoundError extends Error {
  constructor() {
    super("Game not found");
    this.name = "GameNotFoundError";
  }
}

/** Another request saved this game first. Safe to reload and retry, or ask the player to refresh. */
export class GameConflictError extends Error {
  constructor(readonly gameId: string) {
    super(`Game ${gameId} was changed by another request`);
    this.name = "GameConflictError";
  }
}

/** A request body that isn't a valid `GameAction`. Respond 400. */
export class InvalidGameActionError extends Error {
  constructor(problem: string) {
    super(`Invalid game action: ${problem}`);
    this.name = "InvalidGameActionError";
  }
}

// ---------------------------------------------------------------------------
// Untrusted input
// ---------------------------------------------------------------------------

/** Longest guess accepted from a client. Far longer than any answer. */
export const MAX_GUESS_LENGTH = 200;

/**
 * Check untrusted input (e.g. a parsed request body) and return it as a
 * `GameAction`. Extra fields are dropped, so a client can't smuggle in a
 * score or a puzzle id. Throws `InvalidGameActionError`.
 */
export function parseGameAction(value: unknown): GameAction {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidGameActionError("must be an object");
  }
  const { type, guess } = value as Record<string, unknown>;
  switch (type) {
    case "reveal":
    case "skip":
    case "next":
      return { type };
    case "guess":
      if (typeof guess !== "string") throw new InvalidGameActionError("guess must be a string");
      if (guess.length > MAX_GUESS_LENGTH) {
        throw new InvalidGameActionError(`guess must be at most ${MAX_GUESS_LENGTH} characters`);
      }
      return { type, guess };
    default:
      throw new InvalidGameActionError("unknown type");
  }
}

// ---------------------------------------------------------------------------
// Projection: the only thing the browser ever gets
// ---------------------------------------------------------------------------

/**
 * The image fields of the current round (#57).
 * - **Cut** (the puzzle has one level image per zoom level): only the URL of
 *   the level reached, or the full image's level once the round is over. No
 *   `reveal`: each level is already its own picture.
 * - **Not cut yet:** a public practice image is still sent whole, with
 *   `reveal` for the browser to crop, as before #57. Any other puzzle throws,
 *   so a private daily or Stanford image is never sent whole.
 * - **No level source** (`levelSrcs` undefined, e.g. tests of the game
 *   rules): the old way, for every puzzle.
 */
function roundImage(
  puzzle: Puzzle,
  round: Round,
  levelSrcs: ReadonlyMap<string, readonly string[]> | undefined,
): Pick<PublicRound, "imageSrc" | "reveal"> {
  const srcs = levelSrcs?.get(puzzle.id);
  // `getLevelSrcs` only returns lists with no gaps, so the length says whether every level is cut.
  if (srcs !== undefined && srcs.length === round.maxRevealLevel + 1) {
    const level = round.state === "playing" ? round.revealLevel : round.maxRevealLevel;
    return { imageSrc: srcs[level]! };
  }
  if (levelSrcs !== undefined && !puzzle.imageUrl.startsWith(PUBLIC_IMAGE_PREFIX)) {
    throw new Error(`toGameView: puzzle ${puzzle.id} has no cut level images (run npm run db:seed)`);
  }
  return {
    imageSrc: puzzle.imageUrl,
    // Copied field by field, like everything here.
    reveal: {
      focus: { x: puzzle.reveal.focus.x, y: puzzle.reveal.focus.y },
      zoomLevels: [...puzzle.reveal.zoomLevels],
    },
  };
}

/**
 * Build the browser's view of a game. Pure. `puzzles` are the game's puzzles
 * in play order (`game.state.puzzleIds`). `levelSrcs` has the cut level images
 * of (at least) the current puzzle, from a `LevelImageSource`.
 *
 * Fields are copied one by one onto a fresh object, never spread from a
 * `Puzzle`, so new puzzle fields can't leak by accident. `answer` and `credit`
 * are added only once the round is over; accepted answers are never sent.
 */
export function toGameView(
  game: StoredGame,
  puzzles: readonly Puzzle[],
  levelSrcs?: ReadonlyMap<string, readonly string[]>,
): GameView {
  const { state } = game;
  checkPuzzlesMatch(state, puzzles);
  const { rounds, total } = scoreGame(state.events, state.scoring);

  let round: PublicRound | null = null;
  if (!state.finished) {
    const puzzle = puzzles[state.index];
    if (puzzle === undefined) throw new Error(`toGameView: game ${game.id} has no puzzle at ${state.index}`);
    const r = state.round;
    round = {
      position: state.index + 1,
      puzzleCount: puzzles.length,
      state: r.state,
      revealLevel: r.revealLevel,
      levelCount: r.maxRevealLevel + 1,
      ...roundImage(puzzle, r, levelSrcs),
      wrongGuesses: r.wrongGuesses,
      pointsAvailable: pointsIfCorrect(r.revealLevel, r.wrongGuesses, state.scoring),
      // Beat the AI (#56): the level the AI needed, not the answer. null = never, or not run yet.
      aiSolvedLevel: puzzle.aiSolvedLevel,
    };
    if (r.state !== "playing") {
      round.answer = puzzle.answer;
      round.credit = {
        source: puzzle.credit.source,
        license: puzzle.credit.license,
        ...(puzzle.credit.url === undefined ? {} : { url: puzzle.credit.url }),
      };
    }
  }

  const view: GameView = {
    gameId: game.id,
    revision: game.revision,
    pack: { id: state.pack.id, kind: state.pack.kind, title: state.pack.title, theme: state.pack.theme },
    round,
    results: rounds,
    total,
    finished: state.finished,
  };
  if (state.lastOutcome !== null) view.lastOutcome = publicOutcome(state.lastOutcome, puzzles[state.index]);
  return view;
}

/**
 * A guess outcome as the browser may see it. A correct guess can only happen
 * when the round ends, but `matched` may be an accepted alternate (e.g.
 * "Giraffes"). Accepted answers never leave the server, so the browser gets
 * the canonical answer instead.
 */
function publicOutcome(outcome: GuessOutcome, puzzle: Puzzle | undefined): GuessOutcome {
  switch (outcome.kind) {
    case "correct":
      if (puzzle === undefined) throw new Error("server-game: correct outcome without a puzzle");
      return { kind: "correct", matched: puzzle.answer };
    case "incorrect":
      return { kind: "incorrect", normalizedGuess: outcome.normalizedGuess };
    case "empty":
      return { kind: "empty" };
  }
}

function checkPuzzlesMatch(state: GameState, puzzles: readonly Puzzle[]): void {
  const ids = puzzles.map((p) => p.id);
  if (ids.length !== state.puzzleIds.length || ids.some((id, i) => id !== state.puzzleIds[i])) {
    throw new Error("server-game: puzzles don't match the game's puzzleIds");
  }
}

// ---------------------------------------------------------------------------
// Game functions
// ---------------------------------------------------------------------------

/**
 * Start a new game of `pack` for `owner`. `scoring` is the pack's config
 * (today: `SCORING_CONFIG`; later `getScoringConfig(pack.id)`, #64); it's
 * stored with the game.
 */
export async function startGame(
  deps: GameDeps,
  pack: Pack,
  owner: GameOwner,
  scoring: ScoringConfig,
): Promise<GameView> {
  checkOwner(owner);
  validateScoringConfig(scoring);
  const puzzles = await deps.puzzles.getPuzzles(pack.puzzleIds);
  const game = createGame(puzzles); // throws on unplayable data
  const state: GameState = {
    schemaVersion: 1,
    pack: { id: pack.id, kind: pack.kind, title: pack.title, theme: pack.theme },
    puzzleIds: puzzles.map((p) => p.id),
    scoring: { ...scoring },
    index: game.index,
    round: { ...game.round },
    finished: game.finished,
    events: [],
    lastOutcome: null,
  };
  checkPuzzlesMatch(state, puzzles);
  // Before creating the row, so a game that can't be shown is never stored.
  const levelSrcs = await levelsFor(deps, state, puzzles);
  const stored = await deps.games.create({ owner, packId: pack.id, state });
  return toGameView(stored, puzzles, levelSrcs);
}

/** The owner's game, as it is now. Use it to resume after a page refresh. */
export async function getGame(deps: GameDeps, gameId: string, owner: GameOwner): Promise<GameView> {
  const { game, puzzles } = await load(deps, gameId, owner);
  return viewOf(deps, game, puzzles);
}

/**
 * Apply one player action to the owner's game and return the new view.
 *
 * `action` may come straight from a client: it's checked with
 * `parseGameAction` first. An action the round rejects (guess after the round
 * ended, reveal at the full image, a blank guess, ...) changes nothing, just
 * like `step` in round.ts: nothing is saved and the current view is returned.
 *
 * `expectedRevision` is the `GameView.revision` the player was looking at,
 * and it's required (#107). It's checked after the owner, so a stranger gets
 * `GameNotFoundError` whatever they send. A malformed one throws
 * `InvalidGameActionError`; one that no longer matches the stored game
 * (another tab moved it on, or an earlier response was lost) throws
 * `GameConflictError`, and nothing changes.
 */
export async function act(
  deps: GameDeps,
  gameId: string,
  owner: GameOwner,
  action: GameAction,
  expectedRevision: number,
): Promise<GameView> {
  const parsed = parseGameAction(action);
  const { game, puzzles } = await load(deps, gameId, owner);
  // The client acted on the view it was shown. If the game has moved on since
  // (another tab answered, skipped, ...), the action was meant for a round
  // that's gone: reject it rather than apply it to one the player never saw (#107).
  // Untrusted like the action: it can come straight from a client.
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new InvalidGameActionError("revision must be a non-negative integer");
  }
  if (expectedRevision !== game.revision) throw new GameConflictError(game.id);
  const { state } = game;

  const current: Game = { puzzles, index: state.index, round: state.round, finished: state.finished };
  const result = step(current, parsed);
  if (!result.ok) return viewOf(deps, game, puzzles);

  const next: StoredGame = {
    ...game,
    state: {
      ...state,
      index: result.game.index,
      round: { ...result.game.round },
      finished: result.game.finished,
      events: [...state.events, ...result.events],
      lastOutcome: result.outcome ?? null,
    },
  };
  // Before saving, so the game never moves on to a puzzle it can't show.
  const levelSrcs = await levelsFor(deps, next.state, puzzles);
  const saved = await deps.games.save(next);
  return toGameView(saved, puzzles, levelSrcs);
}

/** `toGameView`, with the current puzzle's level images from `deps.levels` (#57). */
async function viewOf(deps: GameDeps, game: StoredGame, puzzles: readonly Puzzle[]): Promise<GameView> {
  return toGameView(game, puzzles, await levelsFor(deps, game.state, puzzles));
}

/**
 * The level images `toGameView` needs for `state` (#57): only the current
 * puzzle's URLs are looked up, and `toGameView` sends only the one for the
 * level reached. Throws if the current puzzle can't be shown (a private puzzle
 * that isn't cut), so call it **before** storing `state`: otherwise the game
 * would be saved at a puzzle that fails on every later load.
 */
async function levelsFor(
  deps: GameDeps,
  state: GameState,
  puzzles: readonly Puzzle[],
): Promise<ReadonlyMap<string, readonly string[]> | undefined> {
  if (deps.levels === undefined) return undefined;
  const puzzle = state.finished ? undefined : puzzles[state.index];
  if (puzzle === undefined) return new Map();
  const levelSrcs = await deps.levels.getLevelSrcs([puzzle.id]);
  roundImage(puzzle, state.round, levelSrcs); // throws if it can't be shown
  return levelSrcs;
}

async function load(
  deps: GameDeps,
  gameId: string,
  owner: GameOwner,
): Promise<{ game: StoredGame; puzzles: Puzzle[] }> {
  checkOwner(owner);
  const game = await deps.games.get(gameId);
  if (game === null || !sameOwner(game.owner, owner)) throw new GameNotFoundError();
  if (game.state.schemaVersion !== 1) {
    throw new Error(`server-game: unsupported schemaVersion ${String(game.state.schemaVersion)}`);
  }
  const puzzles = await deps.puzzles.getPuzzles(game.state.puzzleIds);
  return { game, puzzles };
}

// ---------------------------------------------------------------------------
// In-memory implementations (tests, and the practice pack until #47 / #52)
// ---------------------------------------------------------------------------

/**
 * A `GameStore` that keeps games in a Map, stored as JSON strings. Every read
 * and write goes through `JSON.stringify` / `JSON.parse`, so a record that
 * wouldn't survive the jsonb column fails here too, and callers can't mutate
 * stored games through a returned object.
 */
export class MemoryGameStore implements GameStore {
  private readonly rows = new Map<string, string>();

  constructor(private readonly newId: () => string = () => crypto.randomUUID()) {}

  async get(id: string): Promise<StoredGame | null> {
    const row = this.rows.get(id);
    return row === undefined ? null : (JSON.parse(row) as StoredGame);
  }

  async create(game: NewStoredGame): Promise<StoredGame> {
    const id = this.newId();
    if (this.rows.has(id)) throw new Error(`MemoryGameStore: duplicate id ${id}`);
    const stored: StoredGame = { id, owner: game.owner, packId: game.packId, revision: 0, state: game.state };
    this.rows.set(id, JSON.stringify(stored));
    return JSON.parse(this.rows.get(id)!) as StoredGame;
  }

  async save(game: StoredGame): Promise<StoredGame> {
    const row = this.rows.get(game.id);
    if (row === undefined) throw new GameNotFoundError();
    const current = JSON.parse(row) as StoredGame;
    if (current.revision !== game.revision) throw new GameConflictError(game.id);
    // Only the state changes; id, owner and pack stay as created.
    const saved: StoredGame = { ...current, revision: current.revision + 1, state: game.state };
    this.rows.set(game.id, JSON.stringify(saved));
    return JSON.parse(this.rows.get(game.id)!) as StoredGame;
  }

  /** The raw stored JSON, for tests. */
  raw(id: string): string | undefined {
    return this.rows.get(id);
  }
}

/** A `PuzzleSource` over a fixed list, e.g. `SAMPLE_PUZZLES` for the practice pack. */
export function puzzleSourceFrom(puzzles: readonly Puzzle[]): PuzzleSource {
  const byId = new Map(puzzles.map((p) => [p.id, p]));
  return {
    async getPuzzles(ids) {
      return ids.map((id) => {
        const puzzle = byId.get(id);
        if (puzzle === undefined) throw new Error(`PuzzleSource: no puzzle "${id}"`);
        return puzzle;
      });
    },
  };
}
