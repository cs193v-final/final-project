// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runGameCall, type GameResult } from "@/game/game-result";
import { pointsIfCorrect } from "@/game/scoring";
import { SCORING_CONFIG } from "@/game/scoring-config";
import { act, getGame, MemoryGameStore, puzzleSourceFrom, startGame, type GameOwner } from "@/game/server-game";
import type { GameAction, Pack, Puzzle, ScoringConfig } from "@/game/types";
import { PracticeGame } from "./PracticeGame";

function puzzle(id: string, answer: string, acceptedAnswers: string[] = []): Puzzle {
  return {
    id,
    imageUrl: "",
    answer,
    acceptedAnswers,
    reveal: { focus: { x: 0.5, y: 0.5 }, zoomLevels: [4, 2, 1] },
    credit: { source: "test", license: "CC0" },
    aiSolvedLevel: null,
  };
}
const PUZZLES = [puzzle("p1", "Golden Gate Bridge", ["Golden Gate"]), puzzle("p2", "Big Ben")];
const PACK: Pack = { id: "pk", kind: "practice", title: "Practice", theme: "Mixed", puzzleIds: ["p1", "p2"] };
const OWNER: GameOwner = { anonId: "test-owner" };

/**
 * Stand-ins for the Server Actions: the real game service (src/game/server-game.ts)
 * on an in-memory store, so these tests play the same rules as the server.
 * Every result the component receives is recorded.
 */
function backend(scoring: ScoringConfig = SCORING_CONFIG) {
  const deps = { games: new MemoryGameStore(), puzzles: puzzleSourceFrom(PUZZLES) };
  const received: GameResult[] = [];
  const record = async (result: Promise<GameResult>) => {
    const r = await result;
    received.push(r);
    return r;
  };
  return {
    received,
    start: vi.fn(() => record(runGameCall(() => startGame(deps, PACK, OWNER, scoring)))),
    // Passes the client's revision through, so a client sending a stale one would get `conflict` (#107).
    act: vi.fn((gameId: string, action: GameAction, revision: number) =>
      record(runGameCall(() => act(deps, gameId, OWNER, action, revision))),
    ),
    get: vi.fn((gameId: string) => record(runGameCall(() => getGame(deps, gameId, OWNER)))),
  };
}

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

async function setup() {
  const user = userEvent.setup();
  const server = backend();
  render(<PracticeGame initial={null} start={server.start} act={server.act} get={server.get} />);
  const input = () => screen.getByRole("textbox", { name: "What is it?" });
  const status = () => screen.getByRole("status");
  await screen.findByText("Image 1 of 2");
  return { user, input, status, server };
}

