import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GAME_NAME } from "./site.ts";

// The game's name (#51): one constant, used everywhere.

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/u.test(name) ? [path] : [];
  });
}

describe("GAME_NAME", () => {
  it("is Squint", () => {
    expect(GAME_NAME).toBe("Squint");
  });

  it("is the only place the name is written: no page title or text still says the old working title", () => {
    const stale = [...sourceFiles("src"), ...sourceFiles("e2e")]
      .filter((path) => !path.endsWith("site.test.ts"))
      .filter((path) => readFileSync(path, "utf8").includes("Zoom Out"));
    expect(stale).toEqual([]);
  });
});
