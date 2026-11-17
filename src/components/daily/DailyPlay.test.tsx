// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DailyIntro } from "@/game/daily";
import { runGameCall, type GameResult } from "@/game/game-result";
import { SCORING_CONFIG } from "@/game/scoring-config";
import { act, getGame, MemoryGameStore, puzzleSourceFrom, startOrResumeDaily, type GameOwner } from "@/game/server-game";
import type { GameAction, Pack, Puzzle } from "@/game/types";
import { DailyPlay, type DailyStart } from "./DailyPlay";

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
const INTRO: DailyIntro = { date: "2026-11-17", pack: { theme: "Fruit", puzzleCount: 2 } };

function backend() {
  const deps = { games: new MemoryGameStore(), puzzles: puzzleSourceFrom(PUZZLES) };
  return {
    deps,
    // Like startTodaysDaily: only the day the intro showed may be started.
    start: vi.fn(async (date: string): Promise<DailyStart> =>
      date === INTRO.date
        ? runGameCall(() => startOrResumeDaily(deps, PACK, INTRO.date, OWNER, SCORING_CONFIG))
        : { ok: false, error: "day-over" },
    ),
    act: vi.fn((gameId: string, action: GameAction, revision: number) =>
      runGameCall(() => act(deps, gameId, OWNER, action, revision)),
    ),
    get: vi.fn((gameId: string) => runGameCall(() => getGame(deps, gameId, OWNER))),
  };
}

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("DailyPlay", () => {
  it("shows the intro first and starts nothing until the player presses Start", async () => {
    const server = backend();
    render(<DailyPlay intro={INTRO} initial={null} start={server.start} act={server.act} get={server.get} />);
    expect(screen.getByRole("heading", { name: "Today: Fruit" })).toBeInTheDocument();
    expect(server.start).not.toHaveBeenCalled();
    expect(screen.queryByText(/Playing the daily arrives/u)).not.toBeInTheDocument();
  });

  it("starts today's game from the intro, and keeps the address at /daily", async () => {
    const user = userEvent.setup();
    const server = backend();
    window.history.replaceState(null, "", "/daily");
    render(<DailyPlay intro={INTRO} initial={null} start={server.start} act={server.act} get={server.get} />);
    await user.click(screen.getByRole("button", { name: "Start today's challenge" }));
    expect(await screen.findByText("Image 1 of 2")).toBeInTheDocument();
    expect(server.start).toHaveBeenCalledTimes(1);
    // The daily is found by player and day, so no game id goes in the address.
    expect(window.location.pathname).toBe("/daily");
    expect(window.location.search).toBe("");
  });

  it("takes a returning player straight back into their game, where they left it", async () => {
    const server = backend();
    const started = await server.start(INTRO.date);
    if (!started.ok) throw new Error("start failed");
    const moved = await server.act(started.view.gameId, { type: "skip" }, started.view.revision);
    render(<DailyPlay intro={INTRO} initial={moved} start={server.start} act={server.act} get={server.get} />);
    expect(screen.queryByRole("heading", { name: "Today: Fruit" })).not.toBeInTheDocument();
    expect(await screen.findByText("Image 1 of 2")).toBeInTheDocument();
    expect(screen.getByText(/Skipped/u)).toBeInTheDocument();
  });

  it("after the last image shows the result with no Play again, and says when the next one starts", async () => {
    const user = userEvent.setup();
    const server = backend();
    render(<DailyPlay intro={INTRO} initial={null} start={server.start} act={server.act} get={server.get} />);
    await user.click(screen.getByRole("button", { name: "Start today's challenge" }));
    await screen.findByText("Image 1 of 2");
    await user.click(screen.getByRole("button", { name: "Skip this image" }));
    await user.click(await screen.findByRole("button", { name: "Next image" }));
    await user.click(await screen.findByRole("button", { name: "Skip this image" }));
    await user.click(await screen.findByRole("button", { name: "See results" }));

    expect(await screen.findByText(/That's today's challenge\. A new one starts at midnight Pacific Time\./u)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Play again" })).not.toBeInTheDocument();
  });

  it("a finished player who comes back sees their result, not a new game", async () => {
    const server = backend();
    let result = (await server.start(INTRO.date)) as GameResult;
    for (const action of [{ type: "skip" }, { type: "next" }, { type: "skip" }, { type: "next" }] as GameAction[]) {
      if (!result.ok) throw new Error("move failed");
      result = await server.act(result.view.gameId, action, result.view.revision);
    }
    expect(result.ok && result.view.finished).toBe(true);
    render(<DailyPlay intro={INTRO} initial={result} start={server.start} act={server.act} get={server.get} />);
    expect(await screen.findByText(/That's today's challenge/u)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Play again" })).not.toBeInTheDocument();
    expect(server.start).toHaveBeenCalledTimes(1); // only the setup's start
    // The result names the images, though this tab never saw them (review of #119).
    expect(screen.getByText(/Kiwi/u)).toBeInTheDocument();
    expect(screen.getByText(/Lychee/u)).toBeInTheDocument();
    expect(screen.queryByText(/^Image 1$/u)).not.toBeInTheDocument();
  });

  it("starts the day the intro showed, once, even on a double click", async () => {
    const user = userEvent.setup();
    const server = backend();
    render(<DailyPlay intro={INTRO} initial={null} start={server.start} act={server.act} get={server.get} />);
    const button = screen.getByRole("button", { name: "Start today's challenge" });
    await user.dblClick(button);
    await screen.findByText("Image 1 of 2");
    expect(server.start).toHaveBeenCalledTimes(1);
    expect(server.start).toHaveBeenCalledWith("2026-11-17");
  });

  it("says a new daily has started when the day the intro showed is over (opened before midnight)", async () => {
    const user = userEvent.setup();
    const server = backend();
    // The page was loaded on Nov 16; the server now says it's Nov 17.
    render(<DailyPlay intro={{ ...INTRO, date: "2026-11-16" }} initial={null} start={server.start} act={server.act} get={server.get} />);
    await user.click(screen.getByRole("button", { name: "Start today's challenge" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A new daily challenge has started since you opened this page.");
    expect(screen.getByRole("button", { name: "See today's challenge" })).toBeInTheDocument();
    expect(screen.queryByText(/Image 1 of/u)).not.toBeInTheDocument();
  });

  it("says nothing is scheduled, not practice's \"another browser\" message, when there's no daily", async () => {
    const user = userEvent.setup();
    const server = backend();
    server.start.mockResolvedValueOnce({ ok: false, error: "no-daily" });
    render(<DailyPlay intro={INTRO} initial={null} start={server.start} act={server.act} get={server.get} />);
    await user.click(screen.getByRole("button", { name: "Start today's challenge" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("There's no daily challenge scheduled right now.");
    expect(screen.queryByText(/another browser/u)).not.toBeInTheDocument();
  });
});
