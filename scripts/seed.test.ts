// Spec for the seed command (#52), run the way people run it (`node
// scripts/seed.ts`), in --dry-run mode so no database is needed.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const cleanup: string[] = [];

afterEach(() => {
  for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true });
});

function run(args: string[], env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, ["scripts/seed.ts", ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL_UNPOOLED: "", ...env },
  });
  return { code: result.status, out: result.stdout + result.stderr };
}

const seed = (...args: string[]) => run(["--dry-run", ...args]);

/**
 * Write a content file. Unless `photos` is false, also put a stand-in original
 * photo at each puzzle's relative `imageUrl` next to it: the dry run checks
 * that every original exists (#57), but doesn't decode it.
 */
function writeContent(dir: string, name: string, data: unknown, { photos = true } = {}): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, JSON.stringify(data));
  cleanup.push(file);
  if (photos) {
    for (const { imageUrl } of (data as { puzzles?: { imageUrl: string }[] }).puzzles ?? []) {
      const photo = join(dir, imageUrl);
      mkdirSync(dirname(photo), { recursive: true });
      writeFileSync(photo, "not really a jpeg");
      cleanup.push(photo);
    }
  }
  return file;
}

const FRUIT = {
  puzzles: [
    {
      id: "pz-0a1b2c3d",
      imageUrl: "images/pz-0a1b2c3d.jpg",
      answer: "Strawberry",
      acceptedAnswers: [],
      reveal: { focus: { x: 0.5, y: 0.5 }, zoomLevels: [8, 4, 2, 1] },
      credit: { source: "Someone", license: "CC0" },
    },
  ],
  packs: [{ id: "pk-9f8e7d6c", kind: "daily", title: "Fruit", theme: "Fruit", puzzleIds: ["pz-0a1b2c3d"] }],
  schedule: [{ date: "2026-11-20", packId: "pk-9f8e7d6c" }],
};

const outside = () => {
  const dir = mkdtempSync(join(tmpdir(), "seed-test-"));
  cleanup.push(dir);
  return dir;
};

