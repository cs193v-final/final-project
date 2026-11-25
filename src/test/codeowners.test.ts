// .github/CODEOWNERS (#184): every path in it exists, and the files that need
// database or encryption oversight resolve to the right owners. GitHub silently
// ignores a line whose path matches nothing, so a renamed folder would quietly
// drop its review rule without this test.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../..", import.meta.url));
const file = join(root, ".github", "CODEOWNERS");

type Rule = { line: number; pattern: string; owners: string[] };

function parse(text: string): Rule[] {
  return text.split("\n").flatMap((raw, i) => {
    const content = raw.replace(/(^|\s)#.*$/, "").trim();
    if (!content) return [];
    const [pattern, ...owners] = content.split(/\s+/);
    return [{ line: i + 1, pattern: pattern!, owners }];
  });
}

const rules = parse(readFileSync(file, "utf8"));

/** Owners of a repo-relative file path. GitHub uses the last matching rule. */
function ownersOf(path: string): string[] {
  let owners: string[] = [];
  for (const { pattern, owners: o } of rules) {
    const p = pattern.slice(1); // every pattern is anchored with a leading "/"
    if (p.endsWith("/") ? path.startsWith(p) : path === p || path.startsWith(`${p}/`)) owners = o;
  }
  return owners;
}

const DB = ["@Hombobow", "@Joseph-G-McD"];
const AUTH = ["@Hombobow", "@Joseph-G-McD", "@ethanyng"];

describe(".github/CODEOWNERS", () => {
  it("has rules", () => {
    expect(rules.length).toBeGreaterThan(0);
  });

  it.each(rules)("line $line: $pattern exists", ({ pattern }) => {
    // Plain anchored paths only, so this check can be exact: no globs.
    expect(pattern).toMatch(/^\/[^*?[\]!]+$/);
    const path = join(root, pattern.slice(1));
    expect(existsSync(path), `${pattern} does not exist`).toBe(true);
    // A trailing "/" means a folder; without it, these lines name files.
    expect(statSync(path).isDirectory()).toBe(pattern.endsWith("/"));
  });

  it.each(rules)("line $line: every owner is a GitHub handle", ({ owners }) => {
    expect(owners.length).toBeGreaterThan(0);
    for (const owner of owners) expect(owner).toMatch(/^@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/);
  });

  it("lists each path once", () => {
    const patterns = rules.map((r) => r.pattern);
    expect(new Set(patterns).size).toBe(patterns.length);
  });

  it.each([
    "src/db/schema.ts",
    "drizzle/0000_init.sql",
    "drizzle/meta/_journal.json",
    "drizzle.config.ts",
    "scripts/seed.ts",
    "scripts/pack-scoring.ts",
    "scripts/encrypt-game-states.ts",
  ])("%s is owned by Jacky and Joseph", (path) => {
    expect(ownersOf(path)).toEqual(DB);
  });

  it.each(["src/auth/session.ts", "src/crypto/vault.ts"])("%s is owned by Jacky, Joseph and Ethan", (path) => {
    expect(ownersOf(path)).toEqual(AUTH);
  });

  it.each(["src/game/guess.ts", "src/app/page.tsx", "scripts/preview-levels.ts", "package.json"])(
    "%s has no code owner",
    (path) => {
      expect(ownersOf(path)).toEqual([]);
    },
  );
});
