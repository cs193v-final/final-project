// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { pointsIfCorrect } from "@/game/scoring";
import { SCORING_CONFIG } from "@/game/scoring-config";
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

describe("PracticeGame score (#16)", () => {
  // Expected numbers come from the live config, so tuning it doesn't break this test.
  const worth = (revealLevel: number, wrongGuesses: number) => pointsIfCorrect(revealLevel, wrongGuesses);

  it("updates the live score as you play and ends on the final score screen", async () => {
    const { user, input } = setup();
    expect(screen.getByText(/^Score/)).toHaveTextContent("Score 0");
    expect(screen.getByText(/now/)).toHaveTextContent(`Worth ${worth(0, 0)} points now`);

    await user.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(screen.getByText(/now/)).toHaveTextContent(`Worth ${worth(1, 0)} points now`);

    await user.type(input(), "bay bridge{Enter}");
    expect(screen.getByText(/now/)).toHaveTextContent(`Worth ${worth(1, 1)} points now`);

    await user.type(input(), "golden gate{Enter}");
    const first = worth(1, 1);
    expect(screen.getByText(/for this image/)).toHaveTextContent(`+${first} points for this image`);
    expect(screen.getByText(/^Score/)).toHaveTextContent(`Score ${first}`);

    await user.click(screen.getByRole("button", { name: "Next image" }));
    await user.click(screen.getByRole("button", { name: "Skip this image" }));
    expect(screen.getByText(/for this image/)).toHaveTextContent(`+${SCORING_CONFIG.skipPoints} points`);

    await user.click(screen.getByRole("button", { name: "See results" }));
    expect(screen.getByRole("heading", { name: "Practice complete" })).toHaveFocus();
    const total = first + SCORING_CONFIG.skipPoints;
    expect(screen.getByText(/You scored/)).toHaveTextContent(
      `You scored ${total} out of ${SCORING_CONFIG.basePoints * PUZZLES.length}`,
    );
    const [one, two] = screen.getAllByRole("listitem");
    expect(one).toHaveTextContent("Golden Gate Bridge ✓ correct");
    expect(one).toHaveTextContent("1 zoom-out, 1 wrong guess");
    expect(two).toHaveTextContent("Big Ben skipped");

    await user.click(screen.getByRole("button", { name: "Play again" }));
    expect(screen.getByText(/^Score/)).toHaveTextContent("Score 0");
  });
});
