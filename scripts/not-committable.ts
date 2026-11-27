// One check for "would git commit this?", for scripts that write or read
// private content (daily, Stanford and lobby answers and photos never go in
// the public repo, #52). A path is fine if it's outside the repo, or inside
// it and git-ignored (like content/). Symlinks are resolved first, so content/
// linked to another drive counts as outside, and only a real `..` step counts
// as outside, so a folder named `..photos` inside the repo is still checked
// (security audit L8, #95).
//
// The same rule as scripts/seed.ts and scripts/preview-levels.ts; #231 is
// about moving those onto this helper too.
//
// Runs directly in Node 24 (type stripping).

import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const REPO_ROOT = resolve(import.meta.dirname, "..");

/** `path` with symlinks resolved, even if it doesn't exist yet: resolves the nearest existing parent. */
function realPath(path: string): string {
  if (existsSync(path)) return realpathSync(path);
  const parent = dirname(path);
  return parent === path ? path : join(realPath(parent), basename(path));
}

/** Throws unless `path` is outside the repo at `root`, or git-ignored inside it. */
export function assertNotCommittable(path: string, root = REPO_ROOT): void {
  const rel = relative(realpathSync(root), realPath(resolve(path)));
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return;
  try {
    execFileSync("git", ["check-ignore", "-q", rel === "" ? "." : rel], { cwd: root, stdio: "pipe" });
  } catch (error) {
    if ((error as { status?: number }).status === 1) {
      throw new Error(`${rel || "."}: inside the repo and not git-ignored, so git could commit it. Use content/ or a folder outside the repo.`);
    }
    throw new Error(`${rel || "."}: couldn't ask git whether it's ignored: ${String((error as { stderr?: unknown }).stderr ?? error).trim()}`);
  }
}
