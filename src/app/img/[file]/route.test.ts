// Spec for GET /img/<id>.webp (#57): serves exactly the stored image with
// long-lived cache headers, and a 404 (never cached) for anything else.
// Runs the real route handler against PGlite with the real migrations.
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { saveLevelImages } from "@/db/images";
import * as schema from "@/db/schema";
import { cutLevels } from "@/images/cut";

let pg: PGlite;
let db: PgliteDatabase<typeof schema>;

// The route uses getDb(); point it at this test's database.
const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));
vi.mock("@/db", () => ({ getDb: getDbMock }));
const { GET } = await import("./route");

const migrationsFolder = fileURLToPath(new URL("../../../../drizzle", import.meta.url));

beforeEach(async () => {
  pg = new PGlite();
  db = drizzle({ client: pg, schema });
  getDbMock.mockReset().mockImplementation(() => db);
  await migrate(db, { migrationsFolder });
  await db.insert(schema.puzzles).values({
    id: "pz-0a1b2c3d",
    answer: "Lemon",
    imageUrl: "/originals/x.jpg",
    focusX: 0.25,
    focusY: 0.25,
    zoomLevels: [2, 1],
    creditSource: "Someone",
    creditLicense: "CC0",
  });
}, 60_000);

afterEach(async () => {
  await pg.close();
});

const get = (file: string) => GET(new Request(`http://localhost/img/${file}`), { params: Promise.resolve({ file }) });

async function storedLevels() {
  const photo = await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 200, g: 180, b: 20 } } })
    .jpeg()
    .toBuffer();
  return saveLevelImages(db, "pz-0a1b2c3d", await cutLevels(new Uint8Array(photo), { focus: { x: 0.25, y: 0.25 }, zoomLevels: [2, 1] }));
}

describe("GET /img/<id>.webp", () => {
  it("serves each level's cut image, end to end: cut, stored, fetched", async () => {
    const stored = await storedLevels();
    for (const { src, width, height } of stored) {
      const response = await get(src.replace("/img/", ""));
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("image/webp");
      const bytes = Buffer.from(await response.arrayBuffer());
      expect(response.headers.get("Content-Length")).toBe(String(bytes.byteLength));
      const meta = await sharp(bytes).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual(["webp", width, height]);
    }
  });

  it("lets browsers and the CDN cache an image for a year, since its URL never changes meaning", async () => {
    const [level] = await storedLevels();
    const response = await get(level!.src.replace("/img/", ""));
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
  });

  it("is a 404 that isn't cached for an id that doesn't exist", async () => {
    await storedLevels();
    const response = await get(`${"0".repeat(32)}.webp`);
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("is a 404 for anything that isn't <32 hex>.webp, without touching the database", async () => {
    const [level] = await storedLevels();
    const id = level!.src.slice("/img/".length, -".webp".length);
    const select = vi.spyOn(db, "select");
    for (const file of [id, `${id}.jpg`, `${id}.WEBP`, `${id.toUpperCase()}.webp`, `${id}.webp.png`, `../${id}.webp`, "pz-0a1b2c3d.webp", ""]) {
      const response = await get(file);
      expect(response.status, file).toBe(404);
    }
    expect(select).not.toHaveBeenCalled();
  });

  it("answers a malformed name with a 404 without even opening a database client", async () => {
    // Like a server whose DATABASE_URL isn't set: getDb() throws.
    getDbMock.mockImplementation(() => {
      throw new Error("DATABASE_URL is not set.");
    });
    for (const file of ["not-an-image.webp", `${"A".repeat(32)}.webp`, "favicon.ico"]) {
      const response = await get(file);
      expect(response.status, file).toBe(404);
    }
    expect(getDbMock).not.toHaveBeenCalled();
  });

  it("serves a re-cut puzzle's new images, and the old URLs stop working", async () => {
    const before = await storedLevels();
    const after = await storedLevels();
    expect((await get(before[0]!.src.replace("/img/", ""))).status).toBe(404);
    expect((await get(after[0]!.src.replace("/img/", ""))).status).toBe(200);
  });
});
