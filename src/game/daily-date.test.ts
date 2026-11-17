import { describe, expect, it } from "vitest";
import { DEFAULT_DAILY_RESET, addDays, assertDailyDate, dailyDateFor } from "./daily-date.ts";

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

describe("dailyDateFor formatter cache", () => {
  it("stays correct when called many times, alternating between two time zones", () => {
    const tokyo = { timeZone: "Asia/Tokyo", resetHour: 0 };
    for (let i = 0; i < 500; i += 1) {
      // 2026-11-15T15:30Z is 07:30 on the 15th in Los Angeles and 00:30 on the 16th in Tokyo.
      expect(dailyDateFor(at("2026-11-15T15:30:00Z"), LA)).toBe("2026-11-15");
      expect(dailyDateFor(at("2026-11-15T15:30:00Z"), tokyo)).toBe("2026-11-16");
      // Moving across each zone's reset still switches days.
      expect(dailyDateFor(at("2026-11-16T07:59:59Z"), LA)).toBe("2026-11-15");
      expect(dailyDateFor(at("2026-11-16T08:00:00Z"), LA)).toBe("2026-11-16");
      expect(dailyDateFor(at("2026-11-15T14:59:59Z"), tokyo)).toBe("2026-11-15");
      expect(dailyDateFor(at("2026-11-15T15:00:00Z"), tokyo)).toBe("2026-11-16");
    }
  });

  it("still rejects an unknown time zone after it has been tried before", () => {
    const mars = { timeZone: "Mars/Olympus", resetHour: 0 };
    expect(() => dailyDateFor(at("2026-11-16T12:00:00Z"), mars)).toThrow(RangeError);
    expect(() => dailyDateFor(at("2026-11-16T12:00:00Z"), mars)).toThrow(RangeError);
  });
});
