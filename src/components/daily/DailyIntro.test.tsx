// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DEFAULT_DAILY_RESET } from "@/game/daily-date";
import { DailyIntro, formatDailyDate, resetLabel } from "./DailyIntro";

// Spec for #58's first screen: the theme comes before the first image, and a
// day with nothing scheduled gets a friendly way to keep playing.

const FRUIT = { date: "2026-11-20", pack: { title: "Fruit", theme: "Fruit", puzzleCount: 5 } };

describe("DailyIntro", () => {
  it("shows today's theme as the heading, with the date and the number of images", () => {
    render(<DailyIntro intro={FRUIT} reset={DEFAULT_DAILY_RESET} start={<button type="button">Start</button>} />);
    expect(screen.getByRole("heading", { name: "Today: Fruit" })).toBeInTheDocument();
    expect(screen.getByText("Friday, November 20")).toBeInTheDocument();
    expect(screen.getByText(/5 images, the same for everyone/u)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
  });

  it("says the first game is the one that counts", () => {
    render(<DailyIntro intro={FRUIT} reset={DEFAULT_DAILY_RESET} />);
    expect(screen.getByText(/You get one game/u)).toBeInTheDocument();
  });

  it("says when the next challenge starts", () => {
    render(<DailyIntro intro={FRUIT} reset={DEFAULT_DAILY_RESET} />);
    expect(screen.getByText("A new challenge starts at midnight Pacific time.")).toBeInTheDocument();
  });

  it("says playing isn't ready yet when there's no Start button, without a dead link", () => {
    render(<DailyIntro intro={FRUIT} reset={DEFAULT_DAILY_RESET} />);
    expect(screen.getByText(/Playing the daily arrives/u)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("uses the singular for a one-image pack", () => {
    render(<DailyIntro intro={{ ...FRUIT, pack: { ...FRUIT.pack, puzzleCount: 1 } }} reset={DEFAULT_DAILY_RESET} />);
    expect(screen.getByText(/^1 image, /u)).toBeInTheDocument();
  });

  it("on a day with nothing scheduled, says so kindly and offers practice", () => {
    render(<DailyIntro intro={{ date: "2026-11-25", pack: null }} reset={DEFAULT_DAILY_RESET} />);
    expect(screen.getByRole("heading", { name: "No daily challenge today" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Play practice" })).toHaveAttribute("href", "/play");
    expect(screen.getByText(/A new challenge starts at midnight Pacific time/u)).toBeInTheDocument();
  });
});

describe("formatDailyDate", () => {
  it.each([
    ["2026-11-20", "Friday, November 20"],
    ["2026-03-08", "Sunday, March 8"],
    ["2028-02-29", "Tuesday, February 29"],
  ])("formats %s as %s, whatever the computer's time zone", (date, label) => {
    expect(formatDailyDate(date)).toBe(label);
  });
});

describe("resetLabel", () => {
  it("names the default reset in words", () => {
    expect(resetLabel(DEFAULT_DAILY_RESET)).toBe("midnight Pacific time");
  });

  it("names any other configured reset", () => {
    expect(resetLabel({ timeZone: "UTC", resetHour: 6 })).toBe("6:00 UTC");
  });
});
