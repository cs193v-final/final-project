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
    expect(status()).toHaveTextContent("“bay bridge” isn't it.");
    expect(screen.getByText("1 wrong guess")).toBeInTheDocument();
    expect(input()).toHaveValue("");
  });

  it("asks for a guess on blank input without counting it", async () => {
    const { user, input, status } = setup();
    await user.type(input(), "   ");
    await user.click(screen.getByRole("button", { name: "Guess" }));
    expect(status()).toHaveTextContent("Type a guess first.");
    expect(screen.queryByText(/wrong guess/)).not.toBeInTheDocument();
    expect(input()).toHaveValue("   ");
  });

  it("accepts an alternate answer, then focuses Next image", async () => {
    const { user, input, status } = setup();
    await user.type(input(), "golden gate{Enter}");
    expect(status()).toHaveTextContent("Correct! It's Golden Gate.");
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

  it("the placeholder zoom out is disabled at the full image", async () => {
    const { user } = setup();
    const zoom = screen.getByRole("button", { name: "Zoom out (placeholder)" });
    expect(screen.getByText("Reveal level 1 of 3")).toBeInTheDocument();
    await user.click(zoom);
    await user.click(zoom);
    expect(screen.getByText("Reveal level 3 of 3")).toBeInTheDocument();
    expect(zoom).toBeDisabled();
  });
});
