// Spec for the level preview command (#57), run the way people run it
// (`node scripts/preview-levels.ts`): it writes every level, and never writes
// inside the repo unless that folder is git-ignored.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import sample from "../src/puzzles/sample.json" with { type: "json" };

const root = resolve(import.meta.dirname, "..");
const puzzleId = sample[0]!.id;
const cleanup: string[] = [];

afterEach(() => {
  for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true });
});

function preview(...args: string[]) {
  const result = spawnSync(process.execPath, ["scripts/preview-levels.ts", "--puzzle", puzzleId, ...args], {
    cwd: root,
    encoding: "utf8",
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe("npm run images:preview", () => {
  it("writes every level to the folder given with --out, outside the repo", () => {
    const out = mkdtempSync(join(tmpdir(), "preview-test-"));
    cleanup.push(out);
    const { status, output } = preview("--out", out);
    expect(status, output).toBe(0);
    expect(readdirSync(out).filter((f) => f.endsWith(".webp")).length).toBeGreaterThan(1);
  });

  it("refuses a folder inside the repo that isn't git-ignored, writing nothing", () => {
    const out = join(root, "preview-test-not-ignored");
    cleanup.push(out);
    const { status, output } = preview("--out", out);
    expect(status).not.toBe(0);
    expect(output).toMatch(/inside the repo and not git-ignored/);
    expect(existsSync(out)).toBe(false);
  });

  it("treats a folder inside the repo whose name starts with .. as inside (security audit L8)", () => {
    const out = join(root, "..preview-test");
    cleanup.push(out);
    const { status, output } = preview("--out", out);
    expect(status).not.toBe(0);
    expect(output).toMatch(/inside the repo and not git-ignored/);
    expect(existsSync(out)).toBe(false);
  });

  it("follows symlinks: a link in the repo to a folder outside it counts as outside", () => {
    const target = mkdtempSync(join(tmpdir(), "preview-target-"));
    const link = join(root, "content", "preview-test-link");
    cleanup.push(link, target);
    // content/ is git-ignored, so the link itself is never committed.
    mkdirSync(join(root, "content"), { recursive: true });
    symlinkSync(target, link);
    const { status, output } = preview("--out", join(link, "levels"));
    expect(status, output).toBe(0);
    expect(readdirSync(join(target, "levels")).length).toBeGreaterThan(1);
  });
});
