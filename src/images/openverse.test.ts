// Spec for the image picker's first step (#179): which Openverse results are
// kept, how they're credited and named, and how the downloader behaves.
// All HTTP is mocked; no test touches the network.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  creditFor,
  fetchWithBackoff,
  findCandidates,
  licenseLabel,
  newPuzzleId,
  readCandidates,
  searchUrl,
  skipReason,
  themeSlug,
  USER_AGENT,
  type Fetch,
  type FindOptions,
  type OpenverseImage,
} from "./openverse.ts";

const photo = (extra: Partial<OpenverseImage> = {}): OpenverseImage => ({
  id: "ov-1",
  title: "A photo of the answer",
  url: "https://images.example.com/full/ov-1.jpg",
  foreign_landing_url: "https://photos.example.com/ov-1",
  creator: "Jane Doe",
  license: "by-sa",
  license_version: "4.0",
  provider: "flickr",
  source: "flickr",
  width: 4000,
  height: 3000,
  mature: false,
  unstable__sensitivity: [],
  ...extra,
});

describe("license filter", () => {
  it.each(["cc0", "pdm", "by", "by-sa"])("keeps %s", (license) => {
    expect(skipReason(photo({ license }), 3000)).toBeNull();
  });

  it.each(["by-nc", "by-nd", "by-nc-sa", "by-nc-nd", "sampling+", "nc-sampling+", "unknown", undefined, ""])(
    "drops %j (no NC, ND or unknown licenses: cropping is a change)",
    (license) => {
      expect(skipReason(photo({ license }), 3000)).toMatch(/isn't allowed/);
    },
  );

  it("asks Openverse for the allowed licenses, from Wikimedia Commons (full-size originals), never mature results", () => {
    const url = new URL(searchUrl("some answer", 2));
    expect(url.origin + url.pathname).toBe("https://api.openverse.org/v1/images/");
    expect(url.searchParams.get("q")).toBe("some answer");
    expect(url.searchParams.get("license")).toBe("cc0,pdm,by,by-sa");
    expect(url.searchParams.get("source")).toBe("wikimedia");
    expect(url.searchParams.get("mature")).toBe("false");
    expect(url.searchParams.get("page")).toBe("2");
  });
});

describe("other filters", () => {
  it("drops photos under the minimum width, or with no width", () => {
    expect(skipReason(photo({ width: 2999 }), 3000)).toMatch(/under 3000 px/);
    expect(skipReason(photo({ width: undefined }), 3000)).toMatch(/under 3000 px/);
    expect(skipReason(photo({ width: 3000 }), 3000)).toBeNull();
  });

  it("drops files that aren't JPEG photos (drawings and diagrams)", () => {
    expect(skipReason(photo({ filetype: "svg" }), 3000)).toMatch(/not a photo/);
    expect(skipReason(photo({ filetype: "png" }), 3000)).toMatch(/not a photo/);
    expect(skipReason(photo({ filetype: "JPG" }), 3000)).toBeNull();
  });

  it("drops mature or sensitive photos", () => {
    expect(skipReason(photo({ mature: true }), 3000)).toMatch(/mature/);
    expect(skipReason(photo({ unstable__sensitivity: ["user_reported_sensitive"] }), 3000)).toMatch(/sensitive/);
  });

  it("drops a CC BY or BY-SA photo with no creator to credit, but not a CC0 one", () => {
    expect(skipReason(photo({ license: "by", creator: "" }), 3000)).toMatch(/credited/);
    expect(skipReason(photo({ license: "by-sa", creator: undefined }), 3000)).toMatch(/credited/);
    expect(skipReason(photo({ license: "cc0", creator: undefined }), 3000)).toBeNull();
  });

  it("drops results with no image URL or no page to link to", () => {
    expect(skipReason(photo({ url: undefined }), 3000)).toMatch(/no id or image URL/);
    expect(skipReason(photo({ foreign_landing_url: "" }), 3000)).toMatch(/credited/);
  });
});

describe("credits", () => {
  it("marks CC BY and BY-SA photos as cropped, since the game shows crops", () => {
    expect(licenseLabel("by-sa", "4.0")).toBe("CC BY-SA 4.0, cropped");
    expect(licenseLabel("by", "2.0")).toBe("CC BY 2.0, cropped");
  });

  it("names public-domain licenses without 'cropped'", () => {
    expect(licenseLabel("cc0", "1.0")).toBe("CC0 1.0");
    expect(licenseLabel("pdm", "1.0")).toBe("Public Domain Mark 1.0");
    expect(licenseLabel("cc0", null)).toBe("CC0");
  });

  it("credits the creator and the site, and links the photo's page", () => {
    expect(creditFor(photo())).toEqual({
      source: "Jane Doe, via Flickr",
      license: "CC BY-SA 4.0, cropped",
      url: "https://photos.example.com/ov-1",
    });
    expect(creditFor(photo({ source: "wikimedia", license: "cc0", license_version: "1.0", creator: undefined }))).toEqual({
      source: "Wikimedia Commons",
      license: "CC0 1.0",
      url: "https://photos.example.com/ov-1",
    });
  });
});

describe("names", () => {
  it("names files with random pz- ids, like the content's", () => {
    const ids = new Set(Array.from({ length: 50 }, newPuzzleId));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^pz-[0-9a-f]{8}$/u);
  });

  it("turns a theme into a safe folder name", () => {
    expect(themeSlug("Things in a Kitchen!")).toBe("things-in-a-kitchen");
    expect(() => themeSlug("!!!")).toThrow(/--theme/);
  });
});

