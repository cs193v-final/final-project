// Spec for the image picker's review step (#180): what a reviewer can decide
// about a candidate, and how approved candidates become a content file that
// the seed script accepts.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { combineContent, parseContent } from "../game/packs.ts";
import type { Candidate } from "./openverse.ts";
import {
  exportPack,
  parseExportRequest,
  parsePackDraft,
  parseReview,
  readExportedPack,
  readPackDraft,
  readReviews,
  reviewedCandidates,
  savePackDraft,
  saveReview,
} from "./review.ts";

import sharp from "sharp";

/** A small real JPEG carrying EXIF (a camera model), as downloaded photos do. */
const PHOTO = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#c33" } })
  .withExif({ IFD0: { Model: "Test camera" } })
  .jpeg()
  .toBuffer();

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const candidate = (id: string, answer: string): Candidate => ({
  id,
  file: `${id}.jpg`,
  answer,
  width: 4000,
  height: 3000,
  credit: { source: "Jane Doe, via Wikimedia Commons", license: "CC BY-SA 4.0, cropped", url: "https://commons.example/x" },
  openverseId: `ov-${id}`,
  title: "Some title",
});

/** content/ with candidates/<theme>/ holding two candidates and their (fake) photos. */
function setup() {
  const content = mkdtempSync(join(tmpdir(), "review-test-"));
  dirs.push(content);
  const themeDir = join(content, "candidates", "red-things");
  mkdirSync(themeDir, { recursive: true });
  const list = [candidate("pz-0000aaaa", "red thing"), candidate("pz-0000bbbb", "crimson thing")];
  writeFileSync(join(themeDir, "candidates.json"), JSON.stringify(list));
  for (const c of list) writeFileSync(join(themeDir, c.file), PHOTO);
  return { content, themeDir };
}

describe("parseReview", () => {
  it("accepts a full approval", () => {
    expect(
      parseReview({ status: "approved", effect: "swirl", focus: { x: 0.2, y: 0.8 }, answer: "Red thing", acceptedAnswers: ["red things"], note: "nice" }),
    ).toEqual({ status: "approved", effect: "swirl", focus: { x: 0.2, y: 0.8 }, answer: "Red thing", acceptedAnswers: ["red things"], note: "nice" });
  });

  it("needs an effect before approving, but not before rejecting", () => {
    expect(() => parseReview({ status: "approved" })).toThrow(/pick an effect/);
    expect(parseReview({ status: "rejected" })).toEqual({ status: "rejected" });
  });

  it.each([
    [{ status: "maybe" }, /status/],
    [{ status: "pending", effect: "blur" }, /effect must be one of/],
    [{ status: "pending", focus: { x: 1.5, y: 0 } }, /focus/],
    [{ status: "pending", answer: "x".repeat(201) }, /answer/],
    [{ status: "pending", acceptedAnswers: "red" }, /acceptedAnswers/],
    ["approved", /object/],
  ])("rejects %j", (value, message) => {
    expect(() => parseReview(value)).toThrow(message);
  });
});

describe("saving reviews", () => {
  it("saves decisions per candidate and reads them back, with pending as the default", () => {
    const { themeDir } = setup();
    saveReview(themeDir, "pz-0000aaaa", { status: "approved", effect: "pixelate" });
    expect(readReviews(themeDir)).toEqual({ "pz-0000aaaa": { status: "approved", effect: "pixelate" } });
    expect(reviewedCandidates(themeDir).map((c) => c.review.status)).toEqual(["approved", "pending"]);
  });

  it("refuses a candidate that isn't in the theme", () => {
    const { themeDir } = setup();
    expect(() => saveReview(themeDir, "pz-ffffffff", { status: "rejected" })).toThrow(/no candidate/);
  });
});

