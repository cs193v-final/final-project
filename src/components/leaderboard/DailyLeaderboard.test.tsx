// @vitest-environment jsdom
// Spec for the daily leaderboard screen (#62): the top players as a table,
// your own rank (in the list or below it), and what to do if you're not on it.
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

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
    render(<DailyLeaderboard board={board({ loggedIn: true, you: entry(2, "cara_99", 180) })} />);
    const mine = rows()[2]!;
    expect(mine).toHaveAttribute("aria-current", "true");
    expect(mine).toHaveTextContent("cara_99 (you)");
    expect(rows().filter((r) => r.getAttribute("aria-current"))).toHaveLength(1);
    expect(screen.queryByText(/your rank/i)).not.toBeInTheDocument();
  });

  it("marks only your row when someone else has the same score", () => {
    render(<DailyLeaderboard board={board({ loggedIn: true, you: entry(2, "Alice", 180) })} />);
    expect(rows()[1]).toHaveAttribute("aria-current", "true");
    expect(rows()[2]).not.toHaveAttribute("aria-current");
  });

  it("shows your rank below the list when you're not in it", () => {
    render(<DailyLeaderboard board={board({ loggedIn: true, players: 40, you: entry(23, "zed", 40) })} />);
    expect(screen.getByText(/your rank/i).closest("p")).toHaveTextContent("Your rank: 23 of 40, with 40 points.");
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
});
