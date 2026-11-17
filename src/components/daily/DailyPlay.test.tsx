// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DailyIntro } from "@/game/daily";
import { DEFAULT_DAILY_RESET } from "@/game/daily-date";
import { runGameCall, type GameResult } from "@/game/game-result";
import { SCORING_CONFIG } from "@/game/scoring-config";
import { act, getGame, MemoryGameStore, puzzleSourceFrom, startOrResumeDaily, type GameOwner } from "@/game/server-game";
import type { GameAction, Pack, Puzzle } from "@/game/types";
import { DailyPlay } from "./DailyPlay";

// Spec for #58's play flow: intro → Start → the game; one game per day, so a
// returning player resumes, a finished player sees their result, and there's
// no Play again. Runs the real game service on an in-memory store.

function puzzle(id: string, answer: string): Puzzle {
  return {
    id,
    imageUrl: "",
    answer,
    acceptedAnswers: [],
    reveal: { focus: { x: 0.5, y: 0.5 }, zoomLevels: [4, 2, 1] },
    credit: { source: "test", license: "CC0" },
    aiSolvedLevel: null,
  };
}
const PUZZLES = [puzzle("p1", "Kiwi"), puzzle("p2", "Lychee")];
const PACK: Pack = { id: "pk", kind: "daily", title: "Fruit", theme: "Fruit", puzzleIds: ["p1", "p2"] };
const OWNER: GameOwner = { anonId: "test-owner" };
const INTRO: DailyIntro = { date: "2026-11-17", reset: DEFAULT_DAILY_RESET, pack: { theme: "Fruit", puzzleCount: 2 } };

function backend() {
  const deps = { games: new MemoryGameStore(), puzzles: puzzleSourceFrom(PUZZLES) };
  return {
    deps,
    start: vi.fn(() => runGameCall(() => startOrResumeDaily(deps, PACK, INTRO.date, OWNER, SCORING_CONFIG))),
    act: vi.fn((gameId: string, action: GameAction) => runGameCall(() => act(deps, gameId, OWNER, action))),
    get: vi.fn((gameId: string) => runGameCall(() => getGame(deps, gameId, OWNER))),
    stats: vi.fn(async () => ({ rounds: [], others: 0, beatenTotal: 0 })),
  };
}

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("DailyPlay", () => {
  it("shows the intro first and starts nothing until the player presses Start", async () => {
    const server = backend();
    render(<DailyPlay intro={INTRO} initial={null} start={server.start} act={server.act} get={server.get} loadStats={server.stats} />);
    expect(screen.getByRole("heading", { name: "Today: Fruit" })).toBeInTheDocument();
    expect(server.start).not.toHaveBeenCalled();
    expect(screen.queryByText(/Playing the daily arrives/u)).not.toBeInTheDocument();
  });

  it("starts today's game from the intro, and keeps the address at /daily", async () => {
    const user = userEvent.setup();
    const server = backend();
    render(<DailyPlay intro={INTRO} initial={null} start={server.start} act={server.act} get={server.get} loadStats={server.stats} />);
    await user.click(screen.getByRole("button", { name: "Start today's challenge" }));
    expect(await screen.findByText("Image 1 of 2")).toBeInTheDocument();
    expect(server.start).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe("/daily");
    expect(window.location.search).toBe("");
  });

  it("takes a returning player straight back into their game, where they left it", async () => {
    const server = backend();
    const started = await server.start();
    if (!started.ok) throw new Error("start failed");
    const moved = await server.act(started.view.gameId, { type: "skip" });
    render(<DailyPlay intro={INTRO} initial={moved} start={server.start} act={server.act} get={server.get} loadStats={server.stats} />);
    expect(screen.queryByRole("heading", { name: "Today: Fruit" })).not.toBeInTheDocument();
    expect(await screen.findByText("Image 1 of 2")).toBeInTheDocument();
    expect(screen.getByText(/Skipped/u)).toBeInTheDocument();
  });

  it("after the last image shows the result with no Play again, a countdown, Share and Home", async () => {
    const user = userEvent.setup();
    const server = backend();
    render(<DailyPlay intro={INTRO} initial={null} start={server.start} act={server.act} get={server.get} loadStats={server.stats} />);
    await user.click(screen.getByRole("button", { name: "Start today's challenge" }));
    await screen.findByText("Image 1 of 2");
    await user.click(screen.getByRole("button", { name: "Skip this image" }));
    await user.click(await screen.findByRole("button", { name: "Next image" }));
    await user.click(await screen.findByRole("button", { name: "Skip this image" }));
    await user.click(await screen.findByRole("button", { name: "See results" }));

    expect(await screen.findByText(/That's today's challenge\. The next one starts in/u)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Play again" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share result" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    expect(server.stats).toHaveBeenCalled();
  });

  it("a finished player who comes back sees their result, not a new game", async () => {
    const server = backend();
    let result: GameResult = await server.start();
    for (const action of [{ type: "skip" }, { type: "next" }, { type: "skip" }, { type: "next" }] as GameAction[]) {
      if (!result.ok) throw new Error("move failed");
      result = await server.act(result.view.gameId, action);
    }
    expect(result.ok && result.view.finished).toBe(true);
    render(<DailyPlay intro={INTRO} initial={result} start={server.start} act={server.act} get={server.get} loadStats={server.stats} />);
    expect(await screen.findByText(/That's today's challenge/u)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Play again" })).not.toBeInTheDocument();
    expect(server.start).toHaveBeenCalledTimes(1); // only the setup's start
  });
});
