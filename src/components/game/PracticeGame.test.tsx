// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Puzzle } from "@/game/types";
import { PracticeGame } from "./PracticeGame";

function puzzle(id: string, answer: string, acceptedAnswers: string[] = []): Puzzle {
  return {
    id,
    imageUrl: "",
    answer,
    acceptedAnswers,
    reveal: { focus: { x: 0.5, y: 0.5 }, zoomLevels: [4, 2, 1] },
    credit: { source: "test", license: "CC0" },
  };
}
const PUZZLES = [puzzle("p1", "Golden Gate Bridge", ["Golden Gate"]), puzzle("p2", "Big Ben")];

function setup() {
  const user = userEvent.setup();
  render(<PracticeGame puzzles={PUZZLES} />);
  const input = () => screen.getByRole("textbox", { name: "What is it?" });
  const status = () => screen.getByRole("status");
  return { user, input, status };
}

describe("PracticeGame guessing", () => {
  it("submits with Enter, shows a wrong guess, counts it and clears the input", async () => {
    const { user, input, status } = setup();
    expect(input()).toHaveFocus();
    await user.type(input(), "  Bay  Bridge {Enter}");
    expect(status()).toHaveTextContent("“bay bridge” isn't it (1 wrong guess).");
    expect(screen.getByText("1 wrong guess")).toBeInTheDocument();
    expect(input()).toHaveValue("");
  });

  it("changes the announced text when the same wrong guess is repeated", async () => {
    const { user, input, status } = setup();
    await user.type(input(), "bay bridge{Enter}");
    const first = status().textContent;
    await user.type(input(), "bay bridge{Enter}");
    expect(status().textContent).not.toBe(first);
    expect(status()).toHaveTextContent("(2 wrong guesses)");
  });

  it("asks for a guess on blank input without counting it", async () => {
    const { user, input, status } = setup();
    await user.type(input(), "   ");
    await user.click(screen.getByRole("button", { name: "Guess" }));
    expect(status()).toHaveTextContent("Type a guess first.");
    expect(screen.queryByText(/wrong guess/)).not.toBeInTheDocument();
    expect(input()).toHaveValue("   ");
  });

  it("accepts an alternate answer, shows the real answer, then focuses Next image", async () => {
    const { user, input, status } = setup();
    await user.type(input(), "golden gate{Enter}");
    expect(status()).toHaveTextContent("Correct! It's Golden Gate Bridge (you said Golden Gate).");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next image" })).toHaveFocus();
  });

  it("skip reveals the answer", async () => {
    const { user, status } = setup();
    await user.click(screen.getByRole("button", { name: "Skip this image" }));
    expect(status()).toHaveTextContent("Skipped. It was Golden Gate Bridge.");
  });

  it("plays through every image to the end and can restart", async () => {
    const { user, input, status } = setup();
    expect(screen.getByText("Image 1 of 2")).toBeInTheDocument();

    await user.type(input(), "golden gate bridge{Enter}");
    await user.click(screen.getByRole("button", { name: "Next image" }));

    expect(screen.getByText("Image 2 of 2")).toBeInTheDocument();
    expect(status()).toHaveTextContent(""); // feedback reset for the new image
    expect(screen.queryByText(/wrong guess/)).not.toBeInTheDocument();
    expect(input()).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Skip this image" }));
    await user.click(screen.getByRole("button", { name: "See results" }));
    expect(screen.getByRole("heading", { name: "Practice complete" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Play again" }));
    expect(screen.getByText("Image 1 of 2")).toBeInTheDocument();
  });

  it("zoom out steps the viewer to the full image, then stays focused but does nothing", async () => {
    const { user } = setup();
    const zoom = screen.getByRole("button", { name: "Zoom out" });
    expect(screen.getByText("Zoom level 1 of 3")).toBeInTheDocument();
    await user.click(zoom);
    expect(screen.getByText("Zoom level 2 of 3")).toBeInTheDocument();
    await user.click(zoom);
    expect(screen.getByText("Zoom level 3 of 3")).toBeInTheDocument();
    expect(screen.getByText("Showing the full image")).toBeInTheDocument();
    expect(zoom).toHaveAttribute("aria-disabled", "true");
    await user.click(zoom);
    expect(screen.getByText("Zoom level 3 of 3")).toBeInTheDocument();
    expect(zoom).toHaveFocus();
  });

  it("shows the full image and the photo credit once the round is over", async () => {
    const { user, input } = setup();
    expect(screen.queryByText(/Photo:/)).not.toBeInTheDocument();
    await user.type(input(), "golden gate{Enter}");
    expect(screen.getByText("Full image")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Zoom out" })).not.toBeInTheDocument();
    expect(screen.getByText(/Photo: test \(CC0\)/)).toBeInTheDocument();
  });

  it("starts the next image at its tightest crop", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Zoom out" }));
    await user.click(screen.getByRole("button", { name: "Skip this image" }));
    await user.click(screen.getByRole("button", { name: "Next image" }));
    expect(screen.getByText("Zoom level 1 of 3")).toBeInTheDocument();
  });
});
