// Spec for `npm run images:find` (#179), run the way people run it. These
// cases stop before any network request.
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const cleanup: string[] = [];
afterEach(() => {
  for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true });
});

function find(...args: string[]) {
  const result = spawnSync(process.execPath, ["scripts/find-images.ts", ...args], { cwd: root, encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe("npm run images:find", () => {
  it("prints how to use it without --theme and --answers", () => {
    const { status, output } = find();
    expect(status).toBe(2);
    expect(output).toMatch(/Usage: npm run images:find -- --theme <theme> --answers/);
  });

  it("refuses an --out folder that git would commit, writing nothing", () => {
    const out = join(root, "public", "candidates-test");
    cleanup.push(out);
    const { status, output } = find("--theme", "test", "--answers", "x", "--out", out);
    expect(status).toBe(1);
    expect(output).toMatch(/not git-ignored/);
    expect(existsSync(out)).toBe(false);
  });

  it("rejects a bad number option", () => {
    const { status, output } = find("--theme", "test", "--answers", "x", "--per-answer", "0", "--out", join(root, "content", "x"));
    expect(status).toBe(1);
    expect(output).toMatch(/--per-answer must be a whole number/);
  });
});
