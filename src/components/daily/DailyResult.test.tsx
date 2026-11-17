// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { DailyIntro } from "@/game/daily";
import { DEFAULT_DAILY_RESET } from "@/game/daily-date";
import type { DailyStats } from "@/game/daily-result";
import type { GameView, RoundResult } from "@/game/types";
import { DailyResult } from "./DailyResult";

// Spec for the daily result panel (#58, Joseph's choices): a countdown to the
// next challenge, a spoiler-free Share button, Home, and per-image stats
// ("better than X% of players") below.

const INTRO: DailyIntro = { date: "2026-11-17", reset: DEFAULT_DAILY_RESET, pack: { theme: "Fruit", puzzleCount: 2 } };
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
// 8:46 pm PST on Nov 16, so the next reset is in 3h 14m.
const EVENING = () => new Date("2026-11-17T04:46:00Z");

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
});
