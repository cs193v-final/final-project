// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { Puzzle } from "@/game/types";
import { Confetti } from "./Confetti";
import { PracticeGame } from "./PracticeGame";

// Spec for #48: a satisfying moment on a correct guess, clear feedback on a
// wrong one, never color alone, and no motion for players who turn it off.

function puzzle(id: string, answer: string): Puzzle {
  return {
    id,
    imageUrl: "",
    answer,
    acceptedAnswers: [],
    reveal: { focus: { x: 0.5, y: 0.5 }, zoomLevels: [4, 2, 1] },
    credit: { source: "test", license: "CC0" },
  };
}
const PUZZLES = [puzzle("p1", "Golden Gate Bridge"), puzzle("p2", "Big Ben")];

/** jsdom has no matchMedia; stand in for the player's motion setting. */
function setReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: reduce && query === "(prefers-reduced-motion: reduce)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

// jsdom has no Web Animations API either. Record which element each animation ran on.
let animate: Mock;
beforeEach(() => {
  animate = vi.fn(() => ({ cancel: vi.fn() }));
  HTMLElement.prototype.animate = animate as unknown as HTMLElement["animate"];
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
});

/** The elements animations were played on, in order. */
function animated(): HTMLElement[] {
  return animate.mock.contexts as HTMLElement[];
}

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
  beforeEach(() => setReducedMotion(false));

  it("shakes the guess box on a wrong guess and marks it with ✗ as well as text", async () => {
    const { user, input, status, icon, confetti } = setup();
    await user.type(input(), "bay bridge{Enter}");

    expect(animated()).toHaveLength(1);
    expect(animated()[0]).toHaveAttribute("data-guess-row");
    expect(icon()).toHaveTextContent("✗");
    expect(icon()).toHaveAttribute("aria-hidden", "true");
    expect(status()).toHaveTextContent("“bay bridge” isn't it");
    expect(confetti()).not.toBeInTheDocument();
  });

  it("shakes again for every wrong guess, even the same one", async () => {
    const { user, input } = setup();
    await user.type(input(), "bay bridge{Enter}");
    await user.type(input(), "bay bridge{Enter}");
    expect(animated().filter((el) => el.hasAttribute("data-guess-row"))).toHaveLength(2);
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
    expect(animated().some((el) => el.hasAttribute("data-image-box"))).toBe(true);
    expect(icon()).toHaveTextContent("✓");
    expect(status()).toHaveTextContent("Correct! It's Golden Gate Bridge.");
  });

  it("clears the confetti on the next image", async () => {
    const { user, input, confetti } = setup();
    await user.type(input(), "golden gate bridge{Enter}");
    await user.click(screen.getByRole("button", { name: "Next image" }));
    expect(confetti()).not.toBeInTheDocument();
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
});

describe("answer feedback with reduced motion", () => {
  beforeEach(() => setReducedMotion(true));

  it("plays no animation and no confetti, but keeps the icons and text", async () => {
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
});

describe("Confetti", () => {
  it("renders nothing on the server, before the browser reports the motion setting", () => {
    expect(renderToString(<Confetti />)).toBe("");
  });

  it("plays in a browser without matchMedia, which has no motion setting to respect", () => {
    // Older browsers without matchMedia also lack the setting, so there's nothing to respect.
    const { container } = render(<Confetti />);
    expect(container.querySelector("[data-confetti]")).toBeInTheDocument();
  });
});
