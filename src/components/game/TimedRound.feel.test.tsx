// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SPEED_TIERS } from "@/game/feedback";
import type { TimedScoringConfig } from "@/game/types";
import { fakeMotionSetting, removeFakeAnimate } from "@/test/fakeMotion";
import { resetSoundChoice, sounds } from "./sound";
import { TimedRound, type TimedRoundProps } from "./TimedRound";

// Spec for the timed round's game feel (#283): streaks, speed badges, the
// points pop, sounds and the Sound toggle. Thresholds come from the tables.

const SCORING: TimedScoringConfig = { maxPoints: 10_000, minPoints: 100, revealSeconds: 25, limitSeconds: 30, curve: 2 };
const lightningAt = SCORING.revealSeconds * SPEED_TIERS.find((t) => t.tier === "lightning")!.share;
const slow = SCORING.revealSeconds;

function props(overrides: Partial<TimedRoundProps> = {}): TimedRoundProps {
  return {
    phase: "playing",
    imageSrc: "/img/test.webp",
    elapsedSeconds: 0,
    scoring: SCORING,
    wrongGuesses: 0,
    isLastRound: false,
    onStart: vi.fn(),
    onGuess: vi.fn(),
    onNext: vi.fn(),
    onTimeUp: vi.fn(),
    ...overrides,
  };
}

const won = (seconds: number, points = 5_000) =>
  props({ phase: "correct", elapsedSeconds: seconds, result: { answer: "giraffe", points, seconds } });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  window.localStorage.clear();
  resetSoundChoice();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  removeFakeAnimate();
});

describe("streak chip", () => {
  it("is hidden below 2 in a row", () => {
    render(<TimedRound {...props({ streak: 1 })} />);
    expect(screen.queryByText(/in a row/u)).not.toBeInTheDocument();
  });

  it("shows the streak so far while playing", () => {
    render(<TimedRound {...props({ streak: 2 })} />);
    expect(screen.getByText("2 in a row")).toBeInTheDocument();
  });

  it("counts this round once it's guessed", () => {
    render(<TimedRound {...won(slow)} streak={1} />);
    expect(screen.getByText("2 in a row")).toBeInTheDocument();
  });

  it("is gone after a time-out, which ends the streak", () => {
    render(<TimedRound {...props({ phase: "timedOut", streak: 3, result: { answer: "giraffe", points: 0, seconds: 30 } })} />);
    expect(screen.queryByText(/in a row/u)).not.toBeInTheDocument();
  });
});

describe("speed badge", () => {
  it("calls a very fast guess lightning fast, in words", () => {
    render(<TimedRound {...won(lightningAt)} />);
    expect(within(screen.getByRole("region", { name: "Round result" })).getByText("Lightning fast!")).toBeInTheDocument();
  });

  it("gives a slow guess no badge, and a time-out none either", () => {
    const { rerender } = render(<TimedRound {...won(slow)} />);
    expect(screen.queryByText(/Lightning fast|Quick eye/u)).not.toBeInTheDocument();
    rerender(<TimedRound {...props({ phase: "timedOut", result: { answer: "giraffe", points: 0, seconds: 0.5 } })} />);
    expect(screen.queryByText(/Lightning fast|Quick eye/u)).not.toBeInTheDocument();
  });
});

describe("points pop and confetti", () => {
  it("floats the points and bursts confetti when the guess lands while on screen", () => {
    const { rerender } = render(<TimedRound {...props()} />);
    rerender(<TimedRound {...won(2, 9_000)} />);
    expect(document.querySelector("[data-points-float]")).toHaveTextContent("+9,000");
    expect(document.querySelector("[data-confetti]")).toBeInTheDocument();
  });

  it("doesn't replay for a round that was already over when it appeared (a refresh)", () => {
    render(<TimedRound {...won(2, 9_000)} />);
    expect(document.querySelector("[data-points-float]")).not.toBeInTheDocument();
    expect(document.querySelector("[data-confetti]")).not.toBeInTheDocument();
  });

  it("is left out with reduced motion; the result still says the points", () => {
    fakeMotionSetting(true);
    const { rerender } = render(<TimedRound {...props()} />);
    rerender(<TimedRound {...won(2, 9_000)} />);
    expect(document.querySelector("[data-points-float]")).not.toBeInTheDocument();
    expect(document.querySelector("[data-confetti]")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Round result" })).toHaveTextContent("+9,000 points");
  });
});

describe("sounds", () => {
  it("plays the start sound when the round starts", () => {
    const start = vi.spyOn(sounds, "start");
    const { rerender } = render(<TimedRound {...props({ phase: "ready", imageSrc: null })} />);
    expect(start).not.toHaveBeenCalled();
    rerender(<TimedRound {...props()} />);
    expect(start).toHaveBeenCalledOnce();
  });

  it("plays the correct sound a step higher for each round in the streak, with a sparkle when lightning fast", () => {
    const correct = vi.spyOn(sounds, "correct");
    const { rerender } = render(<TimedRound {...props({ streak: 2 })} />);
    rerender(<TimedRound {...won(lightningAt)} streak={2} />);
    expect(correct).toHaveBeenCalledExactlyOnceWith(2, true);
  });

  it("doesn't play the correct sound for a round that was already over", () => {
    const correct = vi.spyOn(sounds, "correct");
    render(<TimedRound {...won(2)} />);
    expect(correct).not.toHaveBeenCalled();
  });

  it("plays the wrong sound once per new wrong guess", () => {
    const wrong = vi.spyOn(sounds, "wrong");
    const { rerender } = render(<TimedRound {...props({ wrongGuesses: 1 })} />);
    expect(wrong).not.toHaveBeenCalled();
    rerender(<TimedRound {...props({ wrongGuesses: 2, lastWrongGuess: "zebra" })} />);
    rerender(<TimedRound {...props({ wrongGuesses: 2, lastWrongGuess: "zebra" })} />);
    expect(wrong).toHaveBeenCalledOnce();
  });

  it("ticks once for each of the last 5 seconds", () => {
    const tick = vi.spyOn(sounds, "tick");
    render(<TimedRound {...props({ elapsedSeconds: SCORING.limitSeconds - 6 })} />);
    // A second at a time, as the browser renders between ticks.
    for (let s = 0; s < 6; s++) act(() => void vi.advanceTimersByTime(1_000));
    expect(tick.mock.calls.map(([s]) => s)).toEqual([5, 4, 3, 2, 1]);
  });

  it("plays time's up when the server ends the round", () => {
    const timeUp = vi.spyOn(sounds, "timeUp");
    const { rerender } = render(<TimedRound {...props()} />);
    rerender(<TimedRound {...props({ phase: "timedOut", result: { answer: "giraffe", points: 0, seconds: 30 } })} />);
    expect(timeUp).toHaveBeenCalledOnce();
  });
});

describe("Sound toggle", () => {
  it("is on by default and says so", () => {
    render(<TimedRound {...props()} />);
    expect(screen.getByRole("button", { name: "Sound" })).toHaveAttribute("aria-pressed", "true");
  });

  it("turns sound off, and the choice is remembered", () => {
    const { unmount } = render(<TimedRound {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "Sound" }));
    expect(screen.getByRole("button", { name: "Sound" })).toHaveAttribute("aria-pressed", "false");
    unmount();
    resetSoundChoice();
    render(<TimedRound {...props()} />);
    expect(screen.getByRole("button", { name: "Sound" })).toHaveAttribute("aria-pressed", "false");
  });
});
