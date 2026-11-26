// Spec for CLIP's labels (#56): the pack's answers, plus a committed generic list.
import { describe, expect, it } from "vitest";

import { normalizeGuess } from "../../game/guess.ts";
import { GENERIC_LABELS } from "./generic-labels.ts";
import { buildLabels, prompts, PROMPT_TEMPLATES } from "./labels.ts";

describe("GENERIC_LABELS", () => {
  it("has hundreds of labels", () => {
    expect(GENERIC_LABELS.length).toBeGreaterThanOrEqual(500);
  });

  it("lists each label once, compared the way guesses are", () => {
    const keys = GENERIC_LABELS.map(normalizeGuess);
    const repeated = keys.filter((key, i) => keys.indexOf(key) !== i);
    expect(repeated).toEqual([]);
  });

  it("has no empty labels or stray spaces", () => {
    for (const label of GENERIC_LABELS) expect(label).toMatch(/^\S(.*\S)?$/);
  });

  it("has no category words, which would beat a specific answer without being right", () => {
    const categories = ["animal", "bird", "fish", "insect", "fruit", "vegetable", "food", "plant", "flower", "tree", "building", "landmark", "monument", "object", "thing", "vehicle", "place"];
    expect(GENERIC_LABELS.filter((label) => categories.includes(normalizeGuess(label)))).toEqual([]);
  });
});

describe("buildLabels", () => {
  it("puts the answers first, then the generic list", () => {
    expect(buildLabels(["Kiwi bird", "Tuatara"], ["grass", "sand"])).toEqual(["Kiwi bird", "Tuatara", "grass", "sand"]);
  });

  it("lists an answer that's also generic once, as the answer writes it", () => {
    expect(buildLabels(["Strawberry"], ["grass", "strawberry"])).toEqual(["Strawberry", "grass"]);
    expect(buildLabels(["Golden Gate Bridge", "golden  gate bridge"], [])).toEqual(["Golden Gate Bridge"]);
  });

  it("uses the committed list by default", () => {
    const labels = buildLabels(["Tuatara"]);
    expect(labels[0]).toBe("Tuatara");
    expect(labels).toHaveLength(GENERIC_LABELS.length + 1);
  });

  it("needs at least one answer", () => {
    expect(() => buildLabels([])).toThrow(RangeError);
    expect(() => buildLabels(["  "])).toThrow(RangeError);
  });

  it("skips blank answers", () => {
    expect(buildLabels(["", "Tuatara"], [])).toEqual(["Tuatara"]);
  });
});

describe("prompts", () => {
  it("writes the label into every template", () => {
    expect(prompts("giraffe")).toEqual(PROMPT_TEMPLATES.map((t) => t.replace("{}", "giraffe")));
    expect(prompts("giraffe", ["{}"])).toEqual(["giraffe"]);
  });
});