describe("PracticeGame start and resume (#54)", () => {
  it("starts a server game on load and puts its id in the URL", async () => {
    const { server } = await setup();
    expect(server.start).toHaveBeenCalledTimes(1);
    const view = server.received[0]!.ok ? server.received[0]!.view : null;
    expect(window.location.pathname + window.location.search).toBe(`/play?game=${view!.gameId}`);
  });

  it("starts exactly one game under React's development-mode double mount", async () => {
    const server = backend();
    render(
      <StrictMode>
        <PracticeGame initial={null} start={server.start} act={server.act} get={server.get} />
      </StrictMode>,
    );
    expect(await screen.findByText("Image 1 of 2")).toBeInTheDocument();
    expect(server.start).toHaveBeenCalledTimes(1);
  });

  it("ignores a start that finishes after the player left /play, so the URL isn't rewritten", async () => {
    const server = backend();
    const realStart = server.start.getMockImplementation()!;
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => (finish = resolve));
    server.start.mockImplementationOnce(async () => {
      await gate;
      return realStart();
    });
    window.history.replaceState(null, "", "/play");
    const { unmount } = render(<PracticeGame initial={null} start={server.start} act={server.act} get={server.get} />);
    expect(screen.getByText("Starting a new game…")).toBeInTheDocument();

    // "← Home": Next unmounts /play and shows "/".
    unmount();
    window.history.replaceState(null, "", "/");
    finish();
    await waitFor(() => expect(server.received).toHaveLength(1));
    await Promise.resolve();
    expect(window.location.pathname + window.location.search).toBe("/");
  });

  it("resumes a game loaded on the server, with its zoom level, wrong guesses and score", async () => {
    const server = backend();
    const started = await server.start();
    if (!started.ok) throw new Error("start failed");
    const { gameId } = started.view;
    const revealed = await server.act(gameId, { type: "reveal" }, started.view.revision);
    if (!revealed.ok) throw new Error("reveal failed");
    const initial = await server.act(gameId, { type: "guess", guess: "bay bridge" }, revealed.view.revision);

    render(<PracticeGame initial={initial} start={server.start} act={server.act} get={server.get} />);
    expect(screen.getByText("Image 1 of 2")).toBeInTheDocument();
    expect(screen.getByText("Zoom level 2 of 3")).toBeInTheDocument();
    expect(screen.getByText("1 wrong guess")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("“bay bridge” isn't it (1 wrong guess).");
    expect(server.start).toHaveBeenCalledTimes(1); // only ours, above
  });

  it("explains a game that isn't this player's and offers a new one", async () => {
    const user = userEvent.setup();
    const server = backend();
    render(<PracticeGame initial={{ ok: false, error: "not-found" }} start={server.start} act={server.act} get={server.get} />);
    expect(screen.getByRole("alert")).toHaveTextContent("We couldn't find that game.");
    await user.click(screen.getByRole("button", { name: "Start a new game" }));
    expect(await screen.findByText("Image 1 of 2")).toBeInTheDocument();
  });

  it("reloads the game and says so when another tab changed it", async () => {
    const { user, input, server } = await setup();
    server.act.mockResolvedValueOnce({ ok: false, error: "conflict" });
    await user.type(input(), "bay bridge{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("updated since you last saw it");
    expect(server.get).toHaveBeenCalledTimes(1);
  });

  it("doesn't apply a move from a tab that's behind: another tab's Skip + Next, then this tab's Skip (#107)", async () => {
    const { user, server } = await setup();
    const started = server.received[0]!;
    if (!started.ok) throw new Error("start failed");
    const { gameId } = started.view;
    // Another tab, on the same game, skips image 1 and moves on to image 2.
    const skipped = await server.act(gameId, { type: "skip" }, started.view.revision);
    if (!skipped.ok) throw new Error("other tab's skip failed");
    await server.act(gameId, { type: "next" }, skipped.view.revision);

    // This tab still shows image 1. Its Skip must not skip image 2.
    expect(screen.getByText("Image 1 of 2")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Skip this image" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("updated since you last saw it");
    expect(await screen.findByText("Image 2 of 2")).toBeInTheDocument();
    const now = await server.get(gameId);
    if (!now.ok) throw new Error("get failed");
    expect(now.view.results.map((r) => r.outcome)).toEqual(["skipped"]);
    expect(now.view.round).toMatchObject({ position: 2, state: "playing" });
  });

  it("never receives an answer while a round is being played", async () => {
    const { user, input, server } = await setup();
    await user.type(input(), "bay bridge{Enter}");
    await user.click(screen.getByRole("button", { name: "Zoom out" }));
    await user.type(input(), "golden gate{Enter}");
    await user.click(await screen.findByRole("button", { name: "Next image" }));
    await user.click(await screen.findByRole("button", { name: "Zoom out" }));
    await waitFor(() => expect(server.received.length).toBe(6));
    for (const result of server.received) {
      if (!result.ok || result.view.round?.state !== "playing") continue;
      const json = JSON.stringify(result).toLowerCase();
      const current = PUZZLES[result.view.round.position - 1]!;
      for (const answer of [current.answer, ...current.acceptedAnswers]) expect(json).not.toContain(answer.toLowerCase());
    }
  });
});

/** A promise the test resolves by hand, to hold a Server Action "in flight". */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("PracticeGame while a move is on its way to the server", () => {
  it("ignores a second Zoom out click until the first one's result arrives", async () => {
    const { user, server } = await setup();
    const realAct = server.act.getMockImplementation()!;
    const gate = deferred<void>();
    server.act.mockImplementationOnce(async (gameId, action, revision) => {
      await gate.promise;
      return realAct(gameId, action, revision);
    });

    const zoom = screen.getByRole("button", { name: "Zoom out" });
    await user.click(zoom);
    expect(zoom).toHaveAttribute("aria-disabled", "true");
    await user.click(zoom);
    expect(server.act).toHaveBeenCalledTimes(1);

    gate.resolve();
    expect(await screen.findByText("Zoom level 2 of 3")).toBeInTheDocument();
    expect(zoom).toHaveAttribute("aria-disabled", "false");
    expect(server.act).toHaveBeenCalledTimes(1);
  });

  it("ignores a second guess, Skip and Next while a guess is pending, and keeps the typed text", async () => {
    const { user, input, server } = await setup();
    const realAct = server.act.getMockImplementation()!;
    const gate = deferred<void>();
    server.act.mockImplementationOnce(async (gameId, action, revision) => {
      await gate.promise;
      return realAct(gameId, action, revision);
    });

    await user.type(input(), "bay bridge{Enter}");
    expect(screen.getByRole("button", { name: "Guess" })).toHaveAttribute("aria-disabled", "true");
    await user.type(input(), "big ben{Enter}");
    await user.click(screen.getByRole("button", { name: "Skip this image" }));
    expect(server.act).toHaveBeenCalledTimes(1);
    expect(input()).toHaveValue("big ben"); // not sent, not lost

    gate.resolve();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("(1 wrong guess)"));
    expect(screen.getByRole("button", { name: "Guess" })).toHaveAttribute("aria-disabled", "false");
  });

  it("starts only one new game when Play again is clicked twice", async () => {
    const { user, server } = await setup();
    for (let i = 0; i < PUZZLES.length; i++) {
      await user.click(await screen.findByRole("button", { name: "Skip this image" }));
      await user.click(await screen.findByRole("button", { name: /Next image|See results/ }));
    }
    const again = await screen.findByRole("button", { name: "Play again" });
    await user.dblClick(again);
    expect(await screen.findByText("Image 1 of 2")).toBeInTheDocument();
    expect(server.start).toHaveBeenCalledTimes(2); // the first game, and one more
  });
});

describe("PracticeGame when a Server Action fails outright (offline, or a redeploy)", () => {
  it("shows the problem instead of hanging on the first load, and Try again starts the game", async () => {
    const user = userEvent.setup();
    const server = backend();
    const realStart = server.start.getMockImplementation()!;
    server.start.mockRejectedValueOnce(new Error("Failed to find Server Action"));
    render(<PracticeGame initial={null} start={server.start} act={server.act} get={server.get} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't reach the server.");
    expect(screen.queryByText("Starting a new game…")).not.toBeInTheDocument();
    server.start.mockImplementation(realStart);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Image 1 of 2")).toBeInTheDocument();
  });

  it("keeps the game on screen, offers a reload, and lets the player try the move again", async () => {
    const { user, server } = await setup();
    server.act.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const zoom = screen.getByRole("button", { name: "Zoom out" });
    await user.click(zoom);

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't reach the server.");
    // Underlined all the time, not just on hover, so it reads as pressable on a touch screen.
    expect(screen.getByRole("button", { name: "Reload the page" })).toHaveClass("underline");
    expect(screen.getByText("Image 1 of 2")).toBeInTheDocument();
    expect(zoom).toHaveAttribute("aria-disabled", "false");

    await user.click(zoom);
    expect(await screen.findByText("Zoom level 2 of 3")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("PracticeGame when a limit is hit (#85)", () => {
  const LIMITED: GameResult = { ok: false, error: "rate-limited" };

  it("says to wait and try again when starting is rate-limited, and Try again starts the game", async () => {
    const user = userEvent.setup();
    const server = backend();
    const realStart = server.start.getMockImplementation()!;
    server.start.mockResolvedValueOnce(LIMITED);
    render(<PracticeGame initial={null} start={server.start} act={server.act} get={server.get} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/wait a while \(up to an hour\), then try again/);
    expect(window.location.search).toBe("");
    server.start.mockImplementation(realStart);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Image 1 of 2")).toBeInTheDocument();
  });

  it("keeps the game on screen when a move is rate-limited, and the move works once allowed again", async () => {
    const { user, server } = await setup();
    server.act.mockResolvedValueOnce(LIMITED);
    const zoom = screen.getByRole("button", { name: "Zoom out" });
    await user.click(zoom);

    expect(await screen.findByRole("alert")).toHaveTextContent(/wait a while \(up to an hour\), then try again/);
    expect(screen.getByText("Image 1 of 2")).toBeInTheDocument();
    expect(screen.getByText("Zoom level 1 of 3")).toBeInTheDocument();

    await user.click(zoom);
    expect(await screen.findByText("Zoom level 2 of 3")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("PracticeGame guessing", () => {
  it("submits with Enter, shows a wrong guess, counts it and clears the input", async () => {
    const { user, input, status } = await setup();
    expect(input()).toHaveFocus();
    await user.type(input(), "  Bay  Bridge {Enter}");
    expect(input()).toHaveValue("");
    await waitFor(() => expect(status()).toHaveTextContent("“bay bridge” isn't it (1 wrong guess)."));
    expect(screen.getByText("1 wrong guess")).toBeInTheDocument();
  });

  it("changes the announced text when the same wrong guess is repeated", async () => {
    const { user, input, status } = await setup();
    await user.type(input(), "bay bridge{Enter}");
    await waitFor(() => expect(status()).toHaveTextContent("(1 wrong guess)"));
    const first = status().textContent;
    await user.type(input(), "bay bridge{Enter}");
    await waitFor(() => expect(status()).toHaveTextContent("(2 wrong guesses)"));
    expect(status().textContent).not.toBe(first);
  });

  it("asks for a guess on blank input without counting it or asking the server", async () => {
    const { user, input, status, server } = await setup();
    await user.type(input(), "   ");
    await user.click(screen.getByRole("button", { name: "Guess" }));
    expect(status()).toHaveTextContent("Type a guess first.");
    expect(screen.queryByText(/wrong guess/)).not.toBeInTheDocument();
    expect(input()).toHaveValue("   ");
    expect(server.act).not.toHaveBeenCalled();
  });

  it("accepts an alternate answer, shows the real answer, then focuses Next image", async () => {
    const { user, input, status } = await setup();
    await user.type(input(), "golden gate{Enter}");
    // The server sends the canonical answer only, never the alternate that matched (#54).
    await waitFor(() => expect(status()).toHaveTextContent("Correct! It's Golden Gate Bridge."));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next image" })).toHaveFocus();
  });

  it("skip reveals the answer", async () => {
    const { user, status } = await setup();
    await user.click(screen.getByRole("button", { name: "Skip this image" }));
    await waitFor(() => expect(status()).toHaveTextContent("Skipped. It was Golden Gate Bridge."));
  });

  it("plays through every image to the end and can restart", async () => {
    const { user, input, status, server } = await setup();

    await user.type(input(), "golden gate bridge{Enter}");
    await user.click(await screen.findByRole("button", { name: "Next image" }));

    expect(await screen.findByText("Image 2 of 2")).toBeInTheDocument();
    expect(status()).toHaveTextContent(""); // feedback reset for the new image
    expect(screen.queryByText(/wrong guess/)).not.toBeInTheDocument();
    expect(input()).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Skip this image" }));
    await user.click(await screen.findByRole("button", { name: "See results" }));
    expect(await screen.findByRole("heading", { name: "Practice complete" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Play again" }));
    expect(await screen.findByText("Image 1 of 2")).toBeInTheDocument();
    expect(server.start).toHaveBeenCalledTimes(2); // a new server game
  });

  it("zoom out steps the viewer to the full image, then stays focused but does nothing", async () => {
    const { user, server } = await setup();
    const zoom = screen.getByRole("button", { name: "Zoom out" });
    expect(screen.getByText("Zoom level 1 of 3")).toBeInTheDocument();
    await user.click(zoom);
    expect(await screen.findByText("Zoom level 2 of 3")).toBeInTheDocument();
    await user.click(zoom);
    expect(await screen.findByText("Zoom level 3 of 3")).toBeInTheDocument();
    expect(screen.getByText("Showing the full image")).toBeInTheDocument();
    expect(zoom).toHaveAttribute("aria-disabled", "true");
    await user.click(zoom);
    expect(screen.getByText("Zoom level 3 of 3")).toBeInTheDocument();
    expect(zoom).toHaveFocus();
    expect(server.act).toHaveBeenCalledTimes(2);
  });

  it("shows the full image and the photo credit once the round is over", async () => {
    const { user, input } = await setup();
    expect(screen.queryByText(/Photo:/)).not.toBeInTheDocument();
    await user.type(input(), "golden gate{Enter}");
    expect(await screen.findByText("Full image")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Zoom out" })).not.toBeInTheDocument();
    expect(screen.getByText(/Photo: test \(CC0\)/)).toBeInTheDocument();
  });

  it("starts the next image at its tightest crop", async () => {
    const { user } = await setup();
    await user.click(screen.getByRole("button", { name: "Zoom out" }));
    await screen.findByText("Zoom level 2 of 3");
    await user.click(screen.getByRole("button", { name: "Skip this image" }));
    await user.click(await screen.findByRole("button", { name: "Next image" }));
    expect(await screen.findByText("Image 2 of 2")).toBeInTheDocument();
    expect(screen.getByText("Zoom level 1 of 3")).toBeInTheDocument();
  });
});

describe("PracticeGame score (#16), worked out on the server", () => {
  // Expected numbers come from the live config, so tuning it doesn't break this test.
  const worth = (revealLevel: number, wrongGuesses: number) => pointsIfCorrect(revealLevel, wrongGuesses);
  const score = () => screen.getByText(/^Score/);
  const value = () => screen.getByText(/now|for this image/);

  it("updates the live score as you play and ends on the final score screen", async () => {
    const { user, input } = await setup();
    expect(score()).toHaveTextContent("Score 0");
    expect(value()).toHaveTextContent(`Worth ${worth(0, 0)} points now`);

    await user.click(screen.getByRole("button", { name: "Zoom out" }));
    await waitFor(() => expect(value()).toHaveTextContent(`Worth ${worth(1, 0)} points now`));

    await user.type(input(), "bay bridge{Enter}");
    await waitFor(() => expect(value()).toHaveTextContent(`Worth ${worth(1, 1)} points now`));

    await user.type(input(), "golden gate{Enter}");
    const first = worth(1, 1);
    await waitFor(() => expect(value()).toHaveTextContent(`+${first} points for this image`));
    expect(score()).toHaveTextContent(`Score ${first}`);

    await user.click(screen.getByRole("button", { name: "Next image" }));
    await user.click(await screen.findByRole("button", { name: "Skip this image" }));
    await waitFor(() => expect(value()).toHaveTextContent(`+${SCORING_CONFIG.skipPoints} points`));

    await user.click(screen.getByRole("button", { name: "See results" }));
    expect(await screen.findByRole("heading", { name: "Practice complete" })).toHaveFocus();
    const total = first + SCORING_CONFIG.skipPoints;
    expect(screen.getByText(/You scored/)).toHaveTextContent(
      `You scored ${total} out of ${SCORING_CONFIG.basePoints * PUZZLES.length}`,
    );
    const [one, two] = screen.getAllByRole("listitem");
    expect(one).toHaveTextContent("Golden Gate Bridge ✓ correct");
    expect(one).toHaveTextContent("1 zoom-out, 1 wrong guess");
    expect(two).toHaveTextContent("Big Ben skipped");

    await user.click(screen.getByRole("button", { name: "Play again" }));
    await waitFor(() => expect(score()).toHaveTextContent("Score 0"));
  });

  it("scores the final maximum with the game's own config, not the default (#174)", async () => {
    const own: ScoringConfig = { ...SCORING_CONFIG, basePoints: SCORING_CONFIG.basePoints * 3 };
    const server = backend(own);
    const user = userEvent.setup();
    render(<PracticeGame initial={null} start={server.start} act={server.act} get={server.get} />);
    await screen.findByText("Image 1 of 2");
    expect(value()).toHaveTextContent(`Worth ${own.basePoints} points now`);

    await user.click(screen.getByRole("button", { name: "Skip this image" }));
    await user.click(await screen.findByRole("button", { name: "Next image" }));
    await user.click(await screen.findByRole("button", { name: "Skip this image" }));
    await user.click(await screen.findByRole("button", { name: "See results" }));
    expect(await screen.findByText(/You scored/)).toHaveTextContent(
      `You scored ${own.skipPoints * 2} out of ${own.basePoints * PUZZLES.length}`,
    );
  });
});
