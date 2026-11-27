// Spec for #110 (audit L12): a failed seed prints the database's own error and
// the table, never the query's parameters (which include private answers).
import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it } from "vitest";

import { errorLines, tableOf } from "./error-lines.ts";

describe("errorLines", () => {
  it("prints a failed query's table and database error, without its parameters", () => {
    const cause = new Error('relation "puzzles" does not exist');
    const error = new DrizzleQueryError('insert into "puzzles" ("id", "answer") values ($1, $2)', ["pz-1a2b3c4d", "Strawberry"], cause);
    expect(error.message).toMatch(/Strawberry/); // drizzle's own message has the answer
    const lines = errorLines(error);
    expect(lines).toEqual([
      "A database query failed (table puzzles). Its parameters aren't shown: they can include answers.",
      'Caused by: relation "puzzles" does not exist',
    ]);
    expect(lines.join("\n")).not.toMatch(/Strawberry|pz-1a2b3c4d/);
  });

  it("keeps the message of any other error, and its causes", () => {
    const error = new Error("DATABASE_URL must require TLS", { cause: new Error("connect ECONNREFUSED") });
    expect(errorLines(error)).toEqual(["DATABASE_URL must require TLS", "Caused by: connect ECONNREFUSED"]);
    expect(errorLines("plain text")).toEqual(["plain text"]);
  });

  it("hides a query error's parameters wherever it is in the cause chain", () => {
    const query = new DrizzleQueryError('update "packs" set "title" = $1', ["Fruit"], new Error("deadlock detected"));
    const lines = errorLines(new Error("Seeding failed", { cause: query }));
    expect(lines).toEqual([
      "Seeding failed",
      "Caused by: A database query failed (table packs). Its parameters aren't shown: they can include answers.",
      "Caused by: deadlock detected",
    ]);
  });

  it("stops after five levels, so a cause loop can't print forever", () => {
    const a = new Error("a");
    a.cause = a;
    expect(errorLines(a)).toHaveLength(5);
  });
});

describe("tableOf", () => {
  it.each([
    ['insert into "puzzles" ("id") values ($1)', "puzzles"],
    ['update "packs" set "title" = $1', "packs"],
    ['select "id" from "games" where "id" = $1', "games"],
    ["begin", null],
  ])("%s → %s", (query, table) => expect(tableOf(query)).toBe(table));
});
