// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { runGameCall, type GameResult } from "@/game/game-result";
import { parsePuzzle } from "@/game/puzzles";
import { TIMED_SCORING_CONFIG } from "@/game/scoring-config";
import { act as playMove, getGame, MemoryGameStore, puzzleSourceFrom, startGame, type GameOwner } from "@/game/server-game";
import type { GameAction, Pack, Puzzle } from "@/game/types";
import { fakeAnimate, fakeMotionSetting, removeFakeAnimate } from "@/test/fakeMotion";
import { Confetti } from "./Confetti";
import { PracticeGame } from "./PracticeGame";

// Spec for #48: a satisfying moment on a correct guess, clear feedback on a
// wrong one, never color alone, and no motion for players who turn it off.
// Motion answers the player's own moves, not a game loaded on a refresh.

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
const PACK: Pack = { id: "pk", kind: "practice", title: "Practice", theme: "Mixed", puzzleIds: ["p1", "p2"] };
const OWNER: GameOwner = { anonId: "test-owner" };

/**
 * Stand-ins for the Server Actions: the real game service (#54) on an
 * in-memory store. Its clock (`advance`, in seconds) only moves by hand.
 */
function backend() {
  let now = Date.UTC(2030, 0, 1, 12);
  const deps = { games: new MemoryGameStore(), puzzles: puzzleSourceFrom(PUZZLES), now: () => now };
  return {
    advance: (seconds: number) => (now += seconds * 1000),
    start: vi.fn(() => runGameCall(() => startGame(deps, PACK, OWNER, TIMED_SCORING_CONFIG))),
    act: vi.fn((gameId: string, action: GameAction, revision: number) =>
      runGameCall(() => playMove(deps, gameId, OWNER, action, revision)),
    ),
    get: vi.fn((gameId: string) => runGameCall(() => getGame(deps, gameId, OWNER))),
  };
}
type Backend = ReturnType<typeof backend>;

/** A game started on `server`, its first round started and played up to `moves`, as a page refresh would load it. */
async function gameAfter(server: Backend, moves: GameAction[]): Promise<GameResult> {
  const started = await server.start();
  if (!started.ok) throw new Error("start failed");
  let revision = started.view.revision;
  for (const move of [{ type: "start" } as const, ...moves]) {
    const result = await server.act(started.view.gameId, move, revision);
    if (result.ok) revision = result.view.revision;
  }
  return server.get(started.view.gameId);
}

let animate: Mock;
beforeEach(() => {
  animate = fakeAnimate();
});
afterEach(() => {
  vi.unstubAllGlobals();
  removeFakeAnimate();
  window.history.replaceState(null, "", "/");
});

/** The elements animations were played on, in order. */
function animated(): HTMLElement[] {
  return animate.mock.contexts as HTMLElement[];
}
const shakes = () => animated().filter((el) => el.hasAttribute("data-guess-row"));
const pops = () => animated().filter((el) => el.hasAttribute("data-image-box"));

/** Renders the game (a new one, or `initial` as loaded on the server), waits for its first image and starts its round if it's ready. */
async function setup({ server = backend(), initial = null }: { server?: Backend; initial?: GameResult | null } = {}) {
  const user = userEvent.setup();
  const { container } = render(<PracticeGame initial={initial} start={server.start} act={server.act} get={server.get} />);
  await screen.findByText(/^Image \d+ of 2$/);
  /** Presses Start round if the round is ready (timed rounds, #255). */
  const startIfReady = async () => {
    const start = screen.queryByRole("button", { name: "Start round" });
    if (start === null) return;
    await user.click(start);
    await screen.findByRole("textbox", { name: "What is it?" });
  };
  await startIfReady();
  const input = () => screen.getByRole("textbox", { name: "What is it?" });
  const status = () => screen.getByRole("status");
  const confetti = () => container.querySelector("[data-confetti]");
  const icon = () => status().querySelector("[data-feedback-icon]");
  /** Sends a guess and waits for the server's answer to show. */
  const guess = async (text: string, shown: string | RegExp) => {
    await startIfReady();
    await user.type(input(), `${text}{Enter}`);
    await waitFor(() => expect(status()).toHaveTextContent(shown));
  };
  return { user, server, input, status, confetti, icon, guess };
}

