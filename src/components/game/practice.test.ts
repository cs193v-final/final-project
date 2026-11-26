import { describe, expect, it } from "vitest";
import { SCORING_CONFIG } from "@/game/scoring-config";
import type { GameView, PublicRound } from "@/game/types";
import { feedbackFor, finalScoreLabels, learnAnswer, NO_FEEDBACK, type Feedback } from "./practice";

function round(overrides: Partial<PublicRound> = {}): PublicRound {
  return {
    position: 1,
    puzzleCount: 2,
    state: "playing",
    revealLevel: 0,
    levelCount: 3,
    imageSrc: "/img/1.jpg",
    wrongGuesses: 0,
    pointsAvailable: 100,
    aiSolvedLevel: null,
    ...overrides,
  };
}

function view(r: PublicRound | null, extra: Partial<GameView> = {}): GameView {
  return {
    gameId: "g1",
    revision: 0,
    pack: { id: "pk", kind: "practice", title: "Practice", theme: "Mixed" },
    round: r,
    results: [],
    total: 0,
    scoring: SCORING_CONFIG,
    finished: r === null,
    ...extra,
  };
}

const ENDED = { answer: "Eiffel Tower", credit: { source: "test", license: "CC0" } };
const WRONG: Feedback = { kind: "incorrect", guess: "louvre", wrongGuesses: 1 };

describe("feedbackFor", () => {
  it("a wrong guess shows the normalized guess and the round's wrong-guess count", () => {
    const v = view(round({ wrongGuesses: 1 }), { lastOutcome: { kind: "incorrect", normalizedGuess: "the louvre" } });
    expect(feedbackFor({ type: "guess", guess: "  The LOUVRE " }, v, NO_FEEDBACK)).toEqual({
      kind: "incorrect",
      guess: "the louvre",
      wrongGuesses: 1,
    });
  });

  it("a correct guess shows the answer the server revealed and what matched", () => {
    const v = view(round({ state: "correct", ...ENDED }), { lastOutcome: { kind: "correct", matched: "Eiffel Tower" } });
    expect(feedbackFor({ type: "guess", guess: "eiffel tower" }, v, NO_FEEDBACK)).toEqual({
      kind: "correct",
      answer: "Eiffel Tower",
      matched: "Eiffel Tower",
    });
  });

  it("skipping shows the answer the server revealed", () => {
    const v = view(round({ state: "skipped", ...ENDED }));
    expect(feedbackFor({ type: "skip" }, v, WRONG)).toEqual({ kind: "skipped", answer: "Eiffel Tower" });
  });

  it("next clears the feedback", () => {
    expect(feedbackFor({ type: "next" }, view(round({ position: 2 })), { kind: "skipped", answer: "x" })).toEqual(NO_FEEDBACK);
  });

  it("reveal keeps the current feedback", () => {
    const v = view(round({ revealLevel: 1, wrongGuesses: 1 }));
    expect(feedbackFor({ type: "reveal" }, v, WRONG)).toBe(WRONG);
  });

  it("rebuilds the feedback from the view alone after a refresh", () => {
    expect(feedbackFor(null, view(round()), WRONG)).toEqual(NO_FEEDBACK);
    expect(
      feedbackFor(null, view(round({ wrongGuesses: 2 }), { lastOutcome: { kind: "incorrect", normalizedGuess: "x" } }), NO_FEEDBACK),
    ).toEqual({ kind: "incorrect", guess: "x", wrongGuesses: 2 });
    expect(feedbackFor(null, view(round({ state: "skipped", ...ENDED })), NO_FEEDBACK)).toEqual({
      kind: "skipped",
      answer: "Eiffel Tower",
    });
    expect(feedbackFor(null, view(null), WRONG)).toEqual(NO_FEEDBACK);
  });
});

describe("learnAnswer and finalScoreLabels", () => {
  const result = (puzzleId: string) => ({
    puzzleId,
    outcome: "skipped" as const,
    revealLevelReached: 0,
    wrongGuesses: 0,
    points: 0,
    breakdown: { base: 0, revealPenalty: 0, wrongGuessPenalty: 0 },
  });

  it("remembers each answer once the server reveals it, and nothing while playing", () => {
    let known = learnAnswer({}, view(round()));
    expect(known).toEqual({});
    known = learnAnswer(known, view(round({ state: "skipped", ...ENDED })));
    known = learnAnswer(known, view(round({ position: 2, state: "correct", answer: "Big Ben" })));
    expect(known).toEqual({ 1: "Eiffel Tower", 2: "Big Ben" });
    expect(learnAnswer(known, view(round({ state: "skipped", ...ENDED })))).toBe(known);
  });

  it("labels each finished round with its answer, or its number if this tab never saw it", () => {
    const finished = view(null, { results: [result("a"), result("b")] });
    expect(finalScoreLabels(finished, { 1: "Eiffel Tower" })).toEqual([
      { id: "a", answer: "Eiffel Tower" },
      { id: "b", answer: "Image 2" },
    ]);
  });
});
