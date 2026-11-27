import { describe, expect, it } from "vitest";
import { combineContent, findAnswerLeaks, parseContent, parsePack, type Content } from "./packs.ts";
import { PuzzleDataError } from "./puzzles.ts";
import type { Puzzle } from "./types.ts";

// Spec for #52: packs, the daily schedule, content files, and the rule that no
// id or image URL gives an answer away (#36).

function puzzle(id: string, answer: string, acceptedAnswers: string[] = [], imageUrl = `/img/${id}.jpg`): Puzzle {
  return {
    id,
    imageUrl,
    answer,
    acceptedAnswers,
    reveal: { focus: { x: 0.5, y: 0.5 }, zoomLevels: [8, 4, 2, 1] },
    credit: { source: "Someone", license: "CC0" },
    aiSolvedLevel: null,
  };
}

function pack(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: "pk-1", kind: "daily", title: "Fruit", theme: "Fruit", puzzleIds: ["pz-1", "pz-2"], ...overrides };
}

const PUZZLES = [puzzle("pz-1", "Strawberry"), puzzle("pz-2", "Pineapple")];

function errorOf(fn: () => unknown): { path: string; message: string } {
  try {
    fn();
  } catch (error) {
    if (error instanceof PuzzleDataError) return { path: error.path, message: error.message };
    throw error;
  }
  throw new Error("expected a PuzzleDataError");
}

const one = (content: Partial<Content>, source = "a.json") => [
  { source, content: { packs: [], puzzles: [], schedule: [], ...content } },
];

describe("parsePack", () => {
  it("accepts a valid pack", () => {
    expect(parsePack(pack())).toEqual(pack());
  });

  it.each(["practice", "daily", "stanford", "lobby"])("accepts kind %s", (kind) => {
    expect(parsePack(pack({ kind })).kind).toBe(kind);
  });

  it.each([
    ["kind", "weekly", "pack.kind"],
    ["title", "", "pack.title"],
    ["theme", undefined, "pack.theme"],
    ["id", "Fruit Pack", "pack.id"],
    ["puzzleIds", [], "pack.puzzleIds"],
    ["puzzleIds", "pz-1", "pack.puzzleIds"],
    ["puzzleIds", ["pz-1", "PZ 2"], "pack.puzzleIds[1]"],
    ["puzzleIds", ["pz-1", "pz-1"], "pack.puzzleIds[1]"],
  ])("rejects a bad %s (%j)", (field, value, path) => {
    expect(errorOf(() => parsePack(pack({ [field]: value }))).path).toBe(path);
  });

  it("refuses per-pack scoring until #64 stores it", () => {
    expect(errorOf(() => parsePack(pack({ scoring: {} }))).path).toBe("pack.scoring");
  });

  it("drops unknown fields", () => {
    expect(parsePack(pack({ extra: 1 }))).not.toHaveProperty("extra");
  });
});

describe("parseContent", () => {
  it("reads packs, puzzles and a schedule; every list is optional", () => {
    const content = parseContent({ packs: [pack()], schedule: [{ date: "2026-11-20", packId: "pk-1" }] });
    expect(content.packs).toHaveLength(1);
    expect(content.puzzles).toEqual([]);
    expect(content.schedule).toEqual([{ date: "2026-11-20", packId: "pk-1" }]);
  });

  it("starts error paths with the source, so you know which file is wrong", () => {
    expect(errorOf(() => parseContent({ packs: [pack(), pack({ title: "" })] }, "fruit.json")).path).toBe(
      "fruit.json: packs[1].title",
    );
  });

  it("rejects a file with nothing in it", () => {
    expect(errorOf(() => parseContent({}, "empty.json")).path).toBe("empty.json");
  });

  it.each(["2026-2-30", "2026-02-30", "2026-13-01", "20261120", "tomorrow"])("rejects the date %j", (date) => {
    expect(errorOf(() => parseContent({ schedule: [{ date, packId: "pk-1" }] })).path).toBe(
      "content: schedule[0].date",
    );
  });

  it("accepts a leap day", () => {
    expect(parseContent({ schedule: [{ date: "2028-02-29", packId: "pk-1" }] }).schedule[0]!.date).toBe("2028-02-29");
  });
});

