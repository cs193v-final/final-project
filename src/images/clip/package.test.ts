// CLIP's own install in tools/clip (#56) is pinned: exact versions, a lockfile
// that matches, and the same `sharp` as the app's.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const clip = read("../../../tools/clip/package.json");
const lock = read("../../../tools/clip/package-lock.json");
const app = read("../../../package.json");

describe("tools/clip/package.json", () => {
  it("pins every dependency to an exact version", () => {
    for (const [name, version] of Object.entries<string>(clip.dependencies)) expect(`${name}@${version}`).toMatch(/@\d+\.\d+\.\d+$/);
  });

  it("matches its lockfile", () => {
    expect(lock.packages[""].dependencies).toEqual(clip.dependencies);
    for (const [name, version] of Object.entries<string>(clip.dependencies)) {
      expect(lock.packages[`node_modules/${name}`].version).toBe(version);
    }
  });

  it("uses the app's sharp", () => {
    expect(clip.dependencies.sharp).toBe(app.devDependencies.sharp);
  });

  it("stays out of the app's install", () => {
    expect({ ...app.dependencies, ...app.devDependencies }).not.toHaveProperty("@huggingface/transformers");
  });

  it("runs on the app's Node", () => {
    expect(clip.engines.node).toBe(app.engines.node);
  });
});
