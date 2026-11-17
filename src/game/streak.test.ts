import { describe, expect, it } from "vitest";
import {
  DEFAULT_DAILY_RESET,
  addDays,
  assertDailyDate,
  currentStreak,
  dailyDateFor,
  longestStreak,
} from "./streak.ts";

const LA = DEFAULT_DAILY_RESET;
const at = (iso: string) => new Date(iso);

describe("DEFAULT_DAILY_RESET", () => {
  it("is midnight in Los Angeles until the open decision is settled", () => {
    expect(DEFAULT_DAILY_RESET).toEqual({ timeZone: "America/Los_Angeles", resetHour: 0 });
  });
});

describe("dailyDateFor", () => {
  it("uses the default reset when no config is given", () => {
    expect(dailyDateFor(at("2026-11-16T07:59:59Z"))).toBe("2026-11-15");
    expect(dailyDateFor(at("2026-11-16T08:00:00Z"))).toBe("2026-11-16");
  });

  it("switches days exactly at midnight Los Angeles time (PST, UTC-8)", () => {
    expect(dailyDateFor(at("2026-01-15T07:59:59.999Z"), LA)).toBe("2026-01-14");
    expect(dailyDateFor(at("2026-01-15T08:00:00Z"), LA)).toBe("2026-01-15");
  });

  it("switches days exactly at midnight Los Angeles time in summer (PDT, UTC-7)", () => {
    expect(dailyDateFor(at("2026-07-04T06:59:59Z"), LA)).toBe("2026-07-03");
    expect(dailyDateFor(at("2026-07-04T07:00:00Z"), LA)).toBe("2026-07-04");
  });

  it("supports a nonzero reset hour: before 4am local still counts as yesterday", () => {
    const config = { timeZone: "America/Los_Angeles", resetHour: 4 };
    // 03:59:59 and 04:00 PST on 2026-11-16.
    expect(dailyDateFor(at("2026-11-16T11:59:59Z"), config)).toBe("2026-11-15");
    expect(dailyDateFor(at("2026-11-16T12:00:00Z"), config)).toBe("2026-11-16");
    // Late evening is still the same day.
    expect(dailyDateFor(at("2026-11-17T07:30:00Z"), config)).toBe("2026-11-16");
  });

  it("supports other time zones", () => {
    const utc = { timeZone: "UTC", resetHour: 0 };
    expect(dailyDateFor(at("2026-11-15T23:59:59Z"), utc)).toBe("2026-11-15");
    expect(dailyDateFor(at("2026-11-16T00:00:00Z"), utc)).toBe("2026-11-16");
    const tokyo = { timeZone: "Asia/Tokyo", resetHour: 0 };
    expect(dailyDateFor(at("2026-11-15T15:00:00Z"), tokyo)).toBe("2026-11-16");
  });

  describe("spring forward (2026-03-08 in Los Angeles: 02:00 PST jumps to 03:00 PDT)", () => {
    it("starts 2026-03-08 at midnight PST and 2026-03-09 at midnight PDT", () => {
      expect(dailyDateFor(at("2026-03-08T07:59:59Z"), LA)).toBe("2026-03-07");
      expect(dailyDateFor(at("2026-03-08T08:00:00Z"), LA)).toBe("2026-03-08");
      // The day is only 23 hours long: the next reset is at 07:00Z, not 08:00Z.
      expect(dailyDateFor(at("2026-03-09T06:59:59Z"), LA)).toBe("2026-03-08");
      expect(dailyDateFor(at("2026-03-09T07:00:00Z"), LA)).toBe("2026-03-09");
    });

    it("stays on the same day across the skipped hour", () => {
      expect(dailyDateFor(at("2026-03-08T09:59:59Z"), LA)).toBe("2026-03-08"); // 01:59:59 PST
      expect(dailyDateFor(at("2026-03-08T10:00:00Z"), LA)).toBe("2026-03-08"); // 03:00 PDT
    });

    it("starts the day at the first time after a reset hour that doesn't exist", () => {
      const config = { timeZone: "America/Los_Angeles", resetHour: 2 };
      expect(dailyDateFor(at("2026-03-08T09:59:59Z"), config)).toBe("2026-03-07"); // 01:59:59 PST
      expect(dailyDateFor(at("2026-03-08T10:00:00Z"), config)).toBe("2026-03-08"); // 03:00 PDT
    });
  });

  describe("fall back (2026-11-01 in Los Angeles: 02:00 PDT goes back to 01:00 PST)", () => {
    it("starts 2026-11-01 at midnight PDT and 2026-11-02 at midnight PST", () => {
      expect(dailyDateFor(at("2026-11-01T06:59:59Z"), LA)).toBe("2026-10-31");
      expect(dailyDateFor(at("2026-11-01T07:00:00Z"), LA)).toBe("2026-11-01");
      // The day is 25 hours long: the next reset is at 08:00Z, not 07:00Z.
      expect(dailyDateFor(at("2026-11-02T07:59:59Z"), LA)).toBe("2026-11-01");
      expect(dailyDateFor(at("2026-11-02T08:00:00Z"), LA)).toBe("2026-11-02");
    });

    it("keeps both copies of the repeated hour on the same day", () => {
      expect(dailyDateFor(at("2026-11-01T08:30:00Z"), LA)).toBe("2026-11-01"); // 01:30 PDT
      expect(dailyDateFor(at("2026-11-01T09:30:00Z"), LA)).toBe("2026-11-01"); // 01:30 PST
    });

    it("resets only once when the reset hour is repeated", () => {
      const config = { timeZone: "America/Los_Angeles", resetHour: 1 };
      expect(dailyDateFor(at("2026-11-01T07:59:59Z"), config)).toBe("2026-10-31"); // 00:59:59 PDT
      expect(dailyDateFor(at("2026-11-01T08:00:00Z"), config)).toBe("2026-11-01"); // 01:00 PDT
      expect(dailyDateFor(at("2026-11-01T09:00:00Z"), config)).toBe("2026-11-01"); // 01:00 PST
    });
  });

  it("goes back across month and year boundaries before the reset", () => {
    const config = { timeZone: "America/Los_Angeles", resetHour: 4 };
    expect(dailyDateFor(at("2027-01-01T11:00:00Z"), config)).toBe("2026-12-31"); // 03:00 PST
    expect(dailyDateFor(at("2026-12-01T11:00:00Z"), config)).toBe("2026-11-30");
    expect(dailyDateFor(at("2028-03-01T11:00:00Z"), config)).toBe("2028-02-29");
  });

  it("rejects an invalid instant, reset hour or time zone", () => {
    expect(() => dailyDateFor(new Date("not a date"), LA)).toThrow(RangeError);
    for (const resetHour of [-1, 24, 1.5, Number.NaN]) {
      expect(() => dailyDateFor(at("2026-11-16T12:00:00Z"), { ...LA, resetHour })).toThrow(RangeError);
    }
    expect(() => dailyDateFor(at("2026-11-16T12:00:00Z"), { timeZone: "Mars/Olympus", resetHour: 0 })).toThrow(
      RangeError,
    );
  });
});

describe("addDays", () => {
  it("crosses month, year and leap-day boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
  });

  it("is not affected by daylight-saving changes", () => {
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
    expect(addDays("2026-11-02", -1)).toBe("2026-11-01");
  });

  it("rejects a fractional number of days", () => {
    expect(() => addDays("2026-11-16", 0.5)).toThrow(RangeError);
  });
});

describe("assertDailyDate", () => {
  it.each(["2026-11-16", "2028-02-29", "1999-12-31"])("accepts %s", (date) => {
    expect(() => assertDailyDate(date)).not.toThrow();
  });

  it.each([
    "",
    "2026-11-1",
    "2026/11/16",
    "2026-11-16T00:00:00Z",
    " 2026-11-16",
    "2026-13-01",
    "2026-00-10",
    "2026-02-30",
    "2027-02-29",
    "2026-04-31",
    "0099-01-01",
  ])("rejects %j", (date) => {
    expect(() => assertDailyDate(date)).toThrow(RangeError);
  });
});

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
