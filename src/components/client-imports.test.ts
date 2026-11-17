// Answers must never reach the browser (#54). Everything under
// src/components and every "use client" file ends up in the browser bundle,
// so none of them may import puzzle data or the server-side game (which
// handles full puzzles). Type-only imports are fine: they're erased.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const srcDir = fileURLToPath(new URL("..", import.meta.url));

const FORBIDDEN = [
  /^@\/puzzles(\/|$)/, // SAMPLE_PUZZLES and sample.json: answers
  /(^|\/)puzzles\/sample\.json$/,
  /^@\/game\/server-game$/, // full puzzles, the round engine and scoring
  /^@\/game\/round$/, // the round engine: checks guesses against answers
  /^@\/game\/guess$/,
  /^@\/server(\/|$)/,
  /^@\/db(\/|$)/,
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** Runtime imports only: `import type ...` and `export type ...` are skipped. */
function runtimeImports(code: string): string[] {
  const pattern = /^\s*(?:import|export)\s+(?!type\b)(?:[^"';]*?\sfrom\s*)?["']([^"']+)["']/gm;
  return [...code.matchAll(pattern)].map((m) => m[1]!);
}

/** "../../game/round" from a file in src/components/game → "@/game/round", so both spellings are checked. */
function normalize(specifier: string, fromFile: string): string {
  if (!specifier.startsWith(".")) return specifier;
  const target = relative(srcDir, resolve(fromFile, "..", specifier)).replace(/\.(ts|tsx|json)$/, (ext) => (ext === ".json" ? ext : ""));
  return `@/${target}`;
}

function isClientFile(file: string, code: string): boolean {
  const withoutComments = code.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "").trimStart();
  return relative(srcDir, file).startsWith("components/") || /^["']use client["']/.test(withoutComments);
}

describe("client bundle", () => {
  it("finds runtime imports and skips type-only ones", () => {
    const code = [
      `import type { Puzzle } from "@/game/types";`,
      `import { SAMPLE_PUZZLES } from "@/puzzles";`,
      `import "./side-effect";`,
      `export { x } from "@/game/round";`,
      `export type { Round } from "@/game/round";`,
    ].join("\n");
    expect(runtimeImports(code)).toEqual(["@/puzzles", "./side-effect", "@/game/round"]);
    const file = join(srcDir, "components", "game", "X.tsx");
    expect(normalize("../../game/round", file)).toBe("@/game/round");
    expect(normalize("../../puzzles/sample.json", file)).toBe("@/puzzles/sample.json");
    expect(normalize("@/game/types", file)).toBe("@/game/types");
  });

  it("no component or \"use client\" file imports puzzle data or the server-side game", () => {
    const offenders = sourceFiles(srcDir).flatMap((file) => {
      const code = readFileSync(file, "utf8");
      if (!isClientFile(file, code)) return [];
      return runtimeImports(code)
        .map((s) => normalize(s, file))
        .filter((s) => FORBIDDEN.some((f) => f.test(s)))
        .map((s) => `${relative(srcDir, file)} imports ${s}`);
    });
    expect(offenders).toEqual([]);
  });
});
