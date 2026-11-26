// Seeded random games through the server game (`startGame` / `act` / `getGame`),
// checked move by move against a small model of the rules written here from
// scratch: what each move should do, what each image is worth at the server's
// time, the revision, the running total, and when answers and the photo may
// appear. Timed rounds (#255): the walk also moves a fake clock, so rounds time
// out. The anti-cheat random test in server-game.test.ts checks only that no
// answer leaks; this checks the game is played and scored right, for several
// scoring configs.
import { describe, expect, it } from "vitest";

import { SAMPLE_PUZZLES } from "../puzzles/index.ts";
import { START_GRACE_SECONDS } from "./round.ts";
import { scoreAt } from "./scoring.ts";
import {
  act,
  GameConflictError,
  getGame,
  MAX_WRONG_GUESSES_PER_ROUND,
  MemoryGameStore,
  puzzleSourceFrom,
  startGame,
  type GameDeps,
  type GameOwner,
} from "./server-game.ts";
import type { GameAction, GameView, Pack, Puzzle, TimedScoringConfig } from "./types.ts";

const ALICE: GameOwner = { userId: "alice" };
const PUZZLES: Puzzle[] = SAMPLE_PUZZLES.map((p, i) => ({ ...p, id: `p${i + 1}`, imageUrl: `/img/p${i + 1}.jpg` }));
const PACK: Pack = { id: "practice", kind: "practice", title: "Practice", theme: "Mixed", puzzleIds: PUZZLES.map((p) => p.id) };
// Nowhere near any sample answer, even with typo tolerance.
const WRONG = "definitely not this one";

const CONFIGS: Record<string, TimedScoringConfig> = {
  standard: { maxPoints: 10_000, minPoints: 100, revealSeconds: 25, limitSeconds: 30, curve: 2 },
  // Short and steep: the floor and the limit come quickly.
  quick: { maxPoints: 500, minPoints: 50, revealSeconds: 5, limitSeconds: 8, curve: 3 },
  // No drain at all, and no time between the clear photo and the limit.
  flat: { maxPoints: 300, minPoints: 300, revealSeconds: 10, limitSeconds: 10, curve: 1 },
};

/** Small seeded generator (an LCG), so a failure is reproducible from its seed. */
function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
}

/** What the game should look like, worked out from the rules alone. */
type Model = {
  index: number;
  /** Clock time (ms) the round started, or null before start. */
  startedAt: number | null;
  wrong: number;
  state: "ready" | "playing" | "correct" | "timedOut";
  finished: boolean;
  revision: number;
  points: number[]; // per finished round
  seconds: number[]; // per finished round
};

const newModel = (): Model => ({ index: 0, startedAt: null, wrong: 0, state: "ready", finished: false, revision: 0, points: [], seconds: [] });

/** The round's scored time at `now`, as the rules say: minus the grace, never below 0, to the millisecond. */
function timeAt(m: Model, now: number): number {
  return Math.max(0, Math.round(((now - m.startedAt!) / 1000 - START_GRACE_SECONDS) * 1000) / 1000);
}

/** Ends a playing round whose time is up. Returns true if it did (a saved change). */
function expire(m: Model, now: number, c: TimedScoringConfig): boolean {
  if (m.finished || m.state !== "playing" || timeAt(m, now) < c.limitSeconds) return false;
  m.state = "timedOut";
  m.points.push(0);
  m.seconds.push(c.limitSeconds);
  return true;
}

type Move = { kind: "start" | "blank" | "wrong" | "answer" | "accepted" | "next" | "wait" | "load" };

/**
 * Applies `move` at `now` to the model, as `act` (or `getGame` for "load")
 * should. Returns whether the game saved (the revision goes up), and whether
 * the move itself was refused by the wrong-guess cap (a throw).
 */
function apply(m: Model, move: Move, now: number, c: TimedScoringConfig): { saved: boolean; capped: boolean } {
  const expired = expire(m, now, c);
  if (move.kind === "load" || move.kind === "wait") {
    if (expired) m.revision += 1;
    return { saved: expired, capped: false };
  }
  const guess = move.kind === "wrong" || move.kind === "answer" || move.kind === "accepted" || move.kind === "blank";
  if (guess && !m.finished && m.state === "playing" && m.wrong >= MAX_WRONG_GUESSES_PER_ROUND && !expired) {
    return { saved: false, capped: true };
  }
  let ok = false;
  if (!m.finished) {
    switch (move.kind) {
      case "start":
        if (m.state === "ready") {
          Object.assign(m, { state: "playing", startedAt: now });
          ok = true;
        }
        break;
      case "next":
        if (m.state === "correct" || m.state === "timedOut") {
          if (m.index === PUZZLES.length - 1) m.finished = true;
          else Object.assign(m, { index: m.index + 1, startedAt: null, wrong: 0, state: "ready" });
          ok = true;
        }
        break;
      case "blank":
        break;
      case "wrong":
        if (m.state === "playing") {
          m.wrong += 1;
          ok = true;
        }
        break;
      case "answer":
      case "accepted":
        if (m.state === "playing") {
          const t = timeAt(m, now);
          m.state = "correct";
          m.points.push(scoreAt(t, c));
          m.seconds.push(t);
          ok = true;
        }
        break;
    }
  }
  const saved = ok || expired;
  if (saved) m.revision += 1;
  return { saved, capped: false };
}

