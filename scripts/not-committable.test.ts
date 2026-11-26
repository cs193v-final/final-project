// Spec for the shared "would git commit this?" check (#179, #231): private
// content (answers and photos) may only be written outside the repo or into a
// git-ignored folder like content/.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { assertNotCommittable, REPO_ROOT } from "./not-committable.ts";

const cleanup: string[] = [];
afterEach(() => {
  for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("assertNotCommittable", () => {
  it("allows a folder outside the repo", () => {
    const dir = mkdtempSync(join(tmpdir(), "committable-test-"));
    cleanup.push(dir);
    expect(() => assertNotCommittable(dir)).not.toThrow();
  });

  it("allows content/, which is git-ignored, even before it exists", () => {
    expect(() => assertNotCommittable(join(REPO_ROOT, "content", "candidates", "some-theme"))).not.toThrow();
  });

  it("refuses a folder in the repo that git would commit", () => {
    expect(() => assertNotCommittable(join(REPO_ROOT, "public", "candidates"))).toThrow(/not git-ignored/);
    expect(() => assertNotCommittable(REPO_ROOT)).toThrow(/not git-ignored/);
  });

  it("treats a folder named ..something inside the repo as inside (security audit L8)", () => {
    expect(() => assertNotCommittable(join(REPO_ROOT, "..photos"))).toThrow(/not git-ignored/);
  });

  it("follows symlinks: a link in the repo to a folder outside it is outside", () => {
    const outside = mkdtempSync(join(tmpdir(), "committable-target-"));
    const link = join(REPO_ROOT, "content", `link-test-${process.pid}`);
    mkdirSync(join(REPO_ROOT, "content"), { recursive: true });
    symlinkSync(outside, link);
    cleanup.push(link, outside);
    expect(() => assertNotCommittable(join(link, "theme"))).not.toThrow();
  });
});