describe("combineContent", () => {
  const packs = [parsePack(pack())];

  it("joins files and checks them as a whole", () => {
    const combined = combineContent([
      { source: "puzzles.json", content: { packs: [], puzzles: PUZZLES, schedule: [] } },
      { source: "packs.json", content: { packs, puzzles: [], schedule: [{ date: "2026-11-20", packId: "pk-1" }] } },
    ]);
    expect(combined.puzzles.map((p) => p.id)).toEqual(["pz-1", "pz-2"]);
    expect(combined.packs.map((p) => p.id)).toEqual(["pk-1"]);
    expect(combined.schedule).toHaveLength(1);
  });

  it("rejects a pack that lists a puzzle nobody defined", () => {
    expect(errorOf(() => combineContent(one({ packs, puzzles: [PUZZLES[0]!] }))).path).toBe(
      "a.json: packs[0].puzzleIds[1]",
    );
  });

  it("rejects the same puzzle id in two files, and says where the first one is", () => {
    const { path, message } = errorOf(() =>
      combineContent([...one({ puzzles: PUZZLES }, "a.json"), ...one({ puzzles: [PUZZLES[1]!] }, "b.json")]),
    );
    expect(path).toBe("b.json: puzzles[0].id");
    expect(message).toContain("a.json: puzzles[1].id");
  });

  it("rejects the same pack id twice, and two packs on one day", () => {
    expect(errorOf(() => combineContent(one({ packs: [...packs, ...packs], puzzles: PUZZLES }))).path).toBe(
      "a.json: packs[1].id",
    );
    const twoOnOneDay = [
      { date: "2026-11-20", packId: "pk-1" },
      { date: "2026-11-20", packId: "pk-1" },
    ];
    expect(errorOf(() => combineContent(one({ packs, puzzles: PUZZLES, schedule: twoOnOneDay }))).path).toBe(
      "a.json: schedule[1].date",
    );
  });

  it("only schedules daily packs, each on one day", () => {
    const practice = [parsePack(pack({ kind: "practice" }))];
    expect(
      errorOf(() => combineContent(one({ packs: practice, puzzles: PUZZLES, schedule: [{ date: "2026-11-20", packId: "pk-1" }] })))
        .message,
    ).toContain("practice pack, not daily");

    const twice = [
      { date: "2026-11-20", packId: "pk-1" },
      { date: "2026-11-21", packId: "pk-1" },
    ];
    expect(errorOf(() => combineContent(one({ packs, puzzles: PUZZLES, schedule: twice }))).message).toContain(
      "already scheduled on 2026-11-20",
    );
  });

  it("accepts one Stanford pack, unscheduled, but not two in one seed: Stanford mode plays one fixed pack (#65)", () => {
    const first = parsePack(pack({ id: "pk-s1", kind: "stanford" }));
    expect(combineContent(one({ packs: [first], puzzles: PUZZLES })).packs).toEqual([first]);

    const second = parsePack(pack({ id: "pk-s2", kind: "stanford" }));
    const twoFiles = [...one({ packs: [first], puzzles: PUZZLES }), ...one({ packs: [second] }, "b.json")];
    expect(errorOf(() => combineContent(twoFiles))).toEqual({
      path: "pack pk-s2: kind",
      message: 'pack pk-s2: kind: only one stanford pack can be seeded at a time (also "pk-s1")',
    });
  });

  it("rejects a schedule entry for a pack that doesn't exist", () => {
    expect(errorOf(() => combineContent(one({ schedule: [{ date: "2026-11-20", packId: "pk-9" }] }))).path).toBe(
      "a.json: schedule[0].packId",
    );
  });

  it("rejects content whose ids or image URLs give an answer away", () => {
    const leaky = [puzzle("pz-1", "Strawberry", [], "/img/strawberry.jpg")];
    expect(errorOf(() => combineContent(one({ puzzles: leaky }))).path).toBe("puzzle pz-1: imageUrl");
  });
});

