// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { parsePuzzle } from "@/game/puzzles";
import type { Puzzle } from "@/game/types";
import { fakeAnimate, fakeMotionSetting, removeFakeAnimate } from "@/test/fakeMotion";
import { Confetti } from "./Confetti";
import { PracticeGame } from "./PracticeGame";

// Spec for #48: a satisfying moment on a correct guess, clear feedback on a
// wrong one, never color alone, and no motion for players who turn it off.

// Built with parsePuzzle, like real puzzle data, so the fixture follows the
// Puzzle format as it changes (e.g. #52 adds aiSolvedLevel) without edits here.
function puzzle(id: string, answer: string): Puzzle {
  return parsePuzzle({
    id,
    imageUrl: "/test/image.jpg",
    answer,
    acceptedAnswers: [],
    reveal: { focus: { x: 0.5, y: 0.5 }, zoomLevels: [4, 2, 1] },
    credit: { source: "test", license: "CC0" },
  });
}
const PUZZLES = [puzzle("p1", "Golden Gate Bridge"), puzzle("p2", "Big Ben")];

let animate: Mock;
beforeEach(() => {
  animate = fakeAnimate();
});
afterEach(() => {
  vi.unstubAllGlobals();
  removeFakeAnimate();
});

/** The elements animations were played on, in order. */
function animated(): HTMLElement[] {
  return animate.mock.contexts as HTMLElement[];
}
const shakes = () => animated().filter((el) => el.hasAttribute("data-guess-row"));
const pops = () => animated().filter((el) => el.hasAttribute("data-image-box"));

function setup() {
  const user = userEvent.setup();
  const { container } = render(<PracticeGame puzzles={PUZZLES} />);
  const input = () => screen.getByRole("textbox", { name: "What is it?" });
  const status = () => screen.getByRole("status");
  const confetti = () => container.querySelector("[data-confetti]");
  const icon = () => status().querySelector("[data-feedback-icon]");
  return { user, input, status, confetti, icon };
}

describe("answer feedback with motion allowed", () => {
  beforeEach(() => {
    fakeMotionSetting(false);
  });

  it("shakes the guess box on a wrong guess and marks it with ✗ as well as text", async () => {
    const { user, input, status, icon, confetti } = setup();
    await user.type(input(), "bay bridge{Enter}");

    expect(animated()).toHaveLength(1);
    expect(shakes()).toHaveLength(1);
    expect(icon()).toHaveTextContent("✗");
    expect(icon()).toHaveAttribute("aria-hidden", "true");
    expect(status()).toHaveTextContent("“bay bridge” isn't it");
    expect(confetti()).not.toBeInTheDocument();
  });

  it("keeps keyboard focus in the guess box through the shake", async () => {
    const { user, input } = setup();
    await user.type(input(), "bay bridge{Enter}");
    expect(input()).toHaveFocus();
    // The player can type the next guess straight away.
    await user.keyboard("golden gate bridge{Enter}");
    expect(screen.getByRole("status")).toHaveTextContent("Correct!");
  });

  it("shakes again for every wrong guess, even the same one", async () => {
    const { user, input } = setup();
    await user.type(input(), "bay bridge{Enter}");
    await user.type(input(), "bay bridge{Enter}");
    expect(shakes()).toHaveLength(2);
  });

  it("doesn't shake again when you zoom out after a wrong guess", async () => {
    const { user, input } = setup();
    await user.type(input(), "bay bridge{Enter}");
    await user.click(screen.getByRole("button", { name: /zoom out/i }));
    expect(animated()).toHaveLength(1);
  });

  it("celebrates a correct guess: confetti, a pop on the image, and ✓ with text", async () => {
    const { user, input, status, icon, confetti } = setup();
    await user.type(input(), "golden gate bridge{Enter}");

    expect(confetti()).toBeInTheDocument();
    // Decorative only: hidden from screen readers, which hear the status text.
    expect(confetti()).toHaveAttribute("aria-hidden", "true");
    expect(pops()).toHaveLength(1);
    expect(shakes()).toHaveLength(0);
    expect(icon()).toHaveTextContent("✓");
    expect(status()).toHaveTextContent("Correct! It's Golden Gate Bridge.");
  });

  it("keeps the confetti free of text, so it can never show an answer", async () => {
    const { user, input, confetti } = setup();
    await user.type(input(), "golden gate bridge{Enter}");
    expect(confetti()?.textContent).toBe("");
  });

  it("pops once per solved image, and again for the next one", async () => {
    const { user, input } = setup();
    await user.type(input(), "golden gate bridge{Enter}");
    expect(pops()).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Next image" }));
    expect(pops()).toHaveLength(1);

    await user.type(input(), "big ben{Enter}");
    expect(pops()).toHaveLength(2);
  });

  it("clears the confetti on the next image, and shows it again for the next solve", async () => {
    const { user, input, confetti } = setup();
    await user.type(input(), "golden gate bridge{Enter}");
    await user.click(screen.getByRole("button", { name: "Next image" }));
    expect(confetti()).not.toBeInTheDocument();

    await user.type(input(), "big ben{Enter}");
    expect(confetti()).toBeInTheDocument();
  });

  it("doesn't celebrate or shake on a skip or a blank guess", async () => {
    const { user, icon, confetti } = setup();
    await user.click(screen.getByRole("button", { name: "Guess" }));
    expect(icon()).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Skip this image" }));
    expect(confetti()).not.toBeInTheDocument();
    expect(icon()).not.toBeInTheDocument();
    expect(animated()).toHaveLength(0);
  });

  it("has no confetti on the final score screen", async () => {
    const { user, input, confetti } = setup();
    await user.type(input(), "golden gate bridge{Enter}");
    await user.click(screen.getByRole("button", { name: "Next image" }));
    await user.type(input(), "big ben{Enter}");
    await user.click(screen.getByRole("button", { name: "See results" }));
    expect(confetti()).not.toBeInTheDocument();
  });
});

describe("answer feedback with reduced motion", () => {
  it("plays no animation and no confetti, but keeps the icons and text", async () => {
    fakeMotionSetting(true);
    const { user, input, status, icon, confetti } = setup();

    await user.type(input(), "bay bridge{Enter}");
    expect(icon()).toHaveTextContent("✗");
    expect(status()).toHaveTextContent("isn't it");

    await user.type(input(), "golden gate bridge{Enter}");
    expect(icon()).toHaveTextContent("✓");
    expect(status()).toHaveTextContent("Correct!");

    expect(animate).not.toHaveBeenCalled();
    expect(confetti()).not.toBeInTheDocument();
  });

  it("removes the confetti at once if the player turns on reduced motion mid-celebration", async () => {
    const setting = fakeMotionSetting(false);
    const { user, input, status, confetti } = setup();
    await user.type(input(), "golden gate bridge{Enter}");
    expect(confetti()).toBeInTheDocument();

    setting.set(true);
    expect(confetti()).not.toBeInTheDocument();
    expect(status()).toHaveTextContent("Correct!");
  });
});

describe("Confetti", () => {
  it("renders nothing on the server, before the browser reports the motion setting", () => {
    expect(renderToString(<Confetti />)).toBe("");
  });

  it("plays in a browser without matchMedia, which has no motion setting to respect", () => {
    const { container } = render(<Confetti />);
    expect(container.querySelector("[data-confetti]")).toBeInTheDocument();
  });
});