describe("exportPack", () => {
  const request = { title: "Red things", theme: "Red things", kind: "daily" as const, puzzleIds: ["pz-0000bbbb", "pz-0000aaaa"] };

  it("writes a content file the seed script accepts, with the photos next to it", async () => {
    const { content, themeDir } = setup();
    saveReview(themeDir, "pz-0000aaaa", { status: "approved", effect: "zoom", focus: { x: 0.3, y: 0.7 } });
    saveReview(themeDir, "pz-0000bbbb", { status: "approved", effect: "tiles", answer: "Crimson thing", acceptedAnswers: ["crimson"] });

    const result = await exportPack(content, themeDir, "red-things", { ...request, date: "2026-12-03" });

    const written = JSON.parse(readFileSync(join(content, "red-things.json"), "utf8"));
    const parsed = combineContent([{ source: "red-things.json", content: parseContent(written, "red-things.json") }]);
    expect(parsed.packs).toEqual([{ id: result.packId, kind: "daily", title: "Red things", theme: "Red things", puzzleIds: ["pz-0000bbbb", "pz-0000aaaa"] }]);
    expect(parsed.schedule).toEqual([{ date: "2026-12-03", packId: result.packId }]);
    const [crimson, red] = parsed.puzzles;
    expect(crimson).toMatchObject({ answer: "Crimson thing", acceptedAnswers: ["crimson"], effect: "tiles", reveal: { focus: { x: 0.5, y: 0.5 } } });
    expect(red).toMatchObject({ answer: "red thing", effect: "zoom", reveal: { focus: { x: 0.3, y: 0.7 } }, credit: { license: "CC BY-SA 4.0, cropped" } });
    for (const p of parsed.puzzles) {
      expect(p.imageUrl).toBe(`photos/${result.packId}/${p.id}.jpg`);
      expect(existsSync(join(content, p.imageUrl))).toBe(true);
      expect((await sharp(join(content, p.imageUrl)).metadata()).exif).toBeUndefined(); // metadata stripped…
    }
    expect((await sharp(PHOTO).metadata()).exif).toBeDefined(); // …from photos that had it
    expect(result.packId).toMatch(/^pk_[0-9a-f]{16}$/u);
  });

  it("keeps the pack id when the same theme is exported again", async () => {
    const { content, themeDir } = setup();
    saveReview(themeDir, "pz-0000aaaa", { status: "approved", effect: "zoom" });
    saveReview(themeDir, "pz-0000bbbb", { status: "approved", effect: "tiles" });
    const first = await exportPack(content, themeDir, "red-things", request);
    const second = await exportPack(content, themeDir, "red-things", { ...request, puzzleIds: ["pz-0000aaaa"] });
    expect(second.packId).toBe(first.packId);
  });

  it("refuses photos that aren't approved, and writes nothing", async () => {
    const { content, themeDir } = setup();
    saveReview(themeDir, "pz-0000aaaa", { status: "approved", effect: "zoom" });
    await expect(exportPack(content, themeDir, "red-things", request)).rejects.toThrow(/pz-0000bbbb isn't approved/);
    expect(existsSync(join(content, "red-things.json"))).toBe(false);
  });

  it("refuses an export whose answer would leak through an id, like the seed script", async () => {
    const { content, themeDir } = setup();
    writeFileSync(join(themeDir, "candidates.json"), JSON.stringify([candidate("pz-0000aaaa", "aaaa")]));
    saveReview(themeDir, "pz-0000aaaa", { status: "approved", effect: "zoom" });
    await expect(exportPack(content, themeDir, "red-things", { ...request, puzzleIds: ["pz-0000aaaa"] })).rejects.toThrow(/aaaa/);
  });
});

describe("parseExportRequest", () => {
  it("needs a title, theme, daily or stanford, and 1 to 20 photos", () => {
    expect(() => parseExportRequest({ title: "T", theme: "T", kind: "practice", puzzleIds: ["a"] })).toThrow(/kind/);
    expect(() => parseExportRequest({ title: "T", theme: "T", kind: "daily", puzzleIds: [] })).toThrow(/1 to 20/);
    expect(() => parseExportRequest({ title: "", theme: "T", kind: "daily", puzzleIds: ["a"] })).toThrow(/title/);
    expect(parseExportRequest({ title: "T", theme: "T", kind: "stanford", puzzleIds: ["a"], date: "" })).toEqual({
      title: "T",
      theme: "T",
      kind: "stanford",
      puzzleIds: ["a"],
    });
  });
});

describe("the pack being built (pack.json)", () => {
  it("keeps the fields it knows, dropping blanks and anything malformed", () => {
    expect(parsePackDraft({ title: " Fruit ", theme: "", kind: "lobby", date: "Dec 3", puzzleIds: ["pz-0000aaaa"], extra: 1 })).toEqual({
      title: "Fruit",
      puzzleIds: ["pz-0000aaaa"],
    });
    expect(parsePackDraft({ kind: "stanford", date: "2026-12-03" })).toEqual({ kind: "stanford", date: "2026-12-03" });
    expect(() => parsePackDraft([])).toThrow(/object/);
    expect(() => parsePackDraft({ title: "x".repeat(201) })).toThrow(/title/);
  });

  it("is saved per theme and read back", () => {
    const { themeDir } = setup();
    expect(readPackDraft(themeDir, null)).toEqual({});
    savePackDraft(themeDir, { title: "Red things", puzzleIds: ["pz-0000bbbb", "pz-0000aaaa"] });
    expect(readPackDraft(themeDir, null)).toEqual({ title: "Red things", puzzleIds: ["pz-0000bbbb", "pz-0000aaaa"] });
  });

  it("starts from what was exported when there's no draft yet, and becomes the export after one", async () => {
    const { content, themeDir } = setup();
    saveReview(themeDir, "pz-0000aaaa", { status: "approved", effect: "zoom" });
    saveReview(themeDir, "pz-0000bbbb", { status: "approved", effect: "tiles" });
    const request = { title: "Red things", theme: "Reds", kind: "daily" as const, puzzleIds: ["pz-0000bbbb", "pz-0000aaaa"], date: "2026-12-03" };
    const { packId } = await exportPack(content, themeDir, "red-things", request);

    const exported = readExportedPack(content, "red-things");
    expect(exported).toEqual({ ...request, packId });
    expect(readPackDraft(themeDir, exported)).toEqual(request); // export saved the draft too
    rmSync(join(themeDir, "pack.json"));
    expect(readPackDraft(themeDir, exported)).toEqual(request); // an older export, from before drafts
  });

  it("reports no export for a theme that hasn't been exported, or a file it can't read", () => {
    const { content } = setup();
    expect(readExportedPack(content, "red-things")).toBeNull();
    writeFileSync(join(content, "red-things.json"), "not json");
    expect(readExportedPack(content, "red-things")).toBeNull();
    expect(readExportedPack(content, "../etc")).toBeNull();
  });
});

