// Spec for the streak query (#63): the played days are each finished daily's
// stored `daily_date`, for that account only. Anonymous games, practice games,
// unfinished games and other players never count, and a pack scheduled on two
// days isn't counted twice (no join on pack_id). Real migrations on PGlite.
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { summarizeStreak } from "@/game/streak";

import type { Db } from "./index";
import * as schema from "./schema";
import { getPlayedDailyDates } from "./streaks";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

let pg: PGlite;
let db: Db;
let alice: string;
let bob: string;
let newcomer: string;

const FINISHED = new Date("2026-11-20T12:00:00Z");

async function addUser(name: string): Promise<string> {
  const [row] = await db
    .insert(schema.users)
    .values({ usernameEncrypted: `enc-${name}`, usernameIndex: `idx-${name}`, passwordHash: "hash" })
    .returning({ id: schema.users.id });
  return row!.id;
}

type GameRow = { packId: string; dailyDate?: string | null; userId?: string; anonOwnerHash?: string; finished?: boolean };

async function addGame({ packId, dailyDate = null, userId, anonOwnerHash, finished = true }: GameRow) {
  await db.insert(schema.games).values({
    packId,
    dailyDate,
    userId: userId ?? null,
    anonOwnerHash: anonOwnerHash ?? null,
    state: {},
    finishedAt: finished ? FINISHED : null,
  });
}

beforeAll(async () => {
  pg = new PGlite();
  const pglite = drizzle({ client: pg, schema });
  await migrate(pglite, { migrationsFolder });
  db = pglite as unknown as Db;

  await db.insert(schema.packs).values([
    { id: "pk-fruit", kind: "daily", title: "Fruit", theme: "Fruit" },
    { id: "pk-birds", kind: "daily", title: "Birds", theme: "Birds" },
    { id: "pk-practice", kind: "practice", title: "Practice", theme: "Practice" },
  ]);
  // The same pack on two days: a join on pack_id would count Alice's one game twice.
  await db.insert(schema.dailySchedule).values([
    { date: "2026-11-14", packId: "pk-fruit" },
    { date: "2026-11-15", packId: "pk-birds" },
    { date: "2026-11-16", packId: "pk-fruit" },
  ]);

  alice = await addUser("alice");
  bob = await addUser("bob");
  newcomer = await addUser("newcomer");

  // Alice: Nov 14 and 15 finished (inserted out of order), Nov 16 started but not finished.
  await addGame({ packId: "pk-birds", dailyDate: "2026-11-15", userId: alice });
  await addGame({ packId: "pk-fruit", dailyDate: "2026-11-14", userId: alice });
  await addGame({ packId: "pk-fruit", dailyDate: "2026-11-16", userId: alice, finished: false });
  // Practice games have no daily date, finished or not.
  await addGame({ packId: "pk-practice", userId: alice });
  await addGame({ packId: "pk-practice", userId: alice, finished: false });
  // Bob played Nov 16 only.
  await addGame({ packId: "pk-fruit", dailyDate: "2026-11-16", userId: bob });
  // Anonymous dailies never count for anyone.
  await addGame({ packId: "pk-fruit", dailyDate: "2026-11-16", anonOwnerHash: "a".repeat(64) });
  await addGame({ packId: "pk-birds", dailyDate: "2026-11-15", anonOwnerHash: "b".repeat(64) });
});

afterAll(async () => {
  await pg.close();
});

describe("getPlayedDailyDates", () => {
  it("returns each finished daily's stored date, oldest first, as YYYY-MM-DD", async () => {
    expect(await getPlayedDailyDates(db, alice)).toEqual(["2026-11-14", "2026-11-15"]);
  });

  it("only counts the account's own games", async () => {
    expect(await getPlayedDailyDates(db, bob)).toEqual(["2026-11-16"]);
  });

  it("is empty for a player who hasn't finished a daily", async () => {
    expect(await getPlayedDailyDates(db, newcomer)).toEqual([]);
  });

  it("counts a game for its stored day, however late it was finished", async () => {
    // Every game above has the same finished_at (Nov 20); only daily_date matters.
    const dates = await getPlayedDailyDates(db, alice);
    expect(dates).not.toContain("2026-11-20");
  });

  it("feeds the streak: a daily left unfinished doesn't count until it's finished", async () => {
    expect(summarizeStreak(await getPlayedDailyDates(db, alice), "2026-11-16")).toEqual({
      current: 2,
      longest: 2,
      playedToday: false,
    });
    // Alice finishes her Nov 16 daily.
    await db
      .update(schema.games)
      .set({ finishedAt: FINISHED })
      .where(and(eq(schema.games.userId, alice), eq(schema.games.dailyDate, "2026-11-16")));
    expect(summarizeStreak(await getPlayedDailyDates(db, alice), "2026-11-16")).toEqual({
      current: 3,
      longest: 3,
      playedToday: true,
    });
  });
});