describe("findAnswerLeaks", () => {
  const leaksFor = (p: Puzzle, packId?: string) =>
    findAnswerLeaks({ puzzles: [p], packs: packId ? [parsePack(pack({ id: packId, puzzleIds: [p.id] }))] : [] });

  it("finds nothing in opaque ids and file names", () => {
    expect(leaksFor(puzzle("pz-7c1e9a40", "Golden Gate Bridge", ["Golden Gate"], "/puzzles/pz-7c1e9a40.jpg"), "pk_3f9c2a")).toEqual(
      [],
    );
  });

  it.each([
    ["the whole answer in the id", puzzle("golden-gate-bridge", "Golden Gate Bridge", [], "/img/1.jpg")],
    ["one long word of the answer", puzzle("pz-1", "Golden Gate Bridge", [], "/img/bridge-01.jpg")],
    ["an accepted answer", puzzle("pz-1", "Pineapple", ["Ananas"], "/img/ananas.png")],
    ["the singular of a plural answer", puzzle("pz-1", "Giraffes", [], "/img/giraffe.jpg")],
    ["a different case and accents", puzzle("pz-1", "Café", [], "https://cdn.example.com/CAFE_2.jpg")],
    ["a short answer as its own word", puzzle("ox-1", "Ox", [], "/img/1.jpg")],
    ["a short word of a longer answer", puzzle("pz-1", "Big Ben", [], "/img/ben-01.jpg")],
    ["another short word", puzzle("pz-1", "Taj Mahal", [], "/img/taj_2.jpg")],
    ["the -y singular of an -ies plural", puzzle("pz-1", "Cherries", [], "/img/cherry.jpg")],
    ["a URL-encoded answer", puzzle("pz-1", "Giraffe", [], "/img/%67iraffe.jpg")],
    ["the singular of an -es plural", puzzle("pz-1", "Tomatoes", [], "/img/tomato.jpg")],
    ["another -es plural", puzzle("pz-1", "Peaches", [], "/img/peach.jpg")],
    ["the plural of a singular answer", puzzle("pz-1", "Cherry", [], "/img/cherries.jpg")],
    ["a short word next to digits", puzzle("pz-1", "Big Ben", [], "/img/ben1.jpg")],
    // The audit's misses (#109):
    ["a short answer's -s plural", puzzle("pz-1", "Cat", [], "/img/cats.jpg")],
    ["a short answer's -es plural", puzzle("pz-1", "Fox", [], "/img/foxes-01.jpg")],
    ["a short answer's -en plural", puzzle("pz-1", "Ox", [], "/img/oxen.jpg")],
    ["an irregular plural", puzzle("pz-1", "Mouse", [], "/img/mice.jpg")],
    ["an irregular singular", puzzle("pz-1", "Geese", [], "/img/goose-2.jpg")],
    ["the initials of a three-word answer", puzzle("pz-1", "Golden Gate Bridge", [], "/img/GGB.jpg")],
  ])("finds %s", (_name, p) => {
    expect(leaksFor(p)).toHaveLength(1);
  });

  it("doesn't flag a short answer inside a longer word", () => {
    expect(leaksFor(puzzle("pz-box", "Ox"))).toEqual([]);
    expect(leaksFor(puzzle("pz-1", "Big Ben", [], "/img/bench-1.jpg"))).toEqual([]);
  });

  it("doesn't flag two-word initials, which would match every opaque id", () => {
    expect(leaksFor(puzzle("pz-7c1e9a40", "Pine Zest", [], "/img/pz-7c1e9a40.jpg"), "pk_3f9c2a")).toEqual([]);
    expect(leaksFor(puzzle("pz-1", "Big Ben", [], "/img/bb-1.jpg"))).toEqual([]);
  });

  it("doesn't flag filler words like \"the\"", () => {
    expect(leaksFor(puzzle("pz-1", "The Shard", [], "/the/pz-1.jpg"))).toEqual([]);
  });

  it("checks a name with a stray % as written", () => {
    expect(leaksFor(puzzle("pz-1", "Giraffe", [], "/img/100%giraffe.jpg"))).toHaveLength(1);
  });

  it("checks pack ids against the pack's own puzzles", () => {
    expect(leaksFor(puzzle("pz-1", "Strawberry"), "strawberry-pack")).toEqual([
      expect.objectContaining({ path: "pack strawberry-pack: id" }),
    ]);
  });

  it("explains which answer leaked", () => {
    const [leak] = leaksFor(puzzle("pz-1", "Golden Gate Bridge", [], "/img/bridge.jpg"));
    expect(leak!.problem).toBe('"/img/bridge.jpg" gives away the answer "Golden Gate Bridge" (contains "bridge")');
  });
});
