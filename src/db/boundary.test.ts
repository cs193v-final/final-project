// Only server code may use the database (AGENTS.md → Secrets). `src/db/index.ts`
// also imports "server-only", which fails the build if a Client Component pulls
// it in; this test catches it earlier and also covers `src/db/schema.ts`.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const srcDir = fileURLToPath(new URL("..", import.meta.url));
const dbDir = join(srcDir, "db");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|js|jsx|mjs)$/.test(entry.name) && !/\.test\.[jt]sx?$/.test(entry.name) ? [path] : [];
  });
}

/** `import ... from "x"`, `export ... from "x"`, `import "x"`, `import("x")`, `require("x")`. */
function importSpecifiers(code: string): string[] {
  const pattern = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"']+)["']/g;
  return [...code.matchAll(pattern)].map((m) => m[1]!);
}

/** True for "@/db", "@/db/schema", and relative paths that land in src/db. */
function isDbImport(specifier: string, fromFile: string): boolean {
  if (specifier === "@/db" || specifier.startsWith("@/db/")) return true;
  if (!specifier.startsWith(".")) return false;
  const target = resolve(fromFile, "..", specifier);
  return target === dbDir || target.startsWith(dbDir + "/");
}

/** A "use client" directive before any other statement (comments allowed). */
function isClientFile(code: string): boolean {
  const withoutComments = code.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "").trimStart();
  return /^["']use client["']/.test(withoutComments);
}

function isClientSide(file: string, code: string): boolean {
  const rel = relative(srcDir, file);
  // Components and the framework-free game logic both end up in the browser.
  return rel.startsWith("components/") || rel.startsWith("game/") || isClientFile(code);
}

describe("database import boundary", () => {
  it("recognizes database imports", () => {
    const component = join(srcDir, "components", "game", "X.tsx");
    expect(isDbImport("@/db", component)).toBe(true);
    expect(isDbImport("@/db/schema", component)).toBe(true);
    expect(isDbImport("../../db", component)).toBe(true);
    expect(isDbImport("../../db/schema", component)).toBe(true);
    expect(isDbImport("@/dbutils", component)).toBe(false);
    expect(isDbImport("./db", component)).toBe(false); // src/components/game/db
    expect(importSpecifiers(`import { getDb } from "@/db";\nconst m = await import('@/db/schema');`)).toEqual([
      "@/db",
      "@/db/schema",
    ]);
    expect(isClientFile(`// a comment\n"use client";\nimport x from "y";`)).toBe(true);
    expect(isClientFile(`import x from "y";\nconst s = "use client";`)).toBe(false);
  });

  it("no component, game-logic or \"use client\" file imports the database", () => {
    const offenders = sourceFiles(srcDir).flatMap((file) => {
      const code = readFileSync(file, "utf8");
      if (!isClientSide(file, code)) return [];
      return importSpecifiers(code)
        .filter((s) => isDbImport(s, file))
        .map((s) => `${relative(srcDir, file)} imports ${s}`);
    });
    expect(offenders).toEqual([]);
  });
});