describe("fetchWithBackoff", () => {
  const response = (status: number, headers: Record<string, string> = {}) => new Response(status === 200 ? "{}" : "", { status, headers });

  it("sends the project's User-Agent", async () => {
    const fetchFn = vi.fn<Fetch>().mockResolvedValue(response(200));
    await fetchWithBackoff("https://x.example", fetchFn, vi.fn());
    expect(fetchFn).toHaveBeenCalledWith("https://x.example", { headers: { "User-Agent": USER_AGENT } });
    expect(USER_AGENT).not.toMatch(/@/u); // no personal email
  });

  it("waits and retries on 429, using Retry-After when given, else 2, 4, 8 s", async () => {
    const fetchFn = vi
      .fn<Fetch>()
      .mockResolvedValueOnce(response(429, { "retry-after": "7" }))
      .mockResolvedValueOnce(response(429))
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(200));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const result = await fetchWithBackoff("https://x.example", fetchFn, sleep);
    expect(result.status).toBe(200);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([7000, 4000, 8000]);
  });

  it("gives up after the retries and returns the last response", async () => {
    const fetchFn = vi.fn<Fetch>().mockResolvedValue(response(429));
    const sleep = vi.fn().mockResolvedValue(undefined);
    expect((await fetchWithBackoff("https://x.example", fetchFn, sleep, 2)).status).toBe(429);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("doesn't retry other errors", async () => {
    const fetchFn = vi.fn<Fetch>().mockResolvedValue(response(404));
    const sleep = vi.fn();
    expect((await fetchWithBackoff("https://x.example", fetchFn, sleep)).status).toBe(404);
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe("findCandidates", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const jpeg = (width: number, height: number) =>
    sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } } }).jpeg().toBuffer();

  /** A fake Openverse: search pages by answer, and image bytes by URL. */
  function fakeOpenverse(pages: Record<string, OpenverseImage[][]>, images: Record<string, Buffer>) {
    const calls: string[] = [];
    const fetchFn: Fetch = async (url) => {
      calls.push(url);
      if (url.startsWith("https://api.openverse.org/")) {
        const params = new URL(url).searchParams;
        const list = pages[params.get("q")!] ?? [];
        const page = Number(params.get("page"));
        return Response.json({ results: list[page - 1] ?? [], page_count: list.length });
      }
      const bytes = images[url];
      return bytes ? new Response(new Uint8Array(bytes), { status: 200 }) : new Response("", { status: 404 });
    };
    return { fetchFn, calls };
  }

  function options(fetchFn: Fetch, extra: Partial<FindOptions> = {}): FindOptions {
    const outDir = mkdtempSync(join(tmpdir(), "find-images-test-"));
    dirs.push(outDir);
    return { answers: ["red thing"], outDir, perAnswer: 2, minWidth: 3000, maxPages: 3, fetch: fetchFn, sleep: async () => {}, pauseMs: 0, log: () => {}, ...extra };
  }

  it("saves wide, allowed photos with random names and their credits, skipping the rest", async () => {
    const big = await jpeg(3200, 2000);
    const { fetchFn } = fakeOpenverse(
      {
        "red thing": [
          [
            photo({ id: "a", url: "https://img.example/a.jpg", title: "Red thing on a table" }),
            photo({ id: "nc", url: "https://img.example/nc.jpg", license: "by-nc" }),
            photo({ id: "small", url: "https://img.example/small.jpg", width: 1200 }),
          ],
          [photo({ id: "b", url: "https://img.example/b.jpg", license: "cc0", license_version: "1.0" })],
        ],
      },
      { "https://img.example/a.jpg": big, "https://img.example/b.jpg": big },
    );
    const opts = options(fetchFn);
    const { saved, skipped } = await findCandidates(opts);

    expect(saved.map((c) => c.openverseId)).toEqual(["a", "b"]);
    expect(skipped).toBe(2);
    const files = readdirSync(opts.outDir).filter((f) => f !== "candidates.json").sort();
    expect(files).toEqual(saved.map((c) => c.file).sort());
    for (const file of files) {
      expect(file).toMatch(/^pz-[0-9a-f]{8}\.jpg$/u);
      expect(file).not.toMatch(/red|thing|table/iu);
    }
    const list = readCandidates(opts.outDir);
    expect(list[0]).toMatchObject({ answer: "red thing", width: 3200, height: 2000, credit: { license: "CC BY-SA 4.0, cropped" } });
    expect(list[1]!.credit.license).toBe("CC0 1.0");
  });

  it("checks the real width after downloading, since Openverse's numbers can be wrong", async () => {
    const { fetchFn } = fakeOpenverse(
      { "red thing": [[photo({ id: "liar", url: "https://img.example/liar.jpg", width: 5000 })]] },
      { "https://img.example/liar.jpg": await jpeg(800, 600) },
    );
    const opts = options(fetchFn);
    const { saved, skipped } = await findCandidates(opts);
    expect(saved).toEqual([]);
    expect(skipped).toBe(1);
    expect(readdirSync(opts.outDir)).toEqual([]);
  });

  it("skips a download that isn't an image", async () => {
    const { fetchFn } = fakeOpenverse(
      { "red thing": [[photo({ id: "html", url: "https://img.example/page.html" })]] },
      { "https://img.example/page.html": Buffer.from("<html>not a photo</html>") },
    );
    expect((await findCandidates(options(fetchFn))).saved).toEqual([]);
  });

  it("adds to an earlier run without saving the same photo twice", async () => {
    const big = await jpeg(3200, 2000);
    const results = [[photo({ id: "a", url: "https://img.example/a.jpg" }), photo({ id: "b", url: "https://img.example/b.jpg" })]];
    const { fetchFn } = fakeOpenverse({ "red thing": results }, { "https://img.example/a.jpg": big, "https://img.example/b.jpg": big });
    const opts = options(fetchFn, { perAnswer: 1 });
    await findCandidates(opts);
    await findCandidates(opts);
    expect(readCandidates(opts.outDir).map((c) => c.openverseId)).toEqual(["a", "b"]);
  });

  it("makes one request at a time with a pause between them, and stops at --pages", async () => {
    const { fetchFn, calls } = fakeOpenverse({ "red thing": [[], [], [], [], []].map(() => [photo({ license: "by-nd" })]) }, {});
    const sleep = vi.fn().mockResolvedValue(undefined);
    await findCandidates(options(fetchFn, { sleep, pauseMs: 1500, maxPages: 3 }));
    expect(calls).toHaveLength(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1500, 1500]);
  });

  it("keeps the credits list valid JSON after every photo", async () => {
    const big = await jpeg(3200, 2000);
    const { fetchFn } = fakeOpenverse({ "red thing": [[photo({ id: "a", url: "https://img.example/a.jpg" })]] }, { "https://img.example/a.jpg": big });
    const opts = options(fetchFn);
    await findCandidates(opts);
    expect(() => JSON.parse(readFileSync(join(opts.outDir, "candidates.json"), "utf8"))).not.toThrow();
  });
});
