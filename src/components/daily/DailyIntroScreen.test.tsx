// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_DAILY_RESET } from "@/game/daily-date";
import type { DailyIntro } from "@/game/daily";
import { DailyIntroScreen, formatDailyDate, resetLabel } from "./DailyIntroScreen";

// Spec for #58's first screen: the theme comes before the first image, and a
// day with nothing scheduled gets a friendly way to keep playing.

const FRUIT: DailyIntro = { date: "2026-11-20", pack: { theme: "Fruit", puzzleCount: 5 } };

describe("DailyIntro", () => {
  it("shows today's theme as the heading, with the date and the number of images", () => {
    render(<DailyIntroScreen intro={FRUIT} start={<button type="button">Start</button>} />);
    expect(screen.getByRole("heading", { name: "Today: Fruit" })).toBeInTheDocument();
    expect(screen.getByText("Friday, November 20")).toBeInTheDocument();
    expect(screen.getByText(/5 images, the same for everyone/u)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
  });

  it("says the first game is the one that counts", () => {
    render(<DailyIntroScreen intro={FRUIT} />);
    expect(screen.getByText(/Your first game is the one that counts/u)).toBeInTheDocument();
  });

  it("says when the next challenge starts", () => {
    render(<DailyIntroScreen intro={FRUIT} />);
    expect(screen.getByText("A new challenge starts at midnight Pacific Time.")).toBeInTheDocument();
  });

  it("says playing isn't ready yet when there's no Start button, without a dead link", () => {
    render(<DailyIntroScreen intro={FRUIT} />);
    expect(screen.getByText(/Playing the daily arrives/u)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("uses the singular for a one-image pack", () => {
    render(<DailyIntroScreen intro={{ ...FRUIT, pack: { theme: "Fruit", puzzleCount: 1 } }} />);
    expect(screen.getByText(/^1 image, /u)).toBeInTheDocument();
  });

  it("on a day with nothing scheduled, says so kindly and offers practice", () => {
    render(<DailyIntroScreen intro={{ date: "2026-11-25", pack: null }} />);
    expect(screen.getByRole("heading", { name: "No daily challenge today" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Play practice" })).toHaveAttribute("href", "/play");
    expect(screen.getByText(/A new challenge starts at midnight Pacific Time/u)).toBeInTheDocument();
  });
});

// vi.stubEnv restores TZ exactly (including "not set"), so no zone leaks into later tests.
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("formatDailyDate", () => {
  it.each([
    ["2026-11-20", "Friday, November 20"],
    ["2026-03-08", "Sunday, March 8"],
    ["2028-02-29", "Tuesday, February 29"],
  ])("formats %s as %s", (date, label) => {
    expect(formatDailyDate(date)).toBe(label);
  });

  it.each(["UTC", "America/Los_Angeles", "Pacific/Kiritimati", "Pacific/Pago_Pago"])(
    "gives the same day whatever the computer's time zone (TZ=%s)",
    (tz) => {
      vi.stubEnv("TZ", tz);
      expect(formatDailyDate("2026-11-20")).toBe("Friday, November 20");
    },
  );
});

describe("resetLabel", () => {
  it("names the default reset in words", () => {
    expect(resetLabel()).toBe("midnight Pacific Time");
    expect(resetLabel(DEFAULT_DAILY_RESET)).toBe("midnight Pacific Time");
  });

  it.each([
    [{ timeZone: "America/New_York", resetHour: 0 }, "midnight Eastern Time"],
    [{ timeZone: "UTC", resetHour: 6 }, "6 AM Coordinated Universal Time"],
    [{ timeZone: "America/New_York", resetHour: 18 }, "6 PM Eastern Time"],
    [{ timeZone: "America/Los_Angeles", resetHour: 12 }, "noon Pacific Time"],
  ])("names any other zone by its name, not its id (%j)", (reset, label) => {
    expect(resetLabel(reset)).toBe(label);
  });
});
