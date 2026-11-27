// @vitest-environment jsdom
// Spec for the daily leaderboard screen (#62): the top players as a table,
// your own rank (in the list or below it), and what to do if you're not on it.
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { LeaderboardEntry } from "@/game/types";

import { DailyLeaderboard, type DailyLeaderboardProps } from "./DailyLeaderboard";

const entry = (rank: number, username: string, score: number): LeaderboardEntry => ({ rank, username, score, beatAiCount: 0 });
const TOP = [entry(1, "Bob", 200), entry(2, "Alice", 180), entry(2, "cara_99", 180), entry(4, "Dan", 0)];
const board = (over: Partial<DailyLeaderboardProps["board"]> = {}): DailyLeaderboardProps["board"] => ({
  date: "2026-11-17",
  top: TOP,
  players: 4,
  you: null,
  loggedIn: false,
  ...over,
});

const you = (e: LeaderboardEntry, players: number) => ({ entry: e, players });

const rows = () => within(screen.getByRole("table")).getAllByRole("row").slice(1); // minus the header row

describe("DailyLeaderboard", () => {
  it("lists the top players with rank, name and score, in order, in a captioned table", () => {
    render(<DailyLeaderboard board={board()} />);
    const table = screen.getByRole("table", { name: /today's daily/i });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Rank", "Player", "Score"]);
    expect(rows().map((r) => within(r).getAllByRole("cell").map((c) => c.textContent))).toEqual([
      ["1", "Bob", "200"],
      ["2", "Alice", "180"],
      ["2", "cara_99", "180"],
      ["4", "Dan", "0"],
    ]);
  });

  it("says how many players finished", () => {
    render(<DailyLeaderboard board={board()} />);
    expect(screen.getByText(/4 players finished today's daily/i)).toBeInTheDocument();
  });

  it("marks your own row when you're in the top list, and doesn't repeat it below", () => {
    render(<DailyLeaderboard board={board({ loggedIn: true, you: you(entry(2, "cara_99", 180), 4) })} />);
    const mine = rows()[2]!;
    expect(mine).toHaveAttribute("aria-current", "true");
    expect(mine).toHaveTextContent("cara_99 (you)");
    expect(rows().filter((r) => r.getAttribute("aria-current"))).toHaveLength(1);
    expect(screen.queryByText(/your rank/i)).not.toBeInTheDocument();
  });

  it("marks only your row when someone else has the same score", () => {
    render(<DailyLeaderboard board={board({ loggedIn: true, you: you(entry(2, "Alice", 180), 4) })} />);
    expect(rows()[1]).toHaveAttribute("aria-current", "true");
    expect(rows()[2]).not.toHaveAttribute("aria-current");
  });

  it("shows your rank below the list when you're not in it", () => {
    render(<DailyLeaderboard board={board({ loggedIn: true, players: 40, you: you(entry(23, "zed", 40), 40) })} />);
    expect(screen.getByText(/your rank:/i).closest("p")).toHaveTextContent("Your rank: 23 of 40, with 40 points.");
  });

  it("asks a logged-out player to log in, and comes back here after", () => {
    render(<DailyLeaderboard board={board()} />);
    expect(screen.getByRole("link", { name: /log in/i })).toHaveAttribute("href", "/login?next=%2Fleaderboard");
  });

  it("sends a logged-in player who hasn't finished today's daily to play it", () => {
    render(<DailyLeaderboard board={board({ loggedIn: true })} />);
    expect(screen.getByRole("link", { name: /play today's daily/i })).toHaveAttribute("href", "/daily");
    expect(screen.queryByRole("link", { name: /log in/i })).not.toBeInTheDocument();
  });

  it("says so when nobody has finished yet, without an empty table", () => {
    render(<DailyLeaderboard board={board({ top: [], players: 0 })} />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText(/nobody has finished today's daily yet/i)).toBeInTheDocument();
  });

  // The top list is cached for about a minute; your own entry and the player
  // count next to it are read fresh. Right after you finish, the cached list
  // may not have you yet.
  it("just after you're the first to finish: your rank, not 'nobody has finished'", () => {
    render(<DailyLeaderboard board={board({ top: [], players: 0, loggedIn: true, you: you(entry(1, "zed", 200), 1) })} />);
    expect(screen.queryByText(/nobody has finished/i)).not.toBeInTheDocument();
    expect(screen.getByText(/your rank:/i).closest("p")).toHaveTextContent("Your rank: 1 of 1, with 200 points.");
    expect(screen.getByText(/updates within a minute/i)).toBeInTheDocument();
  });

  it("just after you finish in the top list but the cached list doesn't have you yet: says the board updates soon", () => {
    render(<DailyLeaderboard board={board({ loggedIn: true, you: you(entry(3, "zed", 190), 5) })} />);
    expect(rows().filter((r) => r.getAttribute("aria-current"))).toHaveLength(0);
    expect(screen.getByText(/your rank:/i).closest("p")).toHaveTextContent("Your rank: 3 of 5, with 190 points.");
    expect(screen.getByText(/updates within a minute/i)).toBeInTheDocument();
    // The count is the fresh one, so it agrees with your rank.
    expect(screen.getByText(/5 players finished today's daily/i)).toBeInTheDocument();
  });

  it("doesn't say the board will update when you're simply below the top list", () => {
    render(<DailyLeaderboard board={board({ loggedIn: true, players: 40, you: you(entry(23, "zed", 40), 40) })} />);
    expect(screen.queryByText(/updates within a minute/i)).not.toBeInTheDocument();
  });

  it("doesn't mark an 'Unknown player' row as you (names that don't decrypt all look alike)", () => {
    const unknown = TOP.map((e) => ({ ...e, username: "Unknown player" }));
    render(<DailyLeaderboard board={board({ top: unknown, loggedIn: true, you: you(entry(2, "Unknown player", 180), 4) })} />);
    expect(rows().filter((r) => r.getAttribute("aria-current"))).toHaveLength(0);
  });

  it("shows the board's day", () => {
    render(<DailyLeaderboard board={board()} />);
    expect(screen.getByText("Tuesday, November 17")).toBeInTheDocument();
  });

  it("shows each rank as text in its tile: first, then second and third, then the rest", () => {
    render(<DailyLeaderboard board={board()} />);
    const tiles = rows().map((r) => within(within(r).getAllByRole("cell")[0]!).getByText(/^\d+$/u));
    expect(tiles.map((t) => t.textContent)).toEqual(["1", "2", "2", "4"]);
    expect(tiles[0]!.className).toContain("bg-meadow");
    expect(tiles[1]!.className).toContain("bg-flash");
    expect(tiles[3]!.className).toContain("bg-paper");
  });

  it("tints your own row", () => {
    render(<DailyLeaderboard board={board({ loggedIn: true, you: you(entry(2, "cara_99", 180), 4) })} />);
    expect(rows()[2]!.className).toContain("bg-meadow-soft");
    expect(rows()[1]!.className).not.toContain("bg-meadow-soft");
  });

  it("shows your rank below the list as a big figure, straight away (counting up would read as dropping places)", () => {
    const { container } = render(<DailyLeaderboard board={board({ loggedIn: true, players: 40, you: you(entry(23, "zed", 40), 40) })} />);
    const strip = container.querySelector("[data-your-rank]")!;
    expect(strip).toHaveAttribute("aria-hidden", "true");
    expect(strip.querySelector("[data-rank-count]")).toHaveTextContent("23");
    expect(strip).toHaveTextContent("of 40");
    vi.unstubAllGlobals();
  });

  it("when the board is only for logged-in players (LEADERBOARD_PUBLIC off): asks to log in instead of 'nobody has finished'", () => {
    render(<DailyLeaderboard board={board({ top: [], players: 0, topHidden: true })} />);
    expect(screen.queryByText(/nobody has finished/i)).not.toBeInTheDocument();
    expect(screen.getByText(/log in to see today's board/i)).toBeInTheDocument();
  });
});
