// Spec for the local review server (#180): it serves the page, the theme's
// candidates and previews, saves decisions, and refuses requests that could
// come from another web page (wrong Host or Origin) or reach outside content/.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, get, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createHandler } from "./review-images.ts";

let server: Server;
let base: string;
let port: number;
let content: string;

beforeAll(async () => {
  content = mkdtempSync(join(tmpdir(), "review-server-test-"));
  const themeDir = join(content, "candidates", "red-things");
  mkdirSync(themeDir, { recursive: true });
  const photo = await sharp({ create: { width: 2400, height: 1800, channels: 3, background: "#c33" } }).jpeg().toBuffer();
  writeFileSync(join(themeDir, "pz-0000aaaa.jpg"), photo);
  writeFileSync(
    join(themeDir, "candidates.json"),
    JSON.stringify([
      {
        id: "pz-0000aaaa",
        file: "pz-0000aaaa.jpg",
        answer: "red thing",
        width: 2400,
        height: 1800,
        credit: { source: "Jane Doe, via Wikimedia Commons", license: "CC0 1.0", url: "https://commons.example/x" },
        openverseId: "ov-a",
        title: "t",
      },
    ]),
  );
  // Listen on a free port first, then build the handler for that port (it checks Host).
  server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
  server.on("request", createHandler({ contentDir: content, port }));
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(content, { recursive: true, force: true });
});

const json = (body: unknown, origin = base) => ({
  headers: { "Content-Type": "application/json", Origin: origin },
  body: JSON.stringify(body),
});

describe("review server", () => {
  it("serves the page and lists themes with their counts", async () => {
    expect((await fetch(base)).headers.get("content-type")).toMatch(/text\/html/);
    expect(await (await fetch(`${base}/api/themes`)).json()).toEqual([{ slug: "red-things", total: 1, approved: 0, rejected: 0, pending: 1, exported: false }]);
  });

  it("serves a theme's candidates and a smaller preview of each photo", async () => {
    const { candidates } = await (await fetch(`${base}/api/red-things`)).json();
    expect(candidates[0]).toMatchObject({ id: "pz-0000aaaa", review: { status: "pending" } });
    const preview = Buffer.from(await (await fetch(`${base}/img/red-things/pz-0000aaaa.jpg`)).arrayBuffer());
    expect((await sharp(preview).metadata()).width).toBe(1600);
  });

  it("saves a decision", async () => {
    const res = await fetch(`${base}/api/red-things/pz-0000aaaa`, { method: "PUT", ...json({ status: "approved", effect: "swirl" }) });
    expect(res.status).toBe(200);
    const saved = JSON.parse(readFileSync(join(content, "candidates", "red-things", "review.json"), "utf8"));
    expect(saved).toEqual({ "pz-0000aaaa": { status: "approved", effect: "swirl" } });
  });

  it("saves the pack being built, and serves it with the theme", async () => {
    const draft = { title: "Red things", kind: "daily", puzzleIds: ["pz-0000aaaa"] };
    const res = await fetch(`${base}/api/red-things/pack`, { method: "PUT", ...json(draft) });
    expect(res.status).toBe(200);
    expect(await (await fetch(`${base}/api/red-things`)).json()).toMatchObject({ pack: draft, exported: null });
    const bad = await fetch(`${base}/api/red-things/pack`, { method: "PUT", ...json({ title: "x".repeat(300) }) });
    expect(bad.status).toBe(400);
  });

  it("explains a bad decision instead of saving it", async () => {
    const res = await fetch(`${base}/api/red-things/pz-0000aaaa`, { method: "PUT", ...json({ status: "approved" }) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/pick an effect/);
  });

  it("refuses another Host name (DNS rebinding)", async () => {
    // fetch() won't send a custom Host, so use node:http.
    const status = await new Promise<number | undefined>((resolve, reject) => {
      get({ host: "127.0.0.1", port, path: "/api/themes", headers: { Host: `evil.example:${port}` } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      }).on("error", reject);
    });
    expect(status).toBe(403);
  });

  it("refuses writes from another site's page", async () => {
    const res = await fetch(`${base}/api/red-things/pz-0000aaaa`, { method: "PUT", ...json({ status: "rejected" }, "https://evil.example") });
    expect(res.status).toBe(403);
  });

  it("serves the game's effects as browser JavaScript, with .js imports, and never their tests", async () => {
    const res = await fetch(`${base}/effects/index.js`);
    expect(res.headers.get("content-type")).toMatch(/text\/javascript/);
    const js = await res.text();
    expect(js).toContain("export function createEffect");
    expect(js).not.toMatch(/from\s+["']\.\/[a-z-]+\.ts["']/u);
    expect(js).toMatch(/from\s+["']\.\/pixelate\.js["']/u);
    for (const path of ["/effects/effects.test.js", "/effects/..%2Fpuzzles.js", "/effects/nope.js", "/effects/index.ts"]) {
      expect((await fetch(`${base}${path}`)).status, path).toBe(404);
    }
  });

  it("serves effects that draw exactly the frames the game's TypeScript draws", async () => {
    // Save every served module, import the served index.js, and compare a frame of each effect.
    const dir = mkdtempSync(join(tmpdir(), "served-effects-"));
    try {
      const names = readdirSync(join(import.meta.dirname, "../src/game/effects"))
        .filter((f) => f.endsWith(".ts") && !f.includes(".test."))
        .map((f) => f.slice(0, -3));
      for (const name of names) writeFileSync(join(dir, `${name}.js`), await (await fetch(`${base}/effects/${name}.js`)).text());
      const served = await import(pathToFileURL(join(dir, "index.js")).href);
      const original = await import("../src/game/effects/index.ts");
      const width = 40, height = 30;
      const data = new Uint8ClampedArray(width * height * 4).map((_, i) => (i * 37) % 251);
      const options = { focus: { x: 0.3, y: 0.6 }, seed: "pz-0000aaaa" };
      for (const effect of Object.keys(original.EFFECT_SETUPS)) {
        const a = original.createEffect(effect as never, { width, height, data }, options)(0.4);
        const b = served.createEffect(effect, { width, height, data }, options)(0.4);
        expect(Buffer.from(b).equals(Buffer.from(a)), effect).toBe(true);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses paths outside a theme folder, and file names that aren't candidates", async () => {
    for (const path of ["/api/..%2F..%2Fetc", "/img/red-things/..%2Fcandidates.json", "/img/red-things/candidates.json", "/api/RED"]) {
      expect((await fetch(`${base}${path}`)).status, path).toBe(404);
    }
  });
});
