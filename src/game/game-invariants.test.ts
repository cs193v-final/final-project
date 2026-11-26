// Seeded random games through the server game (`startGame` / `act` / `getGame`),
// checked move by move against a small model of the rules written here from
// scratch: what each move should do, what each image is worth, the revision,
// the running total, and when answers may appear. The anti-cheat random test in
// server-game.test.ts checks only that no answer leaks; this checks the game
// is played and scored right, for several scoring configs (including ones
// where the minPoints floor kicks in).
import { describe, expect, it } from "vitest";

import { SAMPLE_PUZZLES } from "../puzzles/index.ts";
import {
  act,
  GameConflictError,
  getGame,
  MemoryGameStore,
  puzzleSourceFrom,
  startGame,
  type GameDeps,
  type GameOwner,
} from "./server-game.ts";
import type { GameAction, GameView, Pack, Puzzle, ScoringConfig } from "./types.ts";

const ALICE: GameOwner = { userId: "alice" };
const PUZZLES: Puzzle[] = SAMPLE_PUZZLES.map((p, i) => ({ ...p, id: `p${i + 1}`, imageUrl: `/img/p${i + 1}.jpg` }));
const PACK: Pack = { id: "practice", kind: "practice", title: "Practice", theme: "Mixed", puzzleIds: PUZZLES.map((p) => p.id) };
// Nowhere near any sample answer, even with typo tolerance.
const WRONG = "definitely not this one";

const CONFIGS: Record<string, ScoringConfig> = {
  gentle: { basePoints: 100, revealPenalty: 20, wrongGuessPenalty: 10, minPoints: 10, skipPoints: 0 },
  // Two reveals or a few misses hit the floor.
  harsh: { basePoints: 60, revealPenalty: 30, wrongGuessPenalty: 25, minPoints: 5, skipPoints: 1 },
  // No penalties at all: every correct answer is worth the base.
  flat: { basePoints: 50, revealPenalty: 0, wrongGuessPenalty: 0, minPoints: 0, skipPoints: 0 },
};

/** Small seeded generator (an LCG), so a failure is reproducible from its seed. */
function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
}

/** What the game should look like, worked out from the rules alone. */
type Model = {
  index: number;
  level: number;
  wrong: number;
  state: "playing" | "correct" | "skipped";
  finished: boolean;
  revision: number;
  points: number[]; // per finished round
};

const maxLevel = (i: number) => PUZZLES[i]!.reveal.zoomLevels.length - 1;
const worth = (c: ScoringConfig, level: number, wrong: number) =>
  Math.max(c.minPoints, c.basePoints - level * c.revealPenalty - wrong * c.wrongGuessPenalty);

/** Applies `move` to the model. Returns false if the game should reject it (nothing changes, not even the revision). */
function apply(m: Model, move: Move, c: ScoringConfig): boolean {
  if (m.finished) return false;
  if (move.kind === "next") {
    if (m.state === "playing") return false;
    if (m.index === PUZZLES.length - 1) m.finished = true;
    else Object.assign(m, { index: m.index + 1, level: 0, wrong: 0, state: "playing" });
  } else {
    if (m.state !== "playing") return false;
    switch (move.kind) {
      case "reveal":
        if (m.level >= maxLevel(m.index)) return false;
        m.level += 1;
        break;
      case "blank":
        return false;
      case "wrong":
        m.wrong += 1;
        break;
      case "answer":
      case "accepted":
        m.state = "correct";
        m.points.push(worth(c, m.level, m.wrong));
        break;
      case "skip":
        m.state = "skipped";
        m.points.push(c.skipPoints);
        break;
    }
  }
  m.revision += 1;
  return true;
}

type Move = { kind: "reveal" | "blank" | "wrong" | "answer" | "accepted" | "skip" | "next" };

