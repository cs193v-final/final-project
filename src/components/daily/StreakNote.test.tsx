// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StreakNote } from "./StreakNote";

// Spec for the streak line (#63): in words, on the home screen and the daily
// result. Only logged-in players have a streak; the server counts it.

describe("StreakNote on the home screen", () => {
  it("shows nothing when logged out", () => {
    const { container } = render(<StreakNote streak={null} where="home" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the streak and that today is done", () => {
    render(<StreakNote streak={{ current: 3, longest: 3, playedToday: true }} where="home" />);
    const note = screen.getByRole("region", { name: "Daily streak" });
    expect(note).toHaveTextContent("Daily streak: 3 days. Come back tomorrow to make it 4.");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("links to today's daily when the streak needs it today", () => {
    render(<StreakNote streak={{ current: 1, longest: 1, playedToday: false }} where="home" />);
    expect(screen.getByRole("region", { name: "Daily streak" })).toHaveTextContent(
      "Daily streak: 1 day. Play today's daily to keep it going.",
    );
    expect(screen.getByRole("link", { name: "Play today's daily" })).toHaveAttribute("href", "/daily");
  });

  it("invites a first game with no streak, and keeps the best run after a missed day", () => {
    render(<StreakNote streak={{ current: 0, longest: 5, playedToday: false }} where="home" />);
    expect(screen.getByRole("region", { name: "Daily streak" })).toHaveTextContent(
      "No daily streak yet. Play today's daily to start one. Your best is 5 days.",
    );
    expect(screen.getByRole("link", { name: "Play today's daily" })).toHaveAttribute("href", "/daily");
  });

  it("shows the best run only when it's longer than the current one", () => {
    const { rerender } = render(<StreakNote streak={{ current: 2, longest: 2, playedToday: true }} where="home" />);
    expect(screen.queryByText(/best/u)).not.toBeInTheDocument();
    rerender(<StreakNote streak={{ current: 2, longest: 7, playedToday: true }} where="home" />);
    expect(screen.getByRole("region", { name: "Daily streak" })).toHaveTextContent("Your best is 7 days.");
  });
});

describe("StreakNote look (#183)", () => {
  it("shows the count in a chip that screen readers skip, since the sentence says it", () => {
    const { container } = render(<StreakNote streak={{ current: 6, longest: 6, playedToday: true }} where="home" />);
    const chip = container.querySelector("[data-streak-chip]")!;
    expect(chip).toHaveTextContent("🔥6");
    expect(chip).toHaveAttribute("aria-hidden", "true");
  });

  it("shows no chip without a streak", () => {
    const { container } = render(<StreakNote streak={{ current: 0, longest: 0, playedToday: false }} where="home" />);
    expect(container.querySelector("[data-streak-chip]")).toBeNull();
    expect(screen.getByRole("region", { name: "Daily streak" })).toHaveTextContent(/^No daily streak yet\./u);
  });
});

describe("StreakNote on the daily result", () => {
  it("shows the streak with today counted", () => {
    render(<StreakNote streak={{ current: 4, longest: 4, playedToday: true }} where="result" />);
    expect(screen.getByRole("region", { name: "Daily streak" })).toHaveTextContent(
      "Daily streak: 4 days. Come back tomorrow to make it 5.",
    );
  });

  it("says how to get a streak when logged out, coming back to the daily after logging in", () => {
    render(<StreakNote streak={null} where="result" />);
    expect(screen.getByText(/Want a daily streak\?/u)).toHaveTextContent(
      "Want a daily streak? Log in before you play tomorrow. Games played logged out don't count.",
    );
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login?next=%2Fdaily");
  });
});
