// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { runGameCall } from "@/game/game-result";
import { TIMED_SCORING_CONFIG } from "@/game/scoring-config";
import { act, getGame, MemoryGameStore, puzzleSourceFrom, startGame, type GameOwner } from "@/game/server-game";
import type { GameAction, Pack, Puzzle } from "@/game/types";

import { StanfordGame } from "./StanfordGame";

// Spec for Stanford mode's game screen (#65): the practice game, at its own
// URL, with its own final heading and each image's credit after its round.
// Obviously fake content: the real Stanford pack is never in the repo.

const puzzle = (id: string, answer: string): Puzzle => ({
  id,
  imageUrl: "",
  answer,
  acceptedAnswers: [],
  reveal: { focus: { x: 0.5, y: 0.5 }, zoomLevels: [4, 2, 1] },
  credit: { source: "Test Photographer", license: "CC BY 4.0" },
  aiSolvedLevel: null,
});
const PUZZLES = [puzzle("s1", "Fake Spot One"), puzzle("s2", "Fake Spot Two")];
const PACK: Pack = { id: "pk-s", kind: "stanford", title: "Stanford", theme: "Fake campus spots", puzzleIds: ["s1", "s2"] };
const OWNER: GameOwner = { anonId: "test-owner" };

function backend() {
  const deps = { games: new MemoryGameStore(), puzzles: puzzleSourceFrom(PUZZLES) };
  return {
    start: () => runGameCall(() => startGame(deps, PACK, OWNER, TIMED_SCORING_CONFIG)),
    act: (gameId: string, action: GameAction, revision: number) => runGameCall(() => act(deps, gameId, OWNER, action, revision)),
    get: (gameId: string) => runGameCall(() => getGame(deps, gameId, OWNER)),
  };
}

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("StanfordGame", () => {
  it("starts at /stanford?game=<id>, credits each image after its round, and ends with Stanford complete", async () => {
    const user = userEvent.setup();
    render(<StanfordGame initial={null} {...backend()} />);
    await screen.findByText("Image 1 of 2");
    expect(window.location.pathname).toBe("/stanford");
    expect(new URLSearchParams(window.location.search).get("game")).toMatch(/.+/u);

    for (const [i, next] of ["Next image", "See results"].entries()) {
      expect(screen.queryByText(/^Photo:/u)).not.toBeInTheDocument();
      await user.click(await screen.findByRole("button", { name: "Start round" }));
      await user.type(await screen.findByRole("textbox", { name: "What is it?" }), `${PUZZLES[i]!.answer}{Enter}`);
      expect(await screen.findByText(/^Photo:/u)).toHaveTextContent("Photo: Test Photographer (CC BY 4.0)");
      await user.click(screen.getByRole("button", { name: next }));
    }
    expect(await screen.findByRole("heading", { name: "Stanford complete" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Play again" })).toBeInTheDocument();
  });
});
