import { describe, expect, it } from "vitest";
import { TIMED_SCORING_CONFIG } from "@/game/scoring-config";
import type { GameView, PublicRound } from "@/game/types";
import { feedbackFor, finalScoreLabels, learnAnswer, NO_FEEDBACK, type Feedback } from "./practice";

function round(overrides: Partial<PublicRound> = {}): PublicRound {
  return {
    position: 1,
    puzzleCount: 2,
    state: "playing",
    elapsedSeconds: 1,
    imageSrc: "/img/1.jpg",
    effect: "pixelate",
    seed: "p1",
    focus: { x: 0.5, y: 0.5 },
    wrongGuesses: 0,
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
    finished: r === null,
    scoring: TIMED_SCORING_CONFIG,
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

  it("a time-out shows the answer the server revealed (#255)", () => {
    const v = view(round({ state: "timedOut", ...ENDED }));
    expect(feedbackFor({ type: "guess", guess: "too late" }, v, WRONG)).toEqual({ kind: "timedOut", answer: "Eiffel Tower" });
  });

  it("next clears the feedback", () => {
    expect(feedbackFor({ type: "next" }, view(round({ position: 2 })), { kind: "timedOut", answer: "x" })).toEqual(NO_FEEDBACK);
  });

  it("start clears the feedback", () => {
    expect(feedbackFor({ type: "start" }, view(round()), WRONG)).toEqual(NO_FEEDBACK);
  });

  it("rebuilds the feedback from the view alone after a refresh", () => {
    expect(feedbackFor(null, view(round()), WRONG)).toEqual(NO_FEEDBACK);
    expect(
      feedbackFor(null, view(round({ wrongGuesses: 2 }), { lastOutcome: { kind: "incorrect", normalizedGuess: "x" } }), NO_FEEDBACK),
    ).toEqual({ kind: "incorrect", guess: "x", wrongGuesses: 2 });
    expect(feedbackFor(null, view(round({ state: "timedOut", ...ENDED })), NO_FEEDBACK)).toEqual({
      kind: "timedOut",
      answer: "Eiffel Tower",
    });
    expect(feedbackFor(null, view(null), WRONG)).toEqual(NO_FEEDBACK);
  });
});

describe("learnAnswer and finalScoreLabels", () => {
  const result = (puzzleId: string) => ({
    puzzleId,
    outcome: "timedOut" as const,
    seconds: 30,
    wrongGuesses: 0,
    points: 0,
  });

  it("remembers each answer once the server reveals it, and nothing while playing", () => {
    let known = learnAnswer({}, view(round()));
    expect(known).toEqual({});
    known = learnAnswer(known, view(round({ state: "timedOut", ...ENDED })));
    known = learnAnswer(known, view(round({ position: 2, state: "correct", answer: "Big Ben" })));
    expect(known).toEqual({ 1: "Eiffel Tower", 2: "Big Ben" });
    expect(learnAnswer(known, view(round({ state: "timedOut", ...ENDED })))).toBe(known);
  });

  it("labels each finished round with its answer, or its number if this tab never saw it", () => {
    const finished = view(null, { results: [result("a"), result("b")] });
    expect(finalScoreLabels(finished, { 1: "Eiffel Tower" })).toEqual([
      { id: "a", answer: "Eiffel Tower" },
      { id: "b", answer: "Image 2" },
    ]);
  });
});
