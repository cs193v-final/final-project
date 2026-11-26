import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_DAILY_RESET } from "./daily-date.ts";
import { formatCountdown, nextChallengeAt, roundSquare, shareText } from "./daily-result.ts";

// Spec for the daily result screen (#58): the countdown's target and wording,
// and a share text that never gives an answer away.

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("nextChallengeAt", () => {
  it.each([
    ["a day in PST", "2026-11-17", "2026-11-18T08:00:00.000Z"],
    ["a day in PDT", "2026-07-01", "2026-07-02T07:00:00.000Z"],
    ["the day before clocks spring forward (Mar 7)", "2026-03-07", "2026-03-08T08:00:00.000Z"],
    ["the day clocks spring forward (Mar 8)", "2026-03-08", "2026-03-09T07:00:00.000Z"],
    ["the day before clocks fall back (Oct 31)", "2026-10-31", "2026-11-01T07:00:00.000Z"],
    ["the day clocks fall back (Nov 1)", "2026-11-01", "2026-11-02T08:00:00.000Z"],
    ["New Year's Eve", "2026-12-31", "2027-01-01T08:00:00.000Z"],
  ])("finds when the next daily starts after %s", (_name, date, next) => {
    expect(nextChallengeAt(date, DEFAULT_DAILY_RESET).toISOString()).toBe(next);
  });

  it("works for other resets, including a half-hour zone", () => {
    expect(nextChallengeAt("2026-11-17", { timeZone: "UTC", resetHour: 6 }).toISOString()).toBe("2026-11-18T06:00:00.000Z");
    // India is UTC+5:30, so midnight there is 18:30 UTC the day before.
    expect(nextChallengeAt("2026-11-17", { timeZone: "Asia/Kolkata", resetHour: 0 }).toISOString()).toBe("2026-11-17T18:30:00.000Z");
    expect(nextChallengeAt("2026-11-17", { timeZone: "Pacific/Kiritimati", resetHour: 0 }).toISOString()).toBe("2026-11-17T10:00:00.000Z");
  });

  it("depends only on the day played, not on the clock: a page left open past midnight doesn't skip a day", () => {
    // Darian's case (review of #121): the Nov 17 daily finished at 23:58 PT;
    // at 00:00:30 the next daily (Nov 18) has started, it isn't a day away.
    const next = nextChallengeAt("2026-11-17", DEFAULT_DAILY_RESET);
    expect(new Date("2026-11-18T08:00:30Z").getTime()).toBeGreaterThan(next.getTime());
  });

  it.each(["UTC", "Pacific/Kiritimati", "Pacific/Pago_Pago"])("doesn't depend on the computer's time zone (TZ=%s)", (tz) => {
    vi.stubEnv("TZ", tz);
    expect(nextChallengeAt("2026-11-17", DEFAULT_DAILY_RESET).toISOString()).toBe("2026-11-18T08:00:00.000Z");
  });
});

describe("formatCountdown", () => {
  it.each([
    [0, "under a minute"],
    [59_999, "under a minute"],
    [60_000, "1m"],
    [14 * 60_000 + 59_000, "14m"],
    [2 * 3_600_000 + 14 * 60_000, "2h 14m"],
    [24 * 3_600_000, "24h 0m"],
  ])("%i ms → %s", (ms, text) => {
    expect(formatCountdown(ms)).toBe(text);
  });
});

describe("share text", () => {
  it("gives one square per image by how much of the photo had cleared (#255), black for a time-out", () => {
    expect(
      (
        [
          { outcome: "correct", seconds: 0 },
          { outcome: "correct", seconds: 4.9 }, // under a fifth of 25 s
          { outcome: "correct", seconds: 5 },
          { outcome: "correct", seconds: 12 },
          { outcome: "correct", seconds: 24.9 },
          { outcome: "correct", seconds: 27 }, // after the photo is clear
          { outcome: "timedOut", seconds: 30 },
        ] as const
      ).map((r) => roundSquare(r, 25)),
    ).toEqual(["🟩", "🟩", "🟨", "🟧", "🟧", "🟥", "⬛"]);
  });

  it("names the game, day and theme, and the score, with no answers", () => {
    const text = shareText({
      gameName: "Zoom Out",
      date: "2026-11-17",
      theme: "Fruit",
      rounds: [
        { outcome: "correct", seconds: 2 },
        { outcome: "timedOut", seconds: 30 },
      ],
      revealSeconds: 25,
      total: 8479,
      maxTotal: 20000,
      url: "https://example.com/daily",
    });
    expect(text).toBe("Zoom Out daily · Nov 17 · Fruit\n🟩⬛ 8479/20000\nhttps://example.com/daily");
  });

  it("leaves the link out when there isn't one", () => {
    expect(shareText({ gameName: "Zoom Out", date: "2026-11-17", theme: "Fruit", rounds: [], revealSeconds: 25, total: 0, maxTotal: 0 })).toBe(
      "Zoom Out daily · Nov 17 · Fruit\n 0/0",
    );
  });
});
