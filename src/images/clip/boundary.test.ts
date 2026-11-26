// CLIP is for scripts only (#56): the app must never import it. It would pull
// onnxruntime and the model into a server bundle, and it isn't even installed
// with the app (its install is in tools/clip). This also covers the packages
// themselves, and src/images/cut.ts's `sharp`, which is scripts-only too.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const srcDir = fileURLToPath(new URL("../..", import.meta.url));
const imagesDir = join(srcDir, "images");

function appFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return path === imagesDir || entry.name === "node_modules" ? [] : appFiles(path);
    return /\.(ts|tsx|js|jsx|mjs)$/.test(entry.name) && !/\.test\.[jt]sx?$/.test(entry.name) ? [path] : [];
  });
}

/** `import ... from "x"`, `export ... from "x"`, `import "x"`, `import("x")`, `require("x")`. */
function importSpecifiers(code: string): string[] {
  const pattern = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"']+)["']/g;
  return [...code.matchAll(pattern)].map((m) => m[1]!);
}

const SCRIPT_ONLY_PACKAGES = ["@huggingface/transformers", "onnxruntime-node", "onnxruntime-web", "sharp"];

/** True for src/images (CLIP and the cutter), by alias or relative path, and for their packages. */
function isScriptOnly(specifier: string, fromFile: string): boolean {
  if (SCRIPT_ONLY_PACKAGES.some((p) => specifier === p || specifier.startsWith(`${p}/`))) return true;
  if (specifier === "@/images" || specifier.startsWith("@/images/")) return true;
  if (!specifier.startsWith(".")) return false;
  const target = resolve(fromFile, "..", specifier);
  return target === imagesDir || target.startsWith(imagesDir + "/");
}

describe("scripts-only boundary", () => {
  it("recognizes imports of src/images and its packages", () => {
    const page = join(srcDir, "app", "daily", "page.tsx");
    expect(isScriptOnly("@/images/clip/analyze", page)).toBe(true);
    expect(isScriptOnly("../../images/clip/model.ts", page)).toBe(true);
    expect(isScriptOnly("@huggingface/transformers", page)).toBe(true);
    expect(isScriptOnly("sharp", page)).toBe(true);
    expect(isScriptOnly("@/imagesx", page)).toBe(false);
    expect(isScriptOnly("./images", page)).toBe(false); // src/app/daily/images
    expect(isScriptOnly("@/game/levels", page)).toBe(false);
  });

  it("no app code (src/ outside src/images, tests aside) imports CLIP, the cutter or their packages", () => {
    const files = appFiles(srcDir);
    expect(files.some((f) => f.includes(`${join("src", "app")}`))).toBe(true); // it really looks at the app
    const offenders = files.flatMap((file) =>
      importSpecifiers(readFileSync(file, "utf8"))
        .filter((s) => isScriptOnly(s, file))
        .map((s) => `${relative(srcDir, file)} imports ${s}`),
    );
    expect(offenders).toEqual([]);
  });
});