function pick(random: () => number): Move {
  const r = random();
  if (r < 0.18) return { kind: "start" };
  if (r < 0.23) return { kind: "blank" };
  if (r < 0.43) return { kind: "wrong" };
  if (r < 0.53) return { kind: "answer" };
  if (r < 0.58) return { kind: "accepted" };
  if (r < 0.78) return { kind: "next" };
  if (r < 0.93) return { kind: "wait" };
  return { kind: "load" };
}

/** The action a player would send for `move` on the current puzzle (none for wait or load). */
function actionFor(move: Move, m: Model, random: () => number): GameAction | null {
  const puzzle = PUZZLES[Math.min(m.index, PUZZLES.length - 1)]!;
  switch (move.kind) {
    case "start":
    case "next":
      return { type: move.kind };
    case "blank":
      return { type: "guess", guess: random() < 0.5 ? "" : "   \t " };
    case "wrong":
      return { type: "guess", guess: WRONG };
    case "answer":
      // Case and surrounding spaces don't matter.
      return { type: "guess", guess: random() < 0.5 ? puzzle.answer : `  ${puzzle.answer.toUpperCase()} ` };
    case "accepted": {
      const accepted = puzzle.acceptedAnswers;
      return { type: "guess", guess: accepted.length > 0 ? accepted[Math.floor(random() * accepted.length)]! : puzzle.answer };
    }
    case "wait":
    case "load":
      return null;
  }
}

/** The view agrees with the model, field by field. */
function expectMatches(view: GameView, m: Model, c: TimedScoringConfig, where: string): void {
  const ctx = `${where}: ${JSON.stringify({ ...m, points: m.points.length })}`;
  expect(view.revision, ctx).toBe(m.revision);
  expect(view.finished, ctx).toBe(m.finished);
  expect(view.scoring, ctx).toEqual(c);
  expect(view.results.map((r) => r.points), ctx).toEqual(m.points);
  expect(view.results.map((r) => r.seconds), ctx).toEqual(m.seconds);
  expect(view.total, ctx).toBe(m.points.reduce((a, b) => a + b, 0));
  for (const r of view.results) {
    if (r.outcome === "correct") {
      expect(r.points, ctx).toBeGreaterThanOrEqual(c.minPoints);
      expect(r.points, ctx).toBeLessThanOrEqual(c.maxPoints);
    } else expect(r.points, ctx).toBe(0);
  }

  if (m.finished) {
    expect(view.round, ctx).toBeNull();
    expect(view.answers, ctx).toEqual(PUZZLES.map((p) => p.answer));
    expect(view.results, ctx).toHaveLength(PUZZLES.length);
    return;
  }
  expect(view.answers, ctx).toBeUndefined();
  const round = view.round!;
  expect(round.position, ctx).toBe(m.index + 1);
  expect(round.puzzleCount, ctx).toBe(PUZZLES.length);
  expect(round.state, ctx).toBe(m.state);
  expect(round.wrongGuesses, ctx).toBe(m.wrong);
  const over = m.state === "correct" || m.state === "timedOut";
  expect(view.results, ctx).toHaveLength(over ? m.index + 1 : m.index);
  if (m.state === "ready") {
    expect(round, ctx).not.toHaveProperty("imageSrc");
    expect(round.elapsedSeconds, ctx).toBeNull();
  } else {
    expect(round.imageSrc, ctx).toBe(PUZZLES[m.index]!.imageUrl);
  }
  if (over) expect(round.answer, ctx).toBe(PUZZLES[m.index]!.answer);
  else expect(round, ctx).not.toHaveProperty("answer");
}

function setup() {
  let n = 0;
  let now = Date.UTC(2030, 0, 1, 12);
  const deps: GameDeps = { games: new MemoryGameStore(() => `game-${++n}`), puzzles: puzzleSourceFrom(PUZZLES), now: () => now };
  return { deps, now: () => now, advance: (ms: number) => (now += ms) };
}

