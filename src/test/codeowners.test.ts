// .github/CODEOWNERS (#184): every path in it exists, and the files that need
// database or encryption oversight resolve to the right owners. GitHub silently
// ignores a line whose path matches nothing, so a renamed folder would quietly
// drop its review rule without this test.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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

// Database scripts (#205). A script in scripts/ talks to the database if it
// imports the app's database code (src/db/), the seed script's connection
// helpers (./seed-db.ts: connect, driverFor), or a Postgres driver itself, or
// if it reads a DATABASE_URL* variable. Each one needs a CODEOWNERS line, so a
// new database script can't skip the database owners' review.
const DB_MODULE = /^(?:(?:\.\.\/)+src\/db|@\/db)(?:\/|\.ts$|$)|^\.\/seed-db(?:\.ts)?$/;
const DB_DRIVER = /^(?:@neondatabase\/serverless|pg|postgres|@electric-sql\/pglite|drizzle-orm\/(?:neon-http|neon-serverless|node-postgres|postgres-js|pglite))$/;
const IMPORT = /\bfrom\s*["']([^"']+)["']|\bimport\s*(?:\(\s*)?["']([^"']+)["']|\brequire\(\s*["']([^"']+)["']/g;
const DB_ENV = /\bprocess\.env(?:\.|\[\s*["'])DATABASE_URL/;

/** Whether a script's source talks to the database, by the signals above. Comments are ignored. */
function talksToDatabase(source: string): boolean {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
  for (const m of code.matchAll(IMPORT)) {
    const spec = m[1] ?? m[2] ?? m[3] ?? "";
    if (DB_MODULE.test(spec) || DB_DRIVER.test(spec)) return true;
  }
  return DB_ENV.test(code);
}

const scriptsDir = join(root, "scripts");
const dbScripts = readdirSync(scriptsDir)
  .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
  .filter((name) => talksToDatabase(readFileSync(join(scriptsDir, name), "utf8")))
  .map((name) => `scripts/${name}`)
  .sort();
// Each database script's test sits next to it and is owned with it.
const dbScriptTests = dbScripts
  .map((path) => path.replace(/\.ts$/, ".test.ts"))
  .filter((path) => existsSync(join(root, path)));
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

  describe("database scripts (#205)", () => {
    it.each([
      ['import { connect } from "./seed-db.ts";', true],
      ["import { driverFor } from './seed-db';", true],
      ['import type { AnyDb } from "../src/db/content.ts";', true],
      ['import * as schema from "@/db/schema";', true],
      ['const { neon } = await import("@neondatabase/serverless");', true],
      ['import { drizzle } from "drizzle-orm/node-postgres";', true],
      ['import pg from "pg";', true],
      ["const url = process.env.DATABASE_URL_UNPOOLED;", true],
      ['const url = process.env["DATABASE_URL"];', true],
      ['import { cutLevels } from "../src/images/cut.ts";', false],
      ['import { eq } from "drizzle-orm";', false],
      ['import { dbLike } from "../src/dbtools/x.ts";', false],
      ["// Connects with DATABASE_URL_UNPOOLED, like connect() in ./seed-db.ts.", false],
      ['/* import { connect } from "./seed-db.ts"; */', false],
    ])("talksToDatabase(%j) is %s", (source, expected) => {
      expect(talksToDatabase(source)).toBe(expected);
    });

    it("finds the known database scripts, and not the image-only ones", () => {
      expect(dbScripts).toEqual(
        expect.arrayContaining([
          "scripts/seed-db.ts",
          "scripts/seed.ts",
          "scripts/seed-images.ts",
          "scripts/pack-scoring.ts",
          "scripts/create-test-user.ts",
          "scripts/encrypt-game-states.ts",
        ]),
      );
      expect(dbScripts).not.toContain("scripts/preview-levels.ts");
    });

    it.each([...dbScripts, ...dbScriptTests])("%s is owned by Jacky and Joseph", (path) => {
      expect(ownersOf(path), `${path} talks to the database: add "/${path}" to .github/CODEOWNERS`).toEqual(DB);
    });
  });
});