describe("answer feedback with motion allowed", () => {
  beforeEach(() => {
    fakeMotionSetting(false);
  });

  it("shakes the guess box on a wrong guess and marks it with ✗ as well as text", async () => {
    const { guess, icon, confetti } = await setup();
    await guess("bay bridge", "“bay bridge” isn't it");

    expect(animated()).toHaveLength(1);
    expect(shakes()).toHaveLength(1);
    expect(icon()).toHaveTextContent("✗");
    expect(icon()).toHaveAttribute("aria-hidden", "true");
    expect(confetti()).not.toBeInTheDocument();
  });

  it("keeps keyboard focus in the guess box through the shake", async () => {
    const { user, guess, input, status } = await setup();
    await guess("bay bridge", "isn't it");
    expect(input()).toHaveFocus();
    // The player can type the next guess straight away.
    await user.keyboard("golden gate bridge{Enter}");
    await waitFor(() => expect(status()).toHaveTextContent("Correct!"));
  });

  it("shakes again for every wrong guess, even the same one", async () => {
    const { guess } = await setup();
    await guess("bay bridge", "(1 wrong guess)");
    await guess("bay bridge", "(2 wrong guesses)");
    expect(shakes()).toHaveLength(2);
  });

  it("doesn't shake again when the next image starts after a wrong guess", async () => {
    const { user, guess } = await setup();
    await guess("bay bridge", "isn't it");
    await guess("golden gate bridge", "Correct!");
    await user.click(screen.getByRole("button", { name: "Next image" }));
    await user.click(await screen.findByRole("button", { name: "Start round" }));
    expect(await screen.findByRole("textbox", { name: "What is it?" })).toBeInTheDocument();
    expect(shakes()).toHaveLength(1);
  });

  it("celebrates a correct guess: confetti, a pop on the image, and ✓ with text", async () => {
    const { guess, icon, confetti } = await setup();
    await guess("golden gate bridge", "Correct! It's Golden Gate Bridge.");

    expect(confetti()).toBeInTheDocument();
    // Decorative only: hidden from screen readers, which hear the status text.
    expect(confetti()).toHaveAttribute("aria-hidden", "true");
    expect(pops()).toHaveLength(1);
    expect(shakes()).toHaveLength(0);
    expect(icon()).toHaveTextContent("✓");
  });

  it("keeps the confetti free of text, so it can never show an answer", async () => {
    const { guess, confetti } = await setup();
    await guess("golden gate bridge", "Correct!");
    expect(confetti()?.textContent).toBe("");
  });

  it("pops once per solved image, and again for the next one", async () => {
    const { user, guess } = await setup();
    await guess("golden gate bridge", "Correct!");
    expect(pops()).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Next image" }));
    expect(await screen.findByText("Image 2 of 2")).toBeInTheDocument();
    expect(pops()).toHaveLength(1);

    await guess("big ben", "Correct!");
    expect(pops()).toHaveLength(2);
  });

  it("clears the confetti on the next image, and shows it again for the next solve", async () => {
    const { user, guess, confetti } = await setup();
    await guess("golden gate bridge", "Correct!");
    await user.click(screen.getByRole("button", { name: "Next image" }));
    expect(await screen.findByText("Image 2 of 2")).toBeInTheDocument();
    expect(confetti()).not.toBeInTheDocument();

    await guess("big ben", "Correct!");
    expect(confetti()).toBeInTheDocument();
  });

  it("doesn't celebrate or shake on a time-out or a blank guess", async () => {
    const { user, server, input, status, icon, confetti } = await setup();
    await user.click(screen.getByRole("button", { name: "Guess" }));
    expect(icon()).not.toBeInTheDocument();
    server.advance(40);
    await user.type(input(), "golden gate bridge{Enter}"); // too late
    await waitFor(() => expect(status()).toHaveTextContent("Time's up."));
    expect(confetti()).not.toBeInTheDocument();
    expect(icon()).not.toBeInTheDocument();
    expect(animated()).toHaveLength(0);
  });

  it("has no confetti on the final score screen", async () => {
    const { user, guess, confetti } = await setup();
    await guess("golden gate bridge", "Correct!");
    await user.click(screen.getByRole("button", { name: "Next image" }));
    await guess("big ben", "Correct!");
    await user.click(screen.getByRole("button", { name: "See results" }));
    expect(await screen.findByRole("button", { name: "Play again" })).toBeInTheDocument();
    expect(confetti()).not.toBeInTheDocument();
  });

  it("doesn't shake for the wrong guess a resumed game shows, only for a new one", async () => {
    const server = backend();
    const initial = await gameAfter(server, [{ type: "guess", guess: "bay bridge" }]);
    const { guess, status, icon } = await setup({ server, initial });
    expect(status()).toHaveTextContent("“bay bridge” isn't it (1 wrong guess)");
    expect(icon()).toHaveTextContent("✗");
    expect(animated()).toHaveLength(0);

    await guess("tower bridge", "(2 wrong guesses)");
    expect(shakes()).toHaveLength(1);
  });

  it("doesn't celebrate again when a refresh resumes a solved image", async () => {
    const server = backend();
    const initial = await gameAfter(server, [{ type: "guess", guess: "golden gate bridge" }]);
    const { status, icon, confetti } = await setup({ server, initial });
    expect(status()).toHaveTextContent("Correct! It's Golden Gate Bridge.");
    expect(icon()).toHaveTextContent("✓");
    expect(confetti()).not.toBeInTheDocument();
    expect(animated()).toHaveLength(0);
  });

  it("doesn't celebrate a solve that happened in another tab", async () => {
    const { user, server, input, status, confetti } = await setup();
    const started = await (server.start.mock.results[0]!.value as Promise<GameResult>);
    if (!started.ok) throw new Error("start failed");
    const current = await server.get(started.view.gameId);
    if (!current.ok) throw new Error("get failed");
    // Another tab solves the image first, so this tab's guess is a conflict and the game is reloaded.
    await server.act(started.view.gameId, { type: "guess", guess: "golden gate bridge" }, current.view.revision);
    server.act.mockResolvedValueOnce({ ok: false, error: "conflict" });

    await user.type(input(), "golden gate bridge{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("updated since you last saw it");
    expect(status()).toHaveTextContent("Correct! It's Golden Gate Bridge.");
    expect(confetti()).not.toBeInTheDocument();
    expect(animated()).toHaveLength(0);
  });
});

describe("answer feedback with reduced motion", () => {
  it("plays no animation and no confetti, but keeps the icons and text", async () => {
    fakeMotionSetting(true);
    const { guess, icon, confetti } = await setup();

    await guess("bay bridge", "isn't it");
    expect(icon()).toHaveTextContent("✗");

    await guess("golden gate bridge", "Correct!");
    expect(icon()).toHaveTextContent("✓");

    expect(animate).not.toHaveBeenCalled();
    expect(confetti()).not.toBeInTheDocument();
  });

  it("removes the confetti at once if the player turns on reduced motion mid-celebration", async () => {
    const setting = fakeMotionSetting(false);
    const { guess, status, confetti } = await setup();
    await guess("golden gate bridge", "Correct!");
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
