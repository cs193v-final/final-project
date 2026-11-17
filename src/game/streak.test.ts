import { describe, expect, it } from "vitest";
import { DEFAULT_DAILY_RESET, dailyDateFor } from "./daily-date.ts";
import { currentStreak, longestStreak } from "./streak.ts";

const LA = DEFAULT_DAILY_RESET;
const at = (iso: string) => new Date(iso);

describe("currentStreak", () => {
  it("is 0 with no games played", () => {
    expect(currentStreak([], "2026-11-16")).toBe(0);
  });

  it("counts consecutive days ending today", () => {
    expect(currentStreak(["2026-11-14", "2026-11-15", "2026-11-16"], "2026-11-16")).toBe(3);
  });

  it("keeps the streak alive when yesterday was played but today not yet", () => {
    expect(currentStreak(["2026-11-14", "2026-11-15"], "2026-11-16")).toBe(2);
  });

  it("is 0 once a whole day has been missed", () => {
    expect(currentStreak(["2026-11-13", "2026-11-14"], "2026-11-16")).toBe(0);
  });

  it("restarts after a missed day", () => {
    const played = ["2026-11-10", "2026-11-11", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16"];
    expect(currentStreak(played, "2026-11-16")).toBe(4);
    expect(currentStreak(["2026-11-14", "2026-11-16"], "2026-11-16")).toBe(1);
  });

  it("accepts unsorted input with duplicates", () => {
    const played = ["2026-11-16", "2026-11-14", "2026-11-15", "2026-11-16", "2026-11-14"];
    expect(currentStreak(played, "2026-11-16")).toBe(3);
  });

  it("accepts any iterable", () => {
    expect(currentStreak(new Set(["2026-11-15", "2026-11-16"]), "2026-11-16")).toBe(2);
  });

  it("ignores days after today", () => {
    expect(currentStreak(["2026-11-15", "2026-11-16", "2026-11-17"], "2026-11-16")).toBe(2);
    expect(currentStreak(["2026-11-17"], "2026-11-16")).toBe(0);
  });

  it("counts across month and year boundaries", () => {
    expect(currentStreak(["2026-10-30", "2026-10-31", "2026-11-01"], "2026-11-01")).toBe(3);
    expect(currentStreak(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"], "2027-01-02")).toBe(4);
  });

  it("counts across a leap day, and doesn't invent one in a common year", () => {
    expect(currentStreak(["2028-02-28", "2028-02-29", "2028-03-01"], "2028-03-01")).toBe(3);
    expect(currentStreak(["2028-02-28", "2028-03-01"], "2028-03-01")).toBe(1);
    expect(currentStreak(["2027-02-28", "2027-03-01"], "2027-03-01")).toBe(2);
  });

  it("counts across the spring-forward and fall-back days", () => {
    expect(currentStreak(["2026-03-07", "2026-03-08", "2026-03-09"], "2026-03-09")).toBe(3);
    expect(currentStreak(["2026-10-31", "2026-11-01", "2026-11-02"], "2026-11-02")).toBe(3);
  });

  it("works with dailyDateFor for games played late at night across both DST changes", () => {
    // Each game finished at 23:30 local time, Saturday through Monday.
    const spring = ["2026-03-08T07:30:00Z", "2026-03-09T06:30:00Z", "2026-03-10T06:30:00Z"].map((iso) =>
      dailyDateFor(at(iso), LA),
    );
    expect(spring).toEqual(["2026-03-07", "2026-03-08", "2026-03-09"]);
    expect(currentStreak(spring, dailyDateFor(at("2026-03-10T06:59:59Z"), LA))).toBe(3);
    // Next day, before playing: still alive. The day after: broken.
    expect(currentStreak(spring, dailyDateFor(at("2026-03-10T07:00:00Z"), LA))).toBe(3);
    expect(currentStreak(spring, dailyDateFor(at("2026-03-11T07:00:00Z"), LA))).toBe(0);

    const fall = ["2026-11-01T06:30:00Z", "2026-11-02T07:30:00Z", "2026-11-03T07:30:00Z"].map((iso) =>
      dailyDateFor(at(iso), LA),
    );
    expect(fall).toEqual(["2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(currentStreak(fall, dailyDateFor(at("2026-11-03T07:59:59Z"), LA))).toBe(3);
    expect(currentStreak(fall, dailyDateFor(at("2026-11-03T08:00:00Z"), LA))).toBe(3);
    expect(currentStreak(fall, dailyDateFor(at("2026-11-04T08:00:00Z"), LA))).toBe(0);
  });

  it("rejects invalid dates in the input or for today", () => {
    expect(() => currentStreak(["2026-11-15", "2026-02-30"], "2026-11-16")).toThrow(RangeError);
    expect(() => currentStreak(["not a date"], "2026-11-16")).toThrow(RangeError);
    expect(() => currentStreak([], "2026-11-16T00:00:00Z")).toThrow(RangeError);
  });
});

describe("longestStreak", () => {
  it("is 0 with no games played", () => {
    expect(longestStreak([])).toBe(0);
  });

  it("finds the longest run, wherever it is", () => {
    expect(longestStreak(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-05", "2026-11-06"])).toBe(3);
    expect(longestStreak(["2026-11-01", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"])).toBe(4);
    expect(longestStreak(["2026-11-01"])).toBe(1);
  });

  it("accepts unsorted input with duplicates", () => {
    expect(longestStreak(["2026-11-03", "2026-11-01", "2026-11-02", "2026-11-02", "2026-11-09"])).toBe(3);
  });

  it("counts across month, year, leap-day and DST boundaries", () => {
    expect(longestStreak(["2026-12-31", "2027-01-01", "2026-12-30"])).toBe(3);
    expect(longestStreak(["2028-02-28", "2028-02-29", "2028-03-01"])).toBe(3);
    expect(longestStreak(["2026-03-07", "2026-03-08", "2026-03-09"])).toBe(3);
    expect(longestStreak(["2026-10-31", "2026-11-01", "2026-11-02"])).toBe(3);
  });

  it("rejects invalid dates", () => {
    expect(() => longestStreak(["2026-11-01", "2026-11-31"])).toThrow(RangeError);
  });
});
