// Server logs never carry a query's values (#60). A failed drizzle query's
// message is "Failed query: ... params: ...", and the Postgres error under it
// can quote a value, so handing a caught error straight to `console.*` would
// print an owner hash, a guess or a password hash into the Vercel logs.
// Errors are logged through `errorSummary` (src/server/error-summary.ts) or
// `errorForLog` (src/game/log-safe.ts). This scans src/ for a console call
// that passes a caught error as is.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const srcDir = fileURLToPath(new URL("..", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** The text of every `console.<level>(...)` call, up to its closing parenthesis. */
function consoleCalls(code: string): string[] {
  const calls: string[] = [];
  for (const match of code.matchAll(/\bconsole\.(?:error|warn|log|info|debug)\s*\(/g)) {
    let depth = 1;
    let i = match.index + match[0].length;
    for (; i < code.length && depth > 0; i++) {
      if (code[i] === "(") depth++;
      else if (code[i] === ")") depth--;
    }
    calls.push(code.slice(match.index, i));
  }
  return calls;
}

/** A call's own arguments, split at its top-level commas. */
function topLevelArgs(call: string): string[] {
  const inner = call.slice(call.indexOf("(") + 1, -1);
  const args: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]!;
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === "," && depth === 0) {
      args.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  args.push(inner.slice(start));
  return args.map((a) => a.trim());
}

const ERROR_NAME = String.raw`(?:error|err|e|cause)`;
const BARE = new RegExp(String.raw`^(?:${ERROR_NAME}|String\(\s*${ERROR_NAME}\s*\))$`);
const INTERPOLATED = new RegExp(String.raw`\$\{\s*${ERROR_NAME}\s*\}`);

/**
 * A caught error passed as is: an argument that is just `error`, `err`, `e`
 * or `cause` (or `String(error)`), or `${error}` in a template.
 */
function passesRawError(call: string): boolean {
  return INTERPOLATED.test(call) || topLevelArgs(call).some((arg) => BARE.test(arg));
}

describe("server log calls", () => {
  it("finds console calls that pass a caught error as is", () => {
    const code = [
      `console.error("Couldn't load", error);`,
      `console.warn(err);`,
      "console.error(`failed: ${error}`);",
      `console.error("x", String(e));`,
      "console.error(`failed: ${errorSummary(error)}`);",
      `console.error("game call failed:", JSON.stringify(error));`,
      `console.error(error.message);`,
      `console.warn("CRON_SECRET is not set");`,
    ].join("\n");
    expect(consoleCalls(code).filter(passesRawError)).toHaveLength(4);
    expect(consoleCalls(code)).toHaveLength(8);
  });

  it("no file in src/ logs a caught error as is", () => {
    const offenders = sourceFiles(srcDir).flatMap((file) =>
      consoleCalls(readFileSync(file, "utf8"))
        .filter(passesRawError)
        .map((call) => `${relative(srcDir, file)}: ${call.replace(/\s+/g, " ")}`),
    );
    expect(offenders).toEqual([]);
  });
});
