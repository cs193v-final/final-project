// Spec for recognising "this owner already has today's daily" across our
// database drivers (#58, review of #119). A miss would turn a double-click on
// Start into "unavailable" instead of resuming the game.
import { afterEach, describe, expect, it, vi } from "vitest";

import { dailyDateText, isDuplicateDaily } from "./games";

/** What each driver throws for a unique violation (Postgres SQLSTATE 23505). */
const pgError = (constraint: string) => Object.assign(new Error(`duplicate key value violates unique constraint "${constraint}"`), { code: "23505", constraint });
/** Neon's HTTP driver: a NeonDbError with the same fields. */
const neonError = (constraint: string) => {
  const e = pgError(constraint);
  e.name = "NeonDbError";
  return e;
};
/** Drizzle wraps the driver's error: "Failed query: …" with the driver error as `cause`. */
const drizzleWrapped = (cause: Error) => Object.assign(new Error("Failed query: insert into \"games\" …"), { name: "DrizzleQueryError", cause });

describe("isDuplicateDaily", () => {
  it.each([
    ["node-postgres", pgError("games_daily_user_key")],
    ["Neon HTTP", neonError("games_daily_anon_key")],
    ["node-postgres wrapped by Drizzle", drizzleWrapped(pgError("games_daily_anon_key"))],
    ["Neon wrapped by Drizzle", drizzleWrapped(neonError("games_daily_user_key"))],
    ["a driver that only says it in the message", Object.assign(new Error('duplicate key value violates unique constraint "games_daily_user_key"'), { code: "23505" })],
  ])("recognises the daily unique index from %s", (_driver, error) => {
    expect(isDuplicateDaily(error)).toBe(true);
  });

  it.each([
    ["another unique index", pgError("users_username_lower_key")],
    ["another error code on the index", Object.assign(pgError("games_daily_user_key"), { code: "23503" })],
    ["a plain error", new Error("connection refused")],
    ["not an error at all", "games_daily_user_key"],
    ["nothing", undefined],
  ])("doesn't mistake %s for it", (_name, error) => {
    expect(isDuplicateDaily(error)).toBe(false);
  });
});

describe("dailyDateText", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(["UTC", "Asia/Tokyo", "Pacific/Kiritimati", "America/Los_Angeles", "Pacific/Pago_Pago"])(
    "reads node-postgres's local-midnight Date as the same day (TZ=%s)",
    (tz) => {
      vi.stubEnv("TZ", tz);
      // node-postgres turns a `date` of 2026-11-17 into local midnight.
      expect(dailyDateText(new Date(2026, 10, 17))).toBe("2026-11-17");
    },
  );

  it("passes a text date through", () => {
    expect(dailyDateText("2026-11-17")).toBe("2026-11-17");
  });
});