function pick(random: () => number): Move {
  const r = random();
  if (r < 0.3) return { kind: "reveal" };
  if (r < 0.37) return { kind: "blank" };
  if (r < 0.57) return { kind: "wrong" };
  if (r < 0.67) return { kind: "answer" };
  if (r < 0.72) return { kind: "accepted" };
  if (r < 0.8) return { kind: "skip" };
  return { kind: "next" };
}

/** The action a player would send for `move` on the current puzzle. */
function actionFor(move: Move, m: Model, random: () => number): GameAction {
  const puzzle = PUZZLES[Math.min(m.index, PUZZLES.length - 1)]!;
  switch (move.kind) {
    case "reveal":
    case "skip":
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
  }
}

/** The view agrees with the model, field by field. */
function expectMatches(view: GameView, m: Model, c: ScoringConfig, where: string): void {
  const ctx = `${where}: ${JSON.stringify({ ...m, points: m.points.length })}`;
  expect(view.revision, ctx).toBe(m.revision);
  expect(view.finished, ctx).toBe(m.finished);
  expect(view.results.map((r) => r.points), ctx).toEqual(m.points);
  expect(view.total, ctx).toBe(m.points.reduce((a, b) => a + b, 0));
  for (const r of view.results) {
    expect(r.points, ctx).toBeGreaterThanOrEqual(Math.min(c.skipPoints, c.minPoints));
    expect(r.points, ctx).toBeLessThanOrEqual(Math.max(c.basePoints, c.skipPoints));
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
  expect(round.revealLevel, ctx).toBe(m.level);
  expect(round.levelCount, ctx).toBe(maxLevel(m.index) + 1);
  expect(round.wrongGuesses, ctx).toBe(m.wrong);
  expect(view.results, ctx).toHaveLength(m.state === "playing" ? m.index : m.index + 1);
  if (m.state === "playing") {
    expect(round.pointsAvailable, ctx).toBe(worth(c, m.level, m.wrong));
    expect(round, ctx).not.toHaveProperty("answer");
  } else {
    expect(round.answer, ctx).toBe(PUZZLES[m.index]!.answer);
  }
}

function setup(): GameDeps {
  let n = 0;
  return { games: new MemoryGameStore(() => `game-${++n}`), puzzles: puzzleSourceFrom(PUZZLES) };
}

describe("random games follow the rules (model check)", () => {
  it("the sample puzzles give the model something to check", () => {
    // Several levels to reveal, and at least one accepted answer, or parts of the model never run.
    expect(PUZZLES.length).toBeGreaterThanOrEqual(3);
    expect(PUZZLES.every((p) => p.reveal.zoomLevels.length >= 2)).toBe(true);
    expect(PUZZLES.some((p) => p.acceptedAnswers.length > 0)).toBe(true);
  });

  for (const [name, config] of Object.entries(CONFIGS)) {
    it(`plays 40 seeded games move by move with the "${name}" scoring`, async () => {
      const deps = setup();
      const seen = new Set<string>();
      let finishedGames = 0;

      for (let g = 0; g < 40; g++) {
        const seed = 1000 * Object.keys(CONFIGS).indexOf(name) + g;
        const random = rng(seed);
        let view = await startGame(deps, PACK, ALICE, config);
        const m: Model = { index: 0, level: 0, wrong: 0, state: "playing", finished: false, revision: 0, points: [] };
        expectMatches(view, m, config, `seed ${seed}, start`);

        for (let n = 0; n < 120; n++) {
          const move = pick(random);
          const action = actionFor(move, m, random);
          const accepted = apply(m, move, config);
          seen.add(`${move.kind}:${accepted ? "ok" : "rejected"}`);
          view = await act(deps, view.gameId, ALICE, action, view.revision);
          expectMatches(view, m, config, `seed ${seed}, move ${n} (${move.kind})`);
          // A reload shows exactly what the last response did.
          expect(await getGame(deps, view.gameId, ALICE)).toEqual(view);
          if (m.finished && random() < 0.2) break;
        }
        if (m.finished) finishedGames++;
      }

      // The walk really did exercise every kind of move, accepted and rejected.
      for (const k of ["reveal:ok", "reveal:rejected", "blank:rejected", "wrong:ok", "answer:ok", "skip:ok", "next:ok", "next:rejected"]) {
        expect(seen, k).toContain(k);
      }
      expect(finishedGames).toBeGreaterThan(10);
    });
  }

  it("a move sent with an old revision is refused and changes nothing, at any point in a game", async () => {
    const deps = setup();
    const random = rng(7);
    const config = CONFIGS.gentle!;
    let view = await startGame(deps, PACK, ALICE, config);
    const m: Model = { index: 0, level: 0, wrong: 0, state: "playing", finished: false, revision: 0, points: [] };
    let staleChecks = 0;

    for (let n = 0; n < 200 && !m.finished; n++) {
      const move = pick(random);
      const action = actionFor(move, m, random);
      if (view.revision > 0 && random() < 0.25) {
        const stale = Math.floor(random() * view.revision);
        await expect(act(deps, view.gameId, ALICE, action, stale)).rejects.toBeInstanceOf(GameConflictError);
        // And one from the future (a forged revision) is refused too.
        await expect(act(deps, view.gameId, ALICE, action, view.revision + 1)).rejects.toBeInstanceOf(GameConflictError);
        expect(await getGame(deps, view.gameId, ALICE)).toEqual(view);
        staleChecks++;
      }
      apply(m, move, config);
      view = await act(deps, view.gameId, ALICE, action, view.revision);
      expectMatches(view, m, config, `move ${n} (${move.kind})`);
    }
    expect(m.finished).toBe(true);
    expect(staleChecks).toBeGreaterThan(5);
  });

  it("the best and worst possible games score exactly what the rules say", async () => {
    for (const config of Object.values(CONFIGS)) {
      const deps = setup();
      // Best: every answer at the first view, no misses.
      let best = await startGame(deps, PACK, ALICE, config);
      for (const p of PUZZLES) {
        best = await act(deps, best.gameId, ALICE, { type: "guess", guess: p.answer }, best.revision);
        best = await act(deps, best.gameId, ALICE, { type: "next" }, best.revision);
      }
      expect(best.finished).toBe(true);
      expect(best.total).toBe(PUZZLES.length * config.basePoints);

      // Worst correct game: reveal everything and miss five times, then answer.
      let worst = await startGame(deps, PACK, ALICE, config);
      let expected = 0;
      for (const [i, p] of PUZZLES.entries()) {
        for (let k = 0; k < maxLevel(i); k++) worst = await act(deps, worst.gameId, ALICE, { type: "reveal" }, worst.revision);
        for (let k = 0; k < 5; k++) worst = await act(deps, worst.gameId, ALICE, { type: "guess", guess: WRONG }, worst.revision);
        expected += worth(config, maxLevel(i), 5);
        worst = await act(deps, worst.gameId, ALICE, { type: "guess", guess: p.answer }, worst.revision);
        worst = await act(deps, worst.gameId, ALICE, { type: "next" }, worst.revision);
      }
      expect(worst.total).toBe(expected);
      expect(worst.total).toBeGreaterThanOrEqual(PUZZLES.length * config.minPoints);
      expect(worst.total).toBeLessThanOrEqual(best.total);

      // Skipping everything earns skipPoints per image, however much was revealed first.
      let skipped = await startGame(deps, PACK, ALICE, config);
      for (let i = 0; i < PUZZLES.length; i++) {
        skipped = await act(deps, skipped.gameId, ALICE, { type: "reveal" }, skipped.revision);
        skipped = await act(deps, skipped.gameId, ALICE, { type: "skip" }, skipped.revision);
        skipped = await act(deps, skipped.gameId, ALICE, { type: "next" }, skipped.revision);
      }
      expect(skipped.total).toBe(PUZZLES.length * config.skipPoints);
    }
  });
});
