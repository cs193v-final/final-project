// @vitest-environment jsdom
import { act as reactAct, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runGameCall, type GameResult } from "@/game/game-result";
import { START_GRACE_SECONDS } from "@/game/round";
import { scoreAt } from "@/game/scoring";
import { act, getGame, MemoryGameStore, puzzleSourceFrom, startGame, type GameOwner } from "@/game/server-game";
import type { GameAction, Pack, Puzzle, TimedScoringConfig } from "@/game/types";
import { PracticeGame } from "./PracticeGame";

function puzzle(id: string, answer: string, acceptedAnswers: string[] = []): Puzzle {
  return {
    id,
    imageUrl: `/puzzles/${id}.jpg`,
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
// Fixed numbers so these tests don't change when playtesting tweaks TIMED_SCORING_CONFIG.
const CONFIG: TimedScoringConfig = { maxPoints: 10_000, minPoints: 100, revealSeconds: 25, limitSeconds: 30, curve: 2 };

/**
 * Stand-ins for the Server Actions: the real game service (src/game/server-game.ts)
 * on an in-memory store, so these tests play the same rules as the server.
 * The server's clock is `serverNow` (ms), moved by hand with `clock.advance`,
 * or `Date.now` (faked by a test's fake timers) when `realClock` is set.
 * Every result the component receives is recorded.
 */
function backend(puzzles: readonly Puzzle[] = PUZZLES, { realClock = false } = {}) {
  let serverNow = Date.UTC(2030, 0, 1, 12);
  const clock = { advance: (seconds: number) => (serverNow += seconds * 1000) };
  const deps = { games: new MemoryGameStore(), puzzles: puzzleSourceFrom(puzzles), now: () => (realClock ? Date.now() : serverNow) };
  const received: GameResult[] = [];
  const record = async (result: Promise<GameResult>) => {
    const r = await result;
    received.push(r);
    return r;
  };
  return {
    clock,
    received,
    start: vi.fn(() => record(runGameCall(() => startGame(deps, PACK, OWNER, CONFIG)))),
    // Passes the client's revision through, so a client sending a stale one would get `conflict` (#107).
    act: vi.fn((gameId: string, action: GameAction, revision: number) =>
      record(runGameCall(() => act(deps, gameId, OWNER, action, revision))),
    ),
    get: vi.fn((gameId: string) => record(runGameCall(() => getGame(deps, gameId, OWNER)))),
  };
}

afterEach(() => {
  vi.useRealTimers();
  window.history.replaceState(null, "", "/");
});

/** A game on screen, at image 1, ready (no clock running). */
async function setup(puzzles: readonly Puzzle[] = PUZZLES) {
  const user = userEvent.setup();
  const server = backend(puzzles);
  render(<PracticeGame initial={null} start={server.start} act={server.act} get={server.get} />);
  const input = () => screen.getByRole("textbox", { name: "What is it?" });
  const status = () => screen.getByRole("status");
  await screen.findByText("Image 1 of 2");
  const startRound = async () => {
    await user.click(await screen.findByRole("button", { name: "Start round" }));
    await screen.findByRole("textbox", { name: "What is it?" });
  };
  return { user, input, status, server, startRound };
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

    unmount();
    window.history.replaceState(null, "", "/");
    finish();
    await waitFor(() => expect(server.received).toHaveLength(1));
    await Promise.resolve();
    expect(window.location.pathname + window.location.search).toBe("/");
  });

  it("resumes a game loaded on the server, with its clock, wrong guesses and score", async () => {
    const server = backend();
    const started = await server.start();
    if (!started.ok) throw new Error("start failed");
    const { gameId } = started.view;
    const running = await server.act(gameId, { type: "start" }, started.view.revision);
    if (!running.ok) throw new Error("start round failed");
    server.clock.advance(START_GRACE_SECONDS + 5);
    const initial = await server.act(gameId, { type: "guess", guess: "bay bridge" }, running.view.revision);

    render(<PracticeGame initial={initial} start={server.start} act={server.act} get={server.get} />);
    expect(screen.getByText("Image 1 of 2")).toBeInTheDocument();
    expect(screen.getByRole("img")).toBeInTheDocument();
    expect(screen.getByText("1 wrong guess")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("“bay bridge” isn't it (1 wrong guess). Keep going.");
    expect(screen.getByText(/now ·/)).toHaveTextContent(`Worth ${scoreAt(5, CONFIG).toLocaleString("en-US")} points now`);
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

  it("says a game that can't be loaded anymore is lost, instead of blaming the connection, and offers a new one (#164)", async () => {
    const user = userEvent.setup();
    const server = backend();
    render(<PracticeGame initial={{ ok: false, error: "unreadable" }} start={server.start} act={server.act} get={server.get} />);
    expect(screen.getByRole("alert")).toHaveTextContent("This game can't be loaded anymore");
    expect(screen.getByRole("alert")).not.toHaveTextContent(/connection/i);
    await user.click(screen.getByRole("button", { name: "Start a new game" }));
    expect(await screen.findByText("Image 1 of 2")).toBeInTheDocument();
  });

  it("reloads the game and says so when another tab changed it", async () => {
    const { user, input, server, startRound } = await setup();
    await startRound();
    server.act.mockResolvedValueOnce({ ok: false, error: "conflict" });
    await user.type(input(), "bay bridge{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("updated since you last saw it");
    expect(server.get).toHaveBeenCalledTimes(1);
  });

  it("doesn't apply a move from a tab that's behind: another tab starts and answers, then this tab's Start (#107)", async () => {
    const { user, server } = await setup();
    const started = server.received[0]!;
    if (!started.ok) throw new Error("start failed");
    const { gameId } = started.view;
    const running = await server.act(gameId, { type: "start" }, started.view.revision);
    if (!running.ok) throw new Error("other tab's start failed");
    await server.act(gameId, { type: "guess", guess: "golden gate" }, running.view.revision);

    // This tab still shows image 1 ready. Its Start must not restart anything.
    await user.click(screen.getByRole("button", { name: "Start round" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("updated since you last saw it");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Correct! It's Golden Gate Bridge."));
  });

  it("never receives an answer before a round is over", async () => {
    const { user, input, server, startRound } = await setup();
    await startRound();
    await user.type(input(), "bay bridge{Enter}");
    await user.type(input(), "golden gate{Enter}");
    await user.click(await screen.findByRole("button", { name: "Next image" }));
    await startRound();
    await waitFor(() => expect(server.received.length).toBe(6));
    for (const result of server.received) {
      if (!result.ok || (result.view.round?.state !== "playing" && result.view.round?.state !== "ready")) continue;
      const json = JSON.stringify(result).toLowerCase();
      const current = PUZZLES[result.view.round.position - 1]!;
      for (const answer of [current.answer, ...current.acceptedAnswers]) expect(json).not.toContain(answer.toLowerCase());
    }
  });
});

describe("PracticeGame timed rounds (#255)", () => {
  it("shows no photo and no guess box until Start round, then the photo and the guess box", async () => {
    const { user, input } = await setup();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("The photo appears when you start.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText(/Starts at/)).toHaveTextContent("Starts at 10,000 points and drops until you get it. 30 seconds per image.");

    await user.click(screen.getByRole("button", { name: "Start round" }));
    expect(await screen.findByRole("img")).toHaveAttribute("src", "/puzzles/p1.jpg");
    expect(input()).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Start round" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Zoom out|Skip/ })).not.toBeInTheDocument();
  });

  it("scores the correct guess by the server's time, and shows what it earned", async () => {
    const { user, input, server, startRound } = await setup();
    await startRound();
    server.clock.advance(START_GRACE_SECONDS + 12.5);
    await user.type(input(), "golden gate{Enter}");
    expect(await screen.findByText(/for this image/)).toHaveTextContent("+2,575 points for this image");
    expect(screen.getByText(/^Score/)).toHaveTextContent("Score 2575");
  });

  it("counts the live score down with the clock, and at the limit asks the server, which ends the round", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "Date"], shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const server = backend(PUZZLES, { realClock: true });
    render(<PracticeGame initial={null} start={server.start} act={server.act} get={server.get} />);
    await user.click(await screen.findByRole("button", { name: "Start round" }));
    await screen.findByRole("textbox", { name: "What is it?" });
    expect(screen.getByText(/now ·/)).toHaveTextContent(/^Worth (10,000|9,9\d\d) points now · 30 s left$/);

    // (The fake clock also moves with real time, so allow a few points of drift.)
    await reactAct(async () => vi.advanceTimersByTime(12_500));
    const shown = Number(/Worth ([\d,]+)/.exec(screen.getByText(/now ·/).textContent ?? "")![1]!.replace(",", ""));
    expect(shown).toBeLessThanOrEqual(scoreAt(12.5, CONFIG));
    expect(shown).toBeGreaterThan(scoreAt(12.7, CONFIG));
    expect(screen.getByText(/now ·/)).toHaveTextContent("18 s left");
    expect(server.get).not.toHaveBeenCalled();

    // Past the limit (and the server's grace): the page asks the server, which times the round out.
    await reactAct(async () => vi.advanceTimersByTime(18_500));
    await waitFor(() => expect(server.get).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Time's up. It was Golden Gate Bridge."));
    expect(screen.getByText(/for this image/)).toHaveTextContent("+0 points for this image");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next image" })).toHaveFocus();
  });

  it("shows a guess sent after the limit as timed out, not counted", async () => {
    const { user, input, server, startRound } = await setup();
    await startRound();
    server.clock.advance(40);
    await user.type(input(), "golden gate{Enter}");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Time's up. It was Golden Gate Bridge."));
    expect(screen.getByText(/^Score/)).toHaveTextContent("Score 0");
  });
});

/** A promise the test resolves by hand, to hold a Server Action "in flight". */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("PracticeGame while a move is on its way to the server", () => {
  it("ignores a second Start round click until the first one's result arrives", async () => {
    const { user, server } = await setup();
    const realAct = server.act.getMockImplementation()!;
    const gate = deferred<void>();
    server.act.mockImplementationOnce(async (gameId, action, revision) => {
      await gate.promise;
      return realAct(gameId, action, revision);
    });

    const start = screen.getByRole("button", { name: "Start round" });
    await user.click(start);
    expect(start).toHaveAttribute("aria-disabled", "true");
    await user.click(start);
    expect(server.act).toHaveBeenCalledTimes(1);

    gate.resolve();
    expect(await screen.findByRole("textbox", { name: "What is it?" })).toBeInTheDocument();
    expect(server.act).toHaveBeenCalledTimes(1);
  });

  it("ignores a second guess while a guess is pending, and keeps the typed text", async () => {
    const { user, input, server, startRound } = await setup();
    await startRound();
    const realAct = server.act.getMockImplementation()!;
    const gate = deferred<void>();
    server.act.mockImplementationOnce(async (gameId, action, revision) => {
      await gate.promise;
      return realAct(gameId, action, revision);
    });

    await user.type(input(), "bay bridge{Enter}");
    expect(screen.getByRole("button", { name: "Guess" })).toHaveAttribute("aria-disabled", "true");
    await user.type(input(), "big ben{Enter}");
    expect(server.act).toHaveBeenCalledTimes(2); // the Start round, and the first guess
    expect(input()).toHaveValue("big ben"); // not sent, not lost

    gate.resolve();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("(1 wrong guess)"));
    expect(screen.getByRole("button", { name: "Guess" })).toHaveAttribute("aria-disabled", "false");
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
    const start = screen.getByRole("button", { name: "Start round" });
    await user.click(start);

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't reach the server.");
    expect(screen.getByRole("button", { name: "Reload the page" })).toHaveClass("underline");
    expect(screen.getByText("Image 1 of 2")).toBeInTheDocument();
    expect(start).toHaveAttribute("aria-disabled", "false");

    await user.click(start);
    expect(await screen.findByRole("textbox", { name: "What is it?" })).toBeInTheDocument();
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
    await user.click(screen.getByRole("button", { name: "Start round" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/wait a while \(up to an hour\), then try again/);
    expect(screen.getByText("Image 1 of 2")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Start round" }));
    expect(await screen.findByRole("img")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("PracticeGame guessing", () => {
  it("submits with Enter, shows a wrong guess, counts it and clears the input", async () => {
    const { user, input, status, startRound } = await setup();
    await startRound();
    expect(input()).toHaveFocus();
    await user.type(input(), "  Bay  Bridge {Enter}");
    expect(input()).toHaveValue("");
    await waitFor(() => expect(status()).toHaveTextContent("“bay bridge” isn't it (1 wrong guess). Keep going."));
    expect(screen.getByText("1 wrong guess")).toBeInTheDocument();
  });

  it("changes the announced text when the same wrong guess is repeated", async () => {
    const { user, input, status, startRound } = await setup();
    await startRound();
    await user.type(input(), "bay bridge{Enter}");
    await waitFor(() => expect(status()).toHaveTextContent("(1 wrong guess)"));
    const first = status().textContent;
    await user.type(input(), "bay bridge{Enter}");
    await waitFor(() => expect(status()).toHaveTextContent("(2 wrong guesses)"));
    expect(status().textContent).not.toBe(first);
  });

  it("asks for a guess on blank input without counting it or asking the server", async () => {
    const { user, input, status, server, startRound } = await setup();
    await startRound();
    await user.type(input(), "   ");
    await user.click(screen.getByRole("button", { name: "Guess" }));
    expect(status()).toHaveTextContent("Type a guess first.");
    expect(screen.queryByText(/wrong guess/)).not.toBeInTheDocument();
    expect(input()).toHaveValue("   ");
    expect(server.act).toHaveBeenCalledTimes(1); // only the Start round
  });

  it("accepts an alternate answer, shows the real answer, the credit, then focuses Next image", async () => {
    const { user, input, status, startRound } = await setup();
    await startRound();
    expect(screen.queryByText(/Photo:/)).not.toBeInTheDocument();
    await user.type(input(), "golden gate{Enter}");
    await waitFor(() => expect(status()).toHaveTextContent("Correct! It's Golden Gate Bridge."));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText(/Photo: test \(CC0\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next image" })).toHaveFocus();
  });

  it("plays through every image to the final score, with each round's time, and can restart", async () => {
    const { user, input, status, server, startRound } = await setup();

    await startRound();
    server.clock.advance(START_GRACE_SECONDS + 5);
    await user.type(input(), "bay bridge{Enter}");
    await user.type(input(), "golden gate bridge{Enter}");
    await user.click(await screen.findByRole("button", { name: "Next image" }));

    expect(await screen.findByText("Image 2 of 2")).toBeInTheDocument();
    expect(status()).toHaveTextContent(""); // feedback reset for the new image
    expect(screen.queryByRole("img")).not.toBeInTheDocument(); // the next photo waits for its start
    await startRound();
    server.clock.advance(31);
    await user.type(input(), "big ben{Enter}"); // too late
    await user.click(await screen.findByRole("button", { name: "See results" }));

    expect(await screen.findByRole("heading", { name: "Practice complete" })).toHaveFocus();
    const first = scoreAt(5, CONFIG);
    expect(screen.getByText(/You scored/)).toHaveTextContent(`You scored ${first} out of ${CONFIG.maxPoints * 2}`);
    const [one, two] = screen.getAllByRole("listitem");
    expect(one).toHaveTextContent("Golden Gate Bridge ✓ correct");
    expect(one).toHaveTextContent("Got it in 5.0 s, 1 wrong guess");
    expect(two).toHaveTextContent("Big Ben time's up");

    await user.click(screen.getByRole("button", { name: "Play again" }));
    expect(await screen.findByText("Image 1 of 2")).toBeInTheDocument();
    expect(server.start).toHaveBeenCalledTimes(2); // a new server game
  });
});
