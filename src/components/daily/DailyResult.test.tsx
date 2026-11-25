// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { DailyIntro } from "@/game/daily";
import type { DailyStats } from "@/game/daily-result";
import type { GameView, RoundResult } from "@/game/types";
import { DailyResult } from "./DailyResult";

// Spec for the daily result panel (#58, Joseph's choices): a countdown to the
// next challenge, a spoiler-free Share button, Home, and per-image stats
// ("better than X% of players") below.

const INTRO: DailyIntro = { date: "2026-11-17", pack: { theme: "Fruit", puzzleCount: 2 } };
const round = (puzzleId: string, outcome: RoundResult["outcome"], level: number, points: number): RoundResult => ({
  puzzleId,
  outcome,
  revealLevelReached: level,
  wrongGuesses: 0,
  points,
  breakdown: { base: 100, revealPenalty: 0, wrongGuessPenalty: 0 },
});
const VIEW: GameView = {
  gameId: "g1",
  revision: 4,
  pack: { id: "pk", kind: "daily", title: "Fruit", theme: "Fruit" },
  round: null,
  results: [round("pz-1", "correct", 0, 100), round("pz-2", "skipped", 3, 0)],
  total: 100,
  finished: true,
};
const STATS: DailyStats = {
  rounds: [
    { position: 1, others: 4, beaten: 3 },
    { position: 2, others: 4, beaten: 0 },
  ],
  others: 4,
  beatenTotal: 2,
};
// 8:46 pm PST on Nov 17 (the day played), so the next daily is in 3h 14m.
const EVENING = () => new Date("2026-11-18T04:46:00Z");

function setup(props: Partial<Parameters<typeof DailyResult>[0]> = {}) {
  const share = vi.fn<(text: string) => Promise<"shared" | "copied">>(async () => "copied");
  const loadStats = vi.fn(async () => STATS);
  render(<DailyResult intro={INTRO} view={VIEW} loadStats={loadStats} now={EVENING} share={share} {...props} />);
  return { share, loadStats, user: userEvent.setup() };
}

describe("DailyResult", () => {
  it("counts down to the next challenge", async () => {
    setup();
    expect(await screen.findByText("3h 14m")).toBeInTheDocument();
    expect(screen.getByText(/The next one starts in/u)).toBeInTheDocument();
  });

  it("shares a text with one square per image and the score, and no answers", async () => {
    const { share, user } = setup();
    await user.click(screen.getByRole("button", { name: "Share result" }));
    const text = share.mock.calls[0]![0];
    expect(text).toMatch(/^Zoom Out daily · Nov 17 · Fruit\n🟩⬛ 100\/200\nhttp:\/\/localhost(:\d+)?\/daily$/u);
    expect(text).not.toMatch(/pz-|Kiwi|Lychee/u);
    expect(screen.getByRole("status")).toHaveTextContent("Copied to the clipboard, with no answers in it.");
  });

  it("says so when the phone's share sheet was used", async () => {
    const { user } = setup({ share: vi.fn(async () => "shared" as const) });
    await user.click(screen.getByRole("button", { name: "Share result" }));
    expect(screen.getByRole("status")).toHaveTextContent("Shared.");
  });

  it("shows the text to copy by hand when sharing fails", async () => {
    const { user } = setup({ share: vi.fn(async () => Promise.reject(new Error("denied"))) });
    await user.click(screen.getByRole("button", { name: "Share result" }));
    expect(screen.getByRole("status")).toHaveTextContent("Couldn't share. Copy this instead:");
    expect((screen.getByRole("textbox", { name: "Your result to copy" }) as HTMLTextAreaElement).value).toContain("🟩⬛ 100/200");
  });

  it("treats closing the share sheet as nothing, not an error", async () => {
    const { user } = setup({ share: vi.fn(async () => Promise.reject(new DOMException("closed", "AbortError"))) });
    await user.click(screen.getByRole("button", { name: "Share result" }));
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("links home", () => {
    setup();
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Leaderboard" })).toHaveAttribute("href", "/leaderboard"); // #62
  });

  it("shows how the player did on each image against everyone who finished", async () => {
    const { loadStats } = setup();
    expect(await screen.findByText(/Overall you did better than/u)).toHaveTextContent(
      "Overall you did better than 50% of the 4 other players who finished today.",
    );
    const items = within(screen.getByRole("region", { name: "How you did on each image" })).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["Image 1Better than 75% of players", "Image 2Better than 0% of players"]);
    expect(loadStats).toHaveBeenCalledTimes(1);
  });

  it("tells the first finisher there's no one to compare with yet", async () => {
    setup({ loadStats: vi.fn(async () => ({ rounds: [], others: 0, beatenTotal: 0 })) });
    expect(await screen.findByText(/You're the first to finish today/u)).toBeInTheDocument();
  });

  it("says stats aren't available when they can't be loaded, instead of breaking the result", async () => {
    setup({ loadStats: vi.fn(async () => Promise.reject(new Error("offline"))) });
    expect(await screen.findByText("Stats aren't available right now.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share result" })).toBeInTheDocument();
  });

  it("asks for the stats of the day that was played", async () => {
    const { loadStats } = setup();
    await screen.findByText(/Overall you did better than/u);
    expect(loadStats).toHaveBeenCalledWith("2026-11-17");
  });

  it("says a new challenge is ready once the next daily has started, with a link to it (page left open past midnight)", async () => {
    // Darian's case: the Nov 17 daily, and it's now 00:00:30 PST on Nov 18.
    setup({ now: () => new Date("2026-11-18T08:00:30Z") });
    expect(await screen.findByText(/A new challenge is ready\./u)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Play it" })).toHaveAttribute("href", "/daily");
    expect(screen.queryByText(/The next one starts in/u)).not.toBeInTheDocument();
  });

  it("scores the share text against the game's own scoring, not the default", async () => {
    const own = { ...VIEW, results: VIEW.results.map((r) => ({ ...r, breakdown: { ...r.breakdown, base: 50 } })), total: 50 };
    const { share, user } = setup({ view: own });
    await user.click(screen.getByRole("button", { name: "Share result" }));
    expect(share.mock.calls[0]![0]).toContain("🟩⬛ 50/100");
  });

  it("falls back to the clipboard when the share sheet refuses (default share)", async () => {
    const user = userEvent.setup(); // first: it installs its own clipboard, which we replace
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "share", { configurable: true, value: vi.fn(async () => Promise.reject(new DOMException("no", "NotAllowedError"))) });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<DailyResult intro={INTRO} view={VIEW} loadStats={vi.fn(async () => STATS)} now={EVENING} />);
    await user.click(screen.getByRole("button", { name: "Share result" }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("🟩⬛ 100/200"));
    expect(screen.getByRole("status")).toHaveTextContent("Copied to the clipboard");
    Reflect.deleteProperty(navigator, "share");
  });

  it("doesn't restart its clock when given a new time function every render", async () => {
    const setInterval = vi.spyOn(window, "setInterval");
    const { rerender } = render(
      <DailyResult intro={INTRO} view={VIEW} loadStats={vi.fn(async () => STATS)} now={() => new Date("2026-11-18T04:46:00Z")} />,
    );
    await screen.findByText("3h 14m");
    const started = setInterval.mock.calls.length;
    for (let i = 0; i < 3; i++) {
      rerender(<DailyResult intro={INTRO} view={VIEW} loadStats={vi.fn(async () => STATS)} now={() => new Date("2026-11-18T04:46:00Z")} />);
    }
    expect(setInterval.mock.calls.length).toBe(started);
    setInterval.mockRestore();
  });
});
