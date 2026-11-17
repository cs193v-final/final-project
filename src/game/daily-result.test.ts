import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_DAILY_RESET } from "./daily-date.ts";
import { formatCountdown, nextResetAt, roundSquare, shareText } from "./daily-result.ts";

// Spec for the daily result screen (#58): the countdown's target and wording,
// and a share text that never gives an answer away.

const realTZ = process.env.TZ;
afterEach(() => {
  process.env.TZ = realTZ;
});

describe("nextResetAt", () => {
  it.each([
    ["an evening in PST", "2026-11-17T04:30:00Z", "2026-11-17T08:00:00.000Z"],
    ["just after a reset", "2026-11-17T08:00:00Z", "2026-11-18T08:00:00.000Z"],
    ["one second before a reset", "2026-11-17T07:59:59Z", "2026-11-17T08:00:00.000Z"],
    ["in PDT", "2026-07-01T20:00:00Z", "2026-07-02T07:00:00.000Z"],
    ["the day clocks spring forward (Mar 8)", "2026-03-08T12:00:00Z", "2026-03-09T07:00:00.000Z"],
    ["the day clocks fall back (Nov 1)", "2026-11-01T12:00:00Z", "2026-11-02T08:00:00.000Z"],
  ])("finds the next midnight Pacific for %s", (_name, now, next) => {
    expect(nextResetAt(new Date(now), DEFAULT_DAILY_RESET).toISOString()).toBe(next);
  });

  it("works for other configured resets, including a half-hour zone", () => {
    expect(nextResetAt(new Date("2026-11-17T05:00:00Z"), { timeZone: "UTC", resetHour: 6 }).toISOString()).toBe(
      "2026-11-17T06:00:00.000Z",
    );
    // India is UTC+5:30, so midnight there is 18:30 UTC.
    expect(nextResetAt(new Date("2026-11-17T12:00:00Z"), { timeZone: "Asia/Kolkata", resetHour: 0 }).toISOString()).toBe(
      "2026-11-17T18:30:00.000Z",
    );
  });

  it.each(["UTC", "Pacific/Kiritimati", "Pacific/Pago_Pago"])("doesn't depend on the computer's time zone (TZ=%s)", (tz) => {
    process.env.TZ = tz;
    expect(nextResetAt(new Date("2026-11-17T04:30:00Z"), DEFAULT_DAILY_RESET).toISOString()).toBe("2026-11-17T08:00:00.000Z");
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
  it("gives one square per image by how far the player zoomed out, black for a skip", () => {
    expect(
      [
        { outcome: "correct", revealLevelReached: 0 },
        { outcome: "correct", revealLevelReached: 1 },
        { outcome: "correct", revealLevelReached: 2 },
        { outcome: "correct", revealLevelReached: 3 },
        { outcome: "skipped", revealLevelReached: 3 },
      ].map((r) => roundSquare(r as never)),
    ).toEqual(["🟩", "🟨", "🟧", "🟥", "⬛"]);
  });

  it("names the game, day and theme, and the score, with no answers", () => {
    const text = shareText({
      gameName: "Zoom Out",
      date: "2026-11-17",
      theme: "Fruit",
      rounds: [
        { outcome: "correct", revealLevelReached: 0 },
        { outcome: "skipped", revealLevelReached: 3 },
      ],
      total: 100,
      maxTotal: 200,
      url: "https://example.com/daily",
    });
    expect(text).toBe("Zoom Out daily · Nov 17 · Fruit\n🟩⬛ 100/200\nhttps://example.com/daily");
  });

  it("leaves the link out when there isn't one", () => {
    expect(shareText({ gameName: "Zoom Out", date: "2026-11-17", theme: "Fruit", rounds: [], total: 0, maxTotal: 0 })).toBe(
      "Zoom Out daily · Nov 17 · Fruit\n 0/0",
    );
  });
});