describe("random timed games follow the rules (model check)", () => {
  it("the sample puzzles give the model something to check", () => {
    expect(PUZZLES.length).toBeGreaterThanOrEqual(3);
    expect(PUZZLES.some((p) => p.acceptedAnswers.length > 0)).toBe(true);
  });

  for (const [name, config] of Object.entries(CONFIGS)) {
    it(`plays 40 seeded games move by move with the "${name}" scoring`, async () => {
      const { deps, now, advance } = setup();
      const seen = new Set<string>();
      let finishedGames = 0;

      for (let g = 0; g < 40; g++) {
        const seed = 1000 * Object.keys(CONFIGS).indexOf(name) + g;
        const random = rng(seed);
        let view = await startGame(deps, PACK, ALICE, config);
        const m = newModel();
        expectMatches(view, m, config, `seed ${seed}, start`);

        for (let n = 0; n < 120; n++) {
          // Time passes between moves: mostly a little, sometimes past the limit.
          advance(random() < 0.1 ? (config.limitSeconds + 1) * 1000 : Math.floor(random() * 2500));
          const move = pick(random);
          const action = actionFor(move, m, random);
          const { saved, capped } = apply(m, move, now(), config);
          seen.add(`${move.kind}:${saved ? "saved" : "unchanged"}`);
          if (capped) {
            await expect(act(deps, view.gameId, ALICE, action!, view.revision)).rejects.toThrow();
            continue;
          }
          view = action === null ? await getGame(deps, view.gameId, ALICE) : await act(deps, view.gameId, ALICE, action, view.revision);
          expectMatches(view, m, config, `seed ${seed}, move ${n} (${move.kind})`);
          // A reload at the same moment shows exactly what the last response did.
          expect(await getGame(deps, view.gameId, ALICE)).toEqual(view);
          if (m.finished && random() < 0.2) break;
        }
        if (m.finished) finishedGames++;
      }

      // The walk really did exercise every kind of move, saved and not.
      for (const k of ["start:saved", "start:unchanged", "blank:unchanged", "wrong:saved", "answer:saved", "next:saved", "next:unchanged", "load:saved", "wait:unchanged"]) {
        expect(seen, k).toContain(k);
      }
      expect(finishedGames).toBeGreaterThan(5);
    });
  }

  it("a move sent with an old revision is refused and changes nothing, at any point in a game", async () => {
    const { deps, now, advance } = setup();
    const random = rng(7);
    const config = CONFIGS.standard!;
    let view = await startGame(deps, PACK, ALICE, config);
    const m = newModel();
    let staleChecks = 0;

    for (let n = 0; n < 300 && !m.finished; n++) {
      advance(Math.floor(random() * 3000));
      const move = pick(random);
      const action = actionFor(move, m, random);
      if (action === null) continue;
      if (view.revision > 0 && random() < 0.25) {
        const stale = Math.floor(random() * view.revision);
        await expect(act(deps, view.gameId, ALICE, action, stale)).rejects.toBeInstanceOf(GameConflictError);
        // And one from the future (a forged revision) is refused too.
        await expect(act(deps, view.gameId, ALICE, action, view.revision + 1)).rejects.toBeInstanceOf(GameConflictError);
        staleChecks++;
      }
      apply(m, move, now(), config);
      view = await act(deps, view.gameId, ALICE, action, view.revision);
      expectMatches(view, m, config, `move ${n} (${move.kind})`);
    }
    expect(m.finished).toBe(true);
    expect(staleChecks).toBeGreaterThan(5);
  });

  it("the best and worst possible games score exactly what the rules say", async () => {
    for (const config of Object.values(CONFIGS)) {
      const { deps, advance } = setup();
      // Best: every answer within the grace for the network.
      let best = await startGame(deps, PACK, ALICE, config);
      for (const p of PUZZLES) {
        best = await act(deps, best.gameId, ALICE, { type: "start" }, best.revision);
        advance(START_GRACE_SECONDS * 1000);
        best = await act(deps, best.gameId, ALICE, { type: "guess", guess: p.answer }, best.revision);
        best = await act(deps, best.gameId, ALICE, { type: "next" }, best.revision);
      }
      expect(best.finished).toBe(true);
      expect(best.total).toBe(PUZZLES.length * config.maxPoints);

      // Worst correct game: five misses, then the answer just before the limit.
      let worst = await startGame(deps, PACK, ALICE, config);
      for (const p of PUZZLES) {
        worst = await act(deps, worst.gameId, ALICE, { type: "start" }, worst.revision);
        for (let k = 0; k < 5; k++) worst = await act(deps, worst.gameId, ALICE, { type: "guess", guess: WRONG }, worst.revision);
        advance((config.limitSeconds + START_GRACE_SECONDS) * 1000 - 1);
        worst = await act(deps, worst.gameId, ALICE, { type: "guess", guess: p.answer }, worst.revision);
        worst = await act(deps, worst.gameId, ALICE, { type: "next" }, worst.revision);
      }
      expect(worst.total).toBe(PUZZLES.length * config.minPoints);
      expect(worst.total).toBeLessThanOrEqual(best.total);

      // Letting every clock run out earns nothing.
      let late = await startGame(deps, PACK, ALICE, config);
      for (let i = 0; i < PUZZLES.length; i++) {
        late = await act(deps, late.gameId, ALICE, { type: "start" }, late.revision);
        advance((config.limitSeconds + START_GRACE_SECONDS) * 1000);
        late = await act(deps, late.gameId, ALICE, { type: "guess", guess: PUZZLES[i]!.answer }, late.revision);
        expect(late.round?.state).toBe("timedOut");
        late = await act(deps, late.gameId, ALICE, { type: "next" }, late.revision);
      }
      expect(late.total).toBe(0);
      expect(late.results.every((r) => r.outcome === "timedOut" && r.seconds === config.limitSeconds)).toBe(true);
    }
  });
});
