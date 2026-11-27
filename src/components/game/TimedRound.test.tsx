// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEffect, frameSize } from "@/game/effects";
import { scoreAt } from "@/game/scoring";
import { formatPoints } from "@/game/round-clock";
import type { TimedScoringConfig } from "@/game/types";
import { fakeCanvas, removeFakeCanvas, sameFrame, testPhoto } from "@/test/fakeCanvas";
import { fakeAnimate, fakeMotionSetting, removeFakeAnimate } from "@/test/fakeMotion";
import { TimedRound, type TimedRoundProps } from "./TimedRound";

// Spec for the timed round screen (#256). Points come from scoreAt and the
// config, not hard-coded, so playtest tweaks don't break these tests.

const SCORING: TimedScoringConfig = { maxPoints: 10_000, minPoints: 100, revealSeconds: 25, limitSeconds: 30, curve: 2 };

function props(overrides: Partial<TimedRoundProps> = {}): TimedRoundProps {
  return {
    phase: "playing",
    imageSrc: "/img/test.webp",
    effect: "pixelate",
    focus: { x: 0.5, y: 0.5 },
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

const livePoints = () => document.querySelector("[data-live-points]")!.textContent;
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
/** Let the photo decode: the fake resolves at once, a few promises deep (setTimeout is faked here). */
const decoded = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
// fireEvent, not user-event: Testing Library's async helpers wait on a real
// setTimeout, which hangs under fake timers.
function typeGuess(text: string) {
  const box = screen.getByRole("textbox", { name: "What is it?" });
  fireEvent.change(box, { target: { value: text } });
  fireEvent.submit(box.closest("form")!);
  return box;
}

beforeEach(() => {
  // Only the clock the screen uses.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  // jsdom can't decode photos; by default the round's photo is still loading.
  fakeCanvas({ "/img/test.webp": "pending" });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  removeFakeAnimate();
  removeFakeCanvas();
});

describe("before the round starts", () => {
  it("offers Start round, and shows no photo or guess box yet", () => {
    const onStart = vi.fn();
    render(<TimedRound {...props({ phase: "ready", imageSrc: null, onStart })} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "What is it?" })).not.toBeInTheDocument();
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
    expect(screen.getByText(/starts at 10,000/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start round" }));
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("ignores Start round while the start is on its way", () => {
    const onStart = vi.fn();
    render(<TimedRound {...props({ phase: "ready", imageSrc: null, pending: true, onStart })} />);
    fireEvent.click(screen.getByRole("button", { name: "Start round" }));
    expect(onStart).not.toHaveBeenCalled();
  });

  it("doesn't count time spent on the Start screen once the round starts", () => {
    const { rerender } = render(<TimedRound {...props({ phase: "ready", imageSrc: null })} />);
    advance(10_000);
    rerender(<TimedRound {...props({ phase: "playing", elapsedSeconds: 0 })} />);
    advance(100);
    expect(livePoints()).toBe(formatPoints(scoreAt(0.1, SCORING)));
  });
});

describe("while the clock runs", () => {
  it("loads the photo and starts a score that drains with time", () => {
    render(<TimedRound {...props()} />);
    expect(screen.getByText("Loading the photo…")).toBeInTheDocument();
    expect(livePoints()).toBe("10,000");
    advance(12_500);
    expect(livePoints()).toBe(formatPoints(scoreAt(12.5, SCORING)));
  });

  it("counts on from the server's elapsed time (a resumed round)", () => {
    render(<TimedRound {...props({ elapsedSeconds: 20 })} />);
    advance(1_000);
    expect(livePoints()).toBe(formatPoints(scoreAt(21, SCORING)));
  });

  it("re-anchors to each new reading from the server instead of adding them up", () => {
    const { rerender } = render(<TimedRound {...props({ elapsedSeconds: 0 })} />);
    advance(5_000);
    // A wrong guess came back, saying 5.2 s had passed on the server.
    rerender(<TimedRound {...props({ elapsedSeconds: 5.2, wrongGuesses: 1, lastWrongGuess: "zebra" })} />);
    advance(1_000);
    expect(livePoints()).toBe(formatPoints(scoreAt(6.2, SCORING)));
  });

  it("has a timer bar with the seconds so far, out of the limit", () => {
    render(<TimedRound {...props()} />);
    advance(7_400);
    const bar = screen.getByRole("progressbar", { name: "Time" });
    expect(bar).toHaveAttribute("aria-valuenow", "7");
    expect(bar).toHaveAttribute("aria-valuemax", String(SCORING.limitSeconds));
    expect(bar).toHaveAttribute("aria-valuetext", `7 of ${SCORING.limitSeconds} seconds`);
  });

  it("marks where the photo becomes clear on the timer bar", () => {
    render(<TimedRound {...props()} />);
    const mark = document.querySelector<HTMLElement>("[data-clear-mark]")!;
    expect(parseFloat(mark.style.left)).toBeCloseTo((SCORING.revealSeconds / SCORING.limitSeconds) * 100, 3);
  });

  it("hides the photo with its effect at the clock's progress, with its focus and seed, clear at the clear time", async () => {
    // The AI solver draws the same frames (#257), so its time is for what the player sees.
    const photo = testPhoto();
    const fake = fakeCanvas({ "/img/test.webp": photo });
    const round = { effect: "tiles", focus: { x: 0.3, y: 0.6 }, seed: "pz-test" } as const;
    const draw = createEffect(round.effect, photo, { focus: round.focus, seed: round.seed, size: frameSize(photo.width, photo.height) });

    const { rerender } = render(<TimedRound {...props({ ...round, elapsedSeconds: SCORING.revealSeconds / 2 })} />);
    await decoded();
    const canvas = screen.getByRole("img", { name: "The photo to guess, still hidden" });
    expect(sameFrame(fake.lastFrame(canvas), draw(0.5))).toBe(true);

    rerender(<TimedRound {...props({ ...round, elapsedSeconds: SCORING.revealSeconds })} />);
    advance(1_000); // the next frame may wait while the page is left free (EffectCanvas)
    expect(sameFrame(fake.lastFrame(canvas), draw(1))).toBe(true);
    expect(livePoints()).toBe(formatPoints(SCORING.minPoints));
  });

  it("tells screen readers the points and seconds left when asked, without announcing every tick", () => {
    render(<TimedRound {...props()} />);
    const timer = screen.getByRole("timer", { name: "Points if you guess now" });
    expect(timer).not.toHaveAttribute("aria-live");
    expect(within(timer).getByText(`10,000 points, ${SCORING.limitSeconds} seconds left`)).toBeInTheDocument();
  });
});

describe("guessing", () => {
  it("sends a guess and clears the box", () => {
    const onGuess = vi.fn();
    render(<TimedRound {...props({ onGuess })} />);
    const box = typeGuess("giraffe");
    expect(onGuess).toHaveBeenCalledWith("giraffe");
    expect(box).toHaveValue("");
  });

  it("doesn't send a blank guess, and says why", () => {
    const onGuess = vi.fn();
    render(<TimedRound {...props({ onGuess })} />);
    typeGuess("   ");
    expect(onGuess).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Type a guess first.");
  });

  it("says Not it after a wrong guess, with a count so repeats are announced", () => {
    const { rerender } = render(<TimedRound {...props()} />);
    rerender(<TimedRound {...props({ wrongGuesses: 1, lastWrongGuess: "zebra" })} />);
    expect(screen.getByRole("status")).toHaveTextContent("Not it: “zebra” (1 wrong guess)");
    rerender(<TimedRound {...props({ wrongGuesses: 2, lastWrongGuess: "zebra" })} />);
    expect(screen.getByRole("status")).toHaveTextContent("(2 wrong guesses)");
  });

  it("shakes the photo and flashes red on each new wrong guess", () => {
    fakeMotionSetting(false);
    const animate = fakeAnimate();
    const { rerender } = render(<TimedRound {...props()} />);
    const flash = () => document.querySelector("[data-wrong-flash]")!.getAttribute("data-wrong-flash");
    expect(animate).not.toHaveBeenCalled();
    expect(flash()).toBe("off");

    rerender(<TimedRound {...props({ wrongGuesses: 1, lastWrongGuess: "zebra" })} />);
    expect(animate).toHaveBeenCalledOnce();
    expect(animate.mock.contexts[0]).toBe(document.querySelector("[data-photo-stage]"));
    expect(flash()).toBe("on");
    advance(500);
    expect(flash()).toBe("off");

    rerender(<TimedRound {...props({ wrongGuesses: 2, lastWrongGuess: "zebra" })} />);
    expect(animate).toHaveBeenCalledTimes(2);
  });

  it("stops the red flash as soon as the round ends, so the clear photo isn't tinted", () => {
    const { rerender } = render(<TimedRound {...props()} />);
    rerender(<TimedRound {...props({ wrongGuesses: 1, lastWrongGuess: "zebra" })} />);
    expect(document.querySelector("[data-wrong-flash]")).toHaveAttribute("data-wrong-flash", "on");
    rerender(
      <TimedRound
        {...props({ phase: "correct", wrongGuesses: 1, result: { answer: "giraffe", points: 9_000, seconds: 1 } })}
      />,
    );
    expect(document.querySelector("[data-wrong-flash]")).toHaveAttribute("data-wrong-flash", "off");
  });

  it("doesn't shake with reduced motion (the red flash and the message still show)", () => {
    fakeMotionSetting(true);
    const animate = fakeAnimate();
    const { rerender } = render(<TimedRound {...props()} />);
    rerender(<TimedRound {...props({ wrongGuesses: 1, lastWrongGuess: "zebra" })} />);
    expect(animate).not.toHaveBeenCalled();
    expect(document.querySelector("[data-wrong-flash]")).toHaveAttribute("data-wrong-flash", "on");
    expect(screen.getByRole("status")).toHaveTextContent("Not it");
  });

  it("doesn't shake for wrong guesses made before a refresh", () => {
    fakeMotionSetting(false);
    const animate = fakeAnimate();
    render(<TimedRound {...props({ wrongGuesses: 3, lastWrongGuess: "zebra" })} />);
    expect(animate).not.toHaveBeenCalled();
  });
});

describe("time's up", () => {
  it("stops guessing and asks the server once when the local clock hits the limit", () => {
    const onTimeUp = vi.fn();
    const onGuess = vi.fn();
    render(<TimedRound {...props({ onTimeUp, onGuess })} />);
    advance(SCORING.limitSeconds * 1000 - 100);
    expect(onTimeUp).not.toHaveBeenCalled();
    advance(200);
    expect(onTimeUp).toHaveBeenCalledOnce();
    expect(livePoints()).toBe("0");
    expect(screen.getByRole("textbox", { name: "What is it?" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Time's up.");

    advance(5_000);
    expect(onTimeUp).toHaveBeenCalledOnce();
  });

  it("asks again if the server, a little behind, says the round is still on (review of #262)", () => {
    const onTimeUp = vi.fn();
    const { rerender } = render(<TimedRound {...props({ onTimeUp })} />);
    advance(SCORING.limitSeconds * 1000 + 100);
    expect(onTimeUp).toHaveBeenCalledOnce();

    const behind = SCORING.limitSeconds - 0.3;
    rerender(<TimedRound {...props({ onTimeUp, elapsedSeconds: behind })} />);
    advance(100);
    expect(screen.getByRole("textbox", { name: "What is it?" })).toBeEnabled();
    expect(onTimeUp).toHaveBeenCalledOnce();

    advance(400);
    expect(onTimeUp).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("textbox", { name: "What is it?" })).toBeDisabled();
  });

  it("shows the answer and 0 points once the server says the round timed out", () => {
    render(
      <TimedRound
        {...props({ phase: "timedOut", elapsedSeconds: 30, result: { answer: "giraffe", points: 0, seconds: 30 } })}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Time's up. It was giraffe.");
    // The result card says it; the monitor shows the same figure decoratively (#183).
    expect(within(screen.getByRole("region", { name: "Round result" })).getByText("+0")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "The photo, fully clear" })).toHaveAttribute("src", "/img/test.webp");
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
  });
});

describe("after a correct guess", () => {
  const solved = props({
    phase: "correct",
    elapsedSeconds: 6.24,
    result: {
      answer: "giraffe",
      points: 6_212,
      seconds: 6.24,
      credit: { source: "A photographer", license: "CC BY-SA 4.0", url: "https://example.org/photo" },
    },
  });

  it("shows the clear photo itself (full resolution, not the effect's frame), the answer, the points and the time", () => {
    render(<TimedRound {...solved} />);
    const photo = screen.getByRole("img", { name: "The photo, fully clear" });
    expect(photo.tagName).toBe("IMG");
    expect(photo).toHaveAttribute("src", "/img/test.webp");
    expect(screen.getByRole("status")).toHaveTextContent("Correct! It's giraffe.");
    expect(screen.getByRole("region", { name: "Round result" })).toHaveTextContent("+6,212 points in 6.2 s");
  });

  it("credits the photo, linked to its source", () => {
    render(<TimedRound {...solved} />);
    expect(screen.getByRole("link", { name: "A photographer" })).toHaveAttribute("href", "https://example.org/photo");
    expect(screen.getByText(/CC BY-SA 4.0/)).toBeInTheDocument();
  });

  it("moves focus to Next image, which goes on", () => {
    const onNext = vi.fn();
    render(<TimedRound {...solved} onNext={onNext} />);
    const next = screen.getByRole("button", { name: "Next image" });
    expect(next).toHaveFocus();
    fireEvent.click(next);
    expect(onNext).toHaveBeenCalledOnce();
  });

  it("says See results on the last image", () => {
    render(<TimedRound {...solved} isLastRound />);
    expect(screen.getByRole("button", { name: "See results" })).toBeInTheDocument();
  });
});

describe("the monitor keeps its shape (#183)", () => {
  it("shows a decorative readout and track before the round, so Start doesn't move the photo", () => {
    render(<TimedRound {...props({ phase: "ready", imageSrc: null })} />);
    const readout = document.querySelector("[data-readout]")!;
    expect(readout).toHaveAttribute("aria-hidden", "true");
    expect(readout).toHaveTextContent(formatPoints(SCORING.maxPoints));
    expect(document.querySelector("[data-timer-fill]")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("shows the round's points on the monitor once it's over", () => {
    render(<TimedRound {...props({ phase: "correct", result: { answer: "giraffe", points: 6_212, seconds: 6.2 } })} />);
    expect(document.querySelector("[data-readout]")).toHaveTextContent("+6,212pts");
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
  });

  it("fills the timer bar with a transform, not a width", () => {
    render(<TimedRound {...props()} />);
    advance(3_000);
    const fill = document.querySelector<HTMLElement>("[data-timer-fill]")!;
    expect(fill.style.transform).toMatch(/^scaleX\(0\.1/u);
    expect(fill.style.width).toBe("");
  });
});
