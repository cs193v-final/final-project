import { describe, expect, it } from "vitest";
import { formatPoints, formatSeconds, readClock, secondsNow } from "./round-clock.ts";
import type { TimedScoringConfig } from "./types.ts";

const CONFIG: TimedScoringConfig = { maxPoints: 10_000, minPoints: 100, revealSeconds: 25, limitSeconds: 30, curve: 2 };

describe("readClock", () => {
  it("starts hidden and worth maxPoints", () => {
    expect(readClock(0, CONFIG)).toEqual({ seconds: 0, points: 10_000, progress: 0, phase: "clearing", secondsLeft: 30 });
  });

  it("clears the effect by time, not by score", () => {
    const halfway = readClock(12.5, CONFIG);
    expect(halfway.progress).toBe(0.5);
    expect(halfway.points).toBe(2_575);
    expect(halfway.phase).toBe("clearing");
  });

  it("is clear from revealSeconds until the limit", () => {
    expect(readClock(25, CONFIG)).toMatchObject({ progress: 1, phase: "clear", points: 100, secondsLeft: 5 });
    expect(readClock(29.9, CONFIG).phase).toBe("clear");
  });

  it("is time's up at the limit and after, worth 0 with no time left", () => {
    expect(readClock(30, CONFIG)).toMatchObject({ phase: "timeUp", points: 0, secondsLeft: 0, progress: 1 });
    expect(readClock(42, CONFIG)).toMatchObject({ phase: "timeUp", secondsLeft: 0 });
  });

  it("treats a negative time as the start", () => {
    expect(readClock(-1, CONFIG)).toMatchObject({ seconds: 0, points: 10_000, progress: 0 });
  });
});

describe("secondsNow", () => {
  it("adds the local time since the server's response to the server's elapsed time", () => {
    expect(secondsNow(3, 1_000_000, 1_002_500)).toBe(5.5);
  });

  it("ignores the device's absolute clock, only the difference counts", () => {
    expect(secondsNow(3, 0, 2_500)).toBe(secondsNow(3, 9e12, 9e12 + 2_500));
  });

  it("never goes below 0", () => {
    expect(secondsNow(0, 5_000, 4_000)).toBe(0);
  });
});

describe("formatting", () => {
  it("shows seconds with one decimal, rounded down so 29.99 s isn't shown as 30.0 s", () => {
    expect(formatSeconds(6.2)).toBe("6.2 s");
    expect(formatSeconds(0)).toBe("0.0 s");
    expect(formatSeconds(29.99)).toBe("29.9 s");
  });

  it("shows points with thousands separators", () => {
    expect(formatPoints(10_000)).toBe("10,000");
    expect(formatPoints(100)).toBe("100");
    expect(formatPoints(0)).toBe("0");
  });
});
