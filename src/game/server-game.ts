// Server-side games (#54): the browser sends a `GameAction` and gets back a
// `GameView`. Answers, accepted answers and scoring stay here.
//
// Framework-free on purpose (no React, Next or database imports), so it stays
// unit-testable. The Postgres store (#47) and the Route Handlers / Server
// Actions that call these functions are separate, server-only modules. Never
// import this file from a "use client" component: it handles full `Puzzle`s.
//
// Game rules are not reimplemented here: `step` and `timeOut` (round.ts) run
// the round, `checkGuess` (guess.ts, via `step`) checks guesses, and
// `scoreGame` / `scoreAt` (scoring.ts) turn the server's own scoring events
// into points. There is no way for a client to submit a score or a time.
//
// Timed rounds (#255): `start` starts the round's clock, read from
// `GameDeps.now` (the server's clock; a fake one in tests) and kept in the
// encrypted state. A correct guess scores by the server's elapsed time. Once
// the time limit passes the round is over with 0 points; with no timers on the
// server, the next request for the game (an action or a load) ends it.

import { createGame, elapsedSeconds, step, timeOut, type Game, type Round, type RoundClock } from "./round.ts";
import { scoreGame, validateTimedScoringConfig } from "./scoring.ts";
import type {
  GameAction,
  GameView,
  GuessOutcome,
  Pack,
  PublicRound,
  Puzzle,
  ScoringEvent,
  TimedScoringConfig,
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
 * with. Plain JSON (no Dates, Maps, classes or `undefined` fields), so it
 * round-trips through JSON unchanged: the store encrypts it as JSON into
 * `games.state_encrypted` (#47, #84).
 *
 * Puzzles are referenced by id, not copied, so answers aren't duplicated into
 * every game row. Results and the total aren't stored either: they're always
 * recomputed from `events` with `scoring`.
 */
export type GameState = {
  /**
   * Bump when this shape changes, so old rows can be migrated or rejected.
   * 2: timed rounds (#255). Version 1 games (zoom out and skip) can't be
   * played or shown any more: loading one throws `GameFromOldRulesError`.
   */
  schemaVersion: 2;
  pack: GameView["pack"];
  /** Play order, copied from the pack when the game started. */
  puzzleIds: string[];
  /** Snapshot of the config at start, so tuning it (#64) doesn't rescore games in progress. */
  scoring: TimedScoringConfig;
  /** From round.ts `Game`: index of the current puzzle. */
  index: number;
  /** From round.ts `Game`. Holds the round's `startedAt` (server time), which never leaves the server. */
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
  /**
   * The daily challenge's day ("YYYY-MM-DD") if this is a daily game (#58);
   * absent for every other game. Set when the game is created, never changed.
   */
  dailyDate?: string;
};

export type NewStoredGame = Omit<StoredGame, "id" | "revision">;

/** Where games are kept. In-memory for tests; Postgres (#47) in the app. */
export interface GameStore {
  /**
   * The game with this id, or null. Doesn't check the owner; the service does.
   * Throws `GameUnreadableError` if the row exists but its state can't be read.
   */
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
  /**
   * This owner's daily game for `dailyDate`, or null (#58). A store keeps at
   * most one per owner and day: `create` with a `dailyDate` this owner already
   * has throws `DuplicateDailyGameError`.
   */
  findDaily(owner: GameOwner, dailyDate: string): Promise<StoredGame | null>;
}

/** Looks up full puzzles (with answers) by id. Server-only. */
export interface PuzzleSource {
  /** The puzzles with these ids, in the same order. Throws if any is missing. */
  getPuzzles(ids: readonly string[]): Promise<Puzzle[]>;
}

/**
 * Where each puzzle's pre-cut level images are (#57): one `/img/<id>.webp`
 * URL per zoom level, tightest first. Server-only. Timed rounds (#255) only
 * use the last one, the full photo, and only once the round has started; the
 * other levels are no longer sent.
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
 * every puzzle's photo is its `imageUrl`. `now` is the server's clock in
 * milliseconds since the epoch (default `Date.now`); tests pass a fake one.
 */
export type GameDeps = { games: GameStore; puzzles: PuzzleSource; levels?: LevelImageSource; now?: () => number };

/**
 * Where the public practice images live (`public/puzzles/`, #52). Only these
 * may be sent by their `imageUrl` when they aren't cut (#57); anything else is private.
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

/** This owner already has a daily game for that day (#58). `startOrResumeDaily` resumes it instead. */
export class DuplicateDailyGameError extends Error {
  constructor(readonly dailyDate: string) {
    super(`This owner already has a daily game for ${dailyDate}`);
    this.name = "DuplicateDailyGameError";
  }
}

/**
 * The game exists but its stored state can't be read: it doesn't decrypt
 * (another tier's DATA_ENCRYPTION_KEY, or a damaged row, #84). Carries the
 * stored owner so the service can answer a stranger with `GameNotFoundError`,
 * as for any game that isn't theirs. The message names only the game id.
 */
export class GameUnreadableError extends Error {
  constructor(
    readonly gameId: string,
    readonly owner: GameOwner,
    options?: ErrorOptions,
  ) {
    super(`Game ${gameId}'s stored state can't be decrypted (wrong key or damaged row)`, options);
    this.name = "GameUnreadableError";
  }
}

/**
 * The game was stored under the old rules (zoom out and skip,
 * `schemaVersion` 1, before #255), so it can't be played or shown with timed
 * rounds. A `GameUnreadableError`, so callers treat it the same way: practice
 * skips it and starts a new game, the daily says the game is lost. Its
 * finished rounds and total stay in `game_rounds` and `games.total`, so
 * leaderboards and daily stats still count them.
 */
export class GameFromOldRulesError extends GameUnreadableError {
  constructor(gameId: string, owner: GameOwner, schemaVersion: unknown) {
    super(gameId, owner);
    this.message = `Game ${gameId} was stored under old rules (schemaVersion ${String(schemaVersion)}), before timed rounds (#255)`;
    this.name = "GameFromOldRulesError";
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
    case "start":
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
 * The URL of the current round's full photo (timed rounds, #255), or
 * undefined while the round is `ready`: the photo is sent only once its clock
 * has started, so the intro or a ready screen can't show it early.
 * - **Cut** (#57): the last level image, which is the full photo.
 * - **Not cut:** a public practice image is sent by its `imageUrl`. Any other
 *   puzzle throws, so a private daily or Stanford original is never linked.
 * - **No level source** (`levelSrcs` undefined, e.g. tests of the game
 *   rules): its `imageUrl`, for every puzzle.
 */
function roundPhoto(
  puzzle: Puzzle,
  round: Round,
  levelSrcs: ReadonlyMap<string, readonly string[]> | undefined,
): string | undefined {
  const srcs = levelSrcs?.get(puzzle.id);
  // `getLevelSrcs` only returns lists with no gaps, so the length says whether every level is cut.
  const full = srcs !== undefined && srcs.length === puzzle.reveal.zoomLevels.length ? srcs.at(-1) : undefined;
  if (full === undefined && levelSrcs !== undefined && !puzzle.imageUrl.startsWith(PUBLIC_IMAGE_PREFIX)) {
    throw new Error(`toGameView: puzzle ${puzzle.id} has no cut images (run npm run db:seed)`);
  }
  if (round.state === "ready") return undefined;
  return full ?? puzzle.imageUrl;
}

/**
 * Build the browser's view of a game at server time `now` (ms). Pure.
 * `puzzles` are the game's puzzles in play order (`game.state.puzzleIds`).
 * `levelSrcs` has the cut images of (at least) the current puzzle, from a
 * `LevelImageSource`.
 *
 * Fields are copied one by one onto a fresh object, never spread from a
 * `Puzzle`, so new puzzle fields can't leak by accident. The photo is added
 * only once the round has started; `answer` and `credit` only once it's
 * over; accepted answers and `startedAt` are never sent.
 */
export function toGameView(
  game: StoredGame,
  puzzles: readonly Puzzle[],
  levelSrcs: ReadonlyMap<string, readonly string[]> | undefined,
  now: number,
): GameView {
  const { state } = game;
  checkPuzzlesMatch(state, puzzles);
  const { rounds, total } = scoreGame(state.events, state.scoring);

  let round: PublicRound | null = null;
  if (!state.finished) {
    const puzzle = puzzles[state.index];
    if (puzzle === undefined) throw new Error(`toGameView: game ${game.id} has no puzzle at ${state.index}`);
    const r = state.round;
    const over = r.state === "correct" || r.state === "timedOut";
    // A round that's over shows its scored time; one in play, the time so far (never past the limit).
    const elapsed = over
      ? (rounds[state.index]?.seconds ?? null)
      : r.state === "playing"
        ? Math.min(elapsedSeconds(r, now) ?? 0, state.scoring.limitSeconds)
        : null;
    const imageSrc = roundPhoto(puzzle, r, levelSrcs);
    round = {
      position: state.index + 1,
      puzzleCount: puzzles.length,
      state: r.state,
      elapsedSeconds: elapsed,
      ...(imageSrc === undefined ? {} : { imageSrc }),
      effect: puzzle.effect ?? null,
      focus: { x: puzzle.reveal.focus.x, y: puzzle.reveal.focus.y },
      scoring: { ...state.scoring },
      wrongGuesses: r.wrongGuesses,
      // Beat the AI (#56): the level the AI needed, not the answer. null = never, or not run yet.
      // TODO(#257): a solve time (`aiSolvedSeconds`) instead.
      aiSolvedLevel: puzzle.aiSolvedLevel,
    };
    if (over) {
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
  // Only once every round is over, so no answer is ever in a view while a round is played.
  // `beatAi` is left out until Beat the AI compares solve times (#257): levels no longer exist.
  if (state.finished) view.answers = puzzles.map((p) => p.answer);
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

/** The server's time now, in ms. */
function nowOf(deps: GameDeps): number {
  const now = (deps.now ?? Date.now)();
  if (!Number.isFinite(now)) throw new Error("server-game: the clock returned a non-finite time");
  return now;
}

/**
 * Start a new game of `pack` for `owner`, scored with `scoring` (timed,
 * #256), which is stored with the game. Every round starts `ready`: no clock
 * and no photo until the player sends `start`.
 */
export async function startGame(
  deps: GameDeps,
  pack: Pack,
  owner: GameOwner,
  scoring: TimedScoringConfig,
  options: { dailyDate?: string } = {},
): Promise<GameView> {
  checkOwner(owner);
  validateTimedScoringConfig(scoring);
  if (options.dailyDate !== undefined && pack.kind !== "daily") {
    throw new Error(`startGame: only a daily pack can be a daily game (pack ${pack.id} is ${pack.kind})`);
  }
  const puzzles = await deps.puzzles.getPuzzles(pack.puzzleIds);
  const game = createGame(puzzles); // throws on unplayable data
  const state: GameState = {
    schemaVersion: 2,
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
  const stored = await deps.games.create({
    owner,
    packId: pack.id,
    state,
    ...(options.dailyDate === undefined ? {} : { dailyDate: options.dailyDate }),
  });
  return toGameView(stored, puzzles, levelSrcs, nowOf(deps));
}

/**
 * Today's daily game for this owner (#58): resumes the one they already have
 * for `dailyDate` (in play or finished), or starts it. One game per owner per
 * day, enforced by the store; if two requests start it at once, the second
 * one resumes the first one's game.
 */
export async function startOrResumeDaily(
  deps: GameDeps,
  pack: Pack,
  dailyDate: string,
  owner: GameOwner,
  scoring: TimedScoringConfig,
): Promise<GameView> {
  checkOwner(owner);
  const resume = () => resumeDaily(deps, owner, dailyDate);
  const existing = await resume();
  if (existing !== null) return existing;
  try {
    return await startGame(deps, pack, owner, scoring, { dailyDate });
  } catch (error) {
    if (!(error instanceof DuplicateDailyGameError)) throw error;
    const raced = await resume();
    if (raced === null) throw error;
    return raced;
  }
}

/**
 * This owner's daily game for `dailyDate` as it is now (in play or finished),
 * or `null` if they haven't started it. Reads it like `getGame` does (owner
 * and schema checks, a round whose time is up is ended), so a daily resumes
 * like any game.
 */
export async function resumeDaily(deps: GameDeps, owner: GameOwner, dailyDate: string): Promise<GameView | null> {
  checkOwner(owner);
  const found = await deps.games.findDaily(owner, dailyDate);
  if (found === null) return null;
  return getGame(deps, found.id, owner);
}

/**
 * The owner's game, as it is now. Use it to resume after a page refresh, and
 * when the browser's clock says time is up. A round whose time limit has
 * passed is ended here (0 points) and saved, so this can write: once per
 * timed-out round. If another request saves first, its game is shown.
 */
export async function getGame(deps: GameDeps, gameId: string, owner: GameOwner): Promise<GameView> {
  const { game, puzzles } = await load(deps, gameId, owner);
  const now = nowOf(deps);
  const expired = timeOut(gameOf(game, puzzles), clockOf(game, now));
  if (expired === null) return viewOf(deps, game, puzzles, now);
  try {
    return await save(deps, game, puzzles, expired.game, expired.events, null, now);
  } catch (error) {
    if (!(error instanceof GameConflictError)) throw error;
    // Another request (another tab, or an action) saved first: show the game as it is now.
    const again = await load(deps, gameId, owner);
    return viewOf(deps, again.game, again.puzzles, nowOf(deps));
  }
}

/**
 * Apply one player action to the owner's game and return the new view.
 *
 * `action` may come straight from a client: it's checked with
 * `parseGameAction` first. If the round's time is up, it's ended first (0
 * points, saved) and the action applies to the ended round: a guess is then
 * refused, and the view shows the round timed out. An action the round
 * rejects (a guess before `start` or after the round ended, a second `start`,
 * a blank guess, ...) changes nothing else, just like `step` in round.ts:
 * nothing is saved and the current view is returned.
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
  // (another tab answered, started the clock, ...), the action was meant for
  // a round that's gone: reject it rather than apply it to one the player never saw (#107).
  // Untrusted like the action: it can come straight from a client.
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new InvalidGameActionError("revision must be a non-negative integer");
  }
  if (expectedRevision !== game.revision) throw new GameConflictError(game.id);

  // One reading of the clock for the whole action, so the time-out and the guess agree.
  const now = nowOf(deps);
  const clock = clockOf(game, now);
  const expired = timeOut(gameOf(game, puzzles), clock);
  const current = expired?.game ?? gameOf(game, puzzles);
  const events = expired?.events ?? [];

  const result = step(current, parsed, clock);
  if (result.ok) {
    return save(deps, game, puzzles, result.game, [...events, ...result.events], result.outcome ?? null, now);
  }
  // Refused. If the time just ran out, that is still saved (the round is over); otherwise nothing changes.
  if (expired !== null) return save(deps, game, puzzles, expired.game, expired.events, null, now);
  return viewOf(deps, game, puzzles, now);
}

/** The round.ts `Game` for a stored game. */
function gameOf(game: StoredGame, puzzles: readonly Puzzle[]): Game {
  const { state } = game;
  return { puzzles, index: state.index, round: state.round, finished: state.finished };
}

function clockOf(game: StoredGame, now: number): RoundClock {
  return { now, scoring: game.state.scoring };
}

/**
 * Save `game` moved on to `next` with `events` added, and return the new
 * view. Checks the new state can be shown first, so the game never moves on
 * to a puzzle it can't show. Throws `GameConflictError` if another request
 * saved first.
 */
async function save(
  deps: GameDeps,
  game: StoredGame,
  puzzles: readonly Puzzle[],
  next: Game,
  events: readonly ScoringEvent[],
  lastOutcome: GuessOutcome | null,
  now: number,
): Promise<GameView> {
  const { state } = game;
  const updated: StoredGame = {
    ...game,
    state: {
      ...state,
      index: next.index,
      round: { ...next.round },
      finished: next.finished,
      events: [...state.events, ...events],
      lastOutcome,
    },
  };
  const levelSrcs = await levelsFor(deps, updated.state, puzzles);
  const saved = await deps.games.save(updated);
  return toGameView(saved, puzzles, levelSrcs, now);
}

/** `toGameView`, with the current puzzle's images from `deps.levels` (#57). */
async function viewOf(deps: GameDeps, game: StoredGame, puzzles: readonly Puzzle[], now: number): Promise<GameView> {
  return toGameView(game, puzzles, await levelsFor(deps, game.state, puzzles), now);
}

/**
 * The cut images `toGameView` needs for `state` (#57): only the current
 * puzzle's URLs are looked up, and `toGameView` sends only the full photo,
 * once the round has started. Throws if the current puzzle can't be shown (a
 * private puzzle that isn't cut), so call it **before** storing `state`:
 * otherwise the game would be saved at a puzzle that fails on every later load.
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
  roundPhoto(puzzle, state.round, levelSrcs); // throws if it can't be shown
  return levelSrcs;
}

async function load(
  deps: GameDeps,
  gameId: string,
  owner: GameOwner,
): Promise<{ game: StoredGame; puzzles: Puzzle[] }> {
  checkOwner(owner);
  let game: StoredGame | null;
  try {
    game = await deps.games.get(gameId);
  } catch (error) {
    // Someone else's game looks missing, readable or not.
    if (error instanceof GameUnreadableError && !sameOwner(error.owner, owner)) throw new GameNotFoundError();
    throw error;
  }
  if (game === null || !sameOwner(game.owner, owner)) throw new GameNotFoundError();
  const version: unknown = game.state.schemaVersion;
  if (version === 1) throw new GameFromOldRulesError(game.id, game.owner, version);
  if (version !== 2) throw new Error(`server-game: unsupported schemaVersion ${String(version)}`);
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
    // Checked and written with no await in between, like a unique index.
    if (game.dailyDate !== undefined && this.dailyGame(game.owner, game.dailyDate) !== null) {
      throw new DuplicateDailyGameError(game.dailyDate);
    }
    const stored: StoredGame = {
      id,
      owner: game.owner,
      packId: game.packId,
      revision: 0,
      state: game.state,
      ...(game.dailyDate === undefined ? {} : { dailyDate: game.dailyDate }),
    };
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

  async findDaily(owner: GameOwner, dailyDate: string): Promise<StoredGame | null> {
    return this.dailyGame(owner, dailyDate);
  }

  private dailyGame(owner: GameOwner, dailyDate: string): StoredGame | null {
    for (const row of this.rows.values()) {
      const game = JSON.parse(row) as StoredGame;
      if (game.dailyDate === dailyDate && sameOwner(game.owner, owner)) return game;
    }
    return null;
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