// Each test starts a real Node process, which can take several seconds when
// the whole suite runs in parallel.
describe("npm run db:seed -- --dry-run", { timeout: 30_000 }, () => {
  it("fails on a path that doesn't exist", () => {
    const { code, out } = seed(join(outside(), "missing.json"));
    expect(out).toContain("no such file or folder");
    expect(code).toBe(1);
  });

  it("checks content kept outside the repo, plus the practice pack, without a database", () => {
    const { code, out } = seed(writeContent(outside(), "fruit.json", FRUIT));
    expect(out).toContain("Checked 1 content file(s) plus the practice pack: 4 puzzles, 2 packs");
    expect(out).toContain("1 scheduled days");
    expect(out).toContain("Dry run: no database touched.");
    expect(code).toBe(0);
  });

  it("reads every .json file in a folder", () => {
    const dir = outside();
    writeContent(dir, "a.json", { puzzles: FRUIT.puzzles });
    writeContent(dir, "b.json", { packs: FRUIT.packs, schedule: FRUIT.schedule });
    writeContent(dir, "notes.txt", "not content");
    const { code, out } = seed(dir);
    expect(out).toContain("Checked 2 content file(s)");
    expect(code).toBe(0);
  });

  it("accepts content in the git-ignored content/ folder", () => {
    const { code } = seed(writeContent(join(root, "content"), `.seed-test-${process.pid}.json`, FRUIT));
    expect(code).toBe(0);
  });

  it("refuses private content anywhere in the repo that git would commit", () => {
    const { code, out } = seed(writeContent(join(root, "src/puzzles"), `seed-test-${process.pid}.json`, FRUIT));
    expect(out).toContain("private content can't live in the repo unless it's git-ignored");
    expect(code).toBe(1);
  });

  it("treats `npm run db:seed --dry-run` (no `--`, so npm takes the flag) as a dry run", () => {
    // A real seed would try this unreachable database and fail.
    const { code, out } = run([], { npm_config_dry_run: "true", DATABASE_URL_UNPOOLED: "postgresql://127.0.0.1:1/none" });
    expect(out).toContain("Dry run: no database touched.");
    expect(code).toBe(0);
  });

  it("follows a symlink, so content/ linked to a shared folder outside the repo is fine", () => {
    const shared = outside();
    writeContent(shared, "fruit.json", FRUIT);
    const link = join(root, "content", `.seed-test-link-${process.pid}`);
    mkdirSync(join(root, "content"), { recursive: true });
    symlinkSync(shared, link);
    cleanup.push(link);
    const { code, out } = seed(link);
    expect(out).toContain("Checked 1 content file(s)");
    expect(code).toBe(0);
  });

  it("names the file when it isn't valid JSON", () => {
    const file = join(outside(), "broken.json");
    writeFileSync(file, "{ not json");
    const { code, out } = seed(file);
    expect(out).toMatch(/broken\.json: not valid JSON/u);
    expect(code).toBe(1);
  });

  it("reads relative paths from where the command was typed (INIT_CWD), not the repo root", () => {
    const dir = outside();
    writeContent(dir, "fruit.json", FRUIT);
    const { code } = run(["--dry-run", "fruit.json"], { INIT_CWD: dir });
    expect(code).toBe(0);
  });

  it("names a puzzle whose original photo is missing, without a database", () => {
    const { code, out } = seed(writeContent(outside(), "fruit.json", FRUIT, { photos: false }));
    expect(out).toMatch(/puzzle pz-0a1b2c3d: no original image at .*images[/\\]pz-0a1b2c3d\.jpg/u);
    expect(out).not.toContain("Dry run: no database touched.");
    expect(code).toBe(1);
  });

  it("skips the photo check with --no-images", () => {
    const { code, out } = seed("--no-images", writeContent(outside(), "fruit.json", FRUIT, { photos: false }));
    expect(out).toContain("Dry run: no database touched.");
    expect(code).toBe(0);
  });

  it("refuses a private puzzle's photo that git would commit", () => {
    const dir = outside();
    // A tracked file in the repo, reached from content kept outside it.
    const tracked = relative(dir, join(root, "public/puzzles/pz-dbdb4dee.jpg"));
    const committable = { ...FRUIT, puzzles: [{ ...FRUIT.puzzles[0], imageUrl: tracked }] };
    const { code, out } = seed(writeContent(dir, "fruit.json", committable, { photos: false }));
    expect(out).toContain("private content can't live in the repo unless it's git-ignored");
    expect(code).toBe(1);
  });

  it("names the file and field when content is wrong", () => {
    const leaky = { ...FRUIT, puzzles: [{ ...FRUIT.puzzles[0], imageUrl: "/img/strawberry.jpg" }] };
    const { code, out } = seed(writeContent(outside(), "leaky.json", leaky));
    expect(out).toContain('puzzle pz-0a1b2c3d: imageUrl: "/img/strawberry.jpg" gives away the answer "Strawberry"');
    expect(code).toBe(1);
  });
});

describe("the seed script's database driver", async () => {
  const { driverFor } = await import("./seed-db.ts");

  it.each([
    "postgresql://postgres@localhost:5432/zoomout",
    "postgresql://postgres@127.0.0.1:54329/zoomout",
    "postgresql://postgres@127.0.0.2:5432/zoomout",
    "postgresql://postgres@[::1]:5432/zoomout",
  ])("uses node-postgres for a Postgres on this machine (%s)", (url) => {
    expect(driverFor(url)).toBe("pg");
  });

  it.each(["postgresql://ep-cool-name-123.us-east-2.aws.neon.tech/neondb", "postgresql://u@localhost.evil.example/db"])(
    "uses Neon's HTTP driver for any other host (%s)",
    (url) => {
      expect(driverFor(url)).toBe("neon");
    },
  );

  it("rejects a URL it can't read", () => {
    expect(() => driverFor("not a url")).toThrow("not a valid connection URL");
  });
});
