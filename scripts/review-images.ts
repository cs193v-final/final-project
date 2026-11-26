// Image picker, step 2 (#180): a local review page for the photos that
// `npm run images:find` (#179) downloaded.
//
//   npm run images:review                 then open http://127.0.0.1:4180
//   npm run images:review -- --port 5000
//
// For each theme in content/candidates/, it shows every photo with its
// credit. A reviewer picks the effect that hides it (watching it play), clicks
// the photo to set the focus point (zoom, spotlight and swirl centre there),
// fixes the answer and alternates, and approves or rejects it. Decisions are
// saved to review.json in the theme's folder as you go, so several sittings
// (or teammates, one at a time) can share the work.
//
// "Export pack" turns the approved photos, in the order you put them, into
// content/<theme>.json plus content/photos/<pack id>/, checked by the same
// rules as the seed script. Then: npm run db:seed -- --dry-run.
//
// Local only: it listens on 127.0.0.1, refuses other Host names (DNS
// rebinding) and cross-site writes, and only ever reads and writes inside
// the git-ignored content/ folder. It's a script, never a route in src/app,
// so private candidates can't be deployed.
//
// The effect previews use the game's own effects (src/game/effects, #257),
// served to the page as JavaScript, so they match what players see.
//
// Runs directly in Node 24 (type stripping), so imports keep their `.ts`.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { stripTypeScriptTypes } from "node:module";
import { join } from "node:path";
import { parseArgs } from "node:util";

import sharp from "sharp";

import {
  exportPack,
  FILE_PATTERN,
  parseExportRequest,
  parseReview,
  reviewedCandidates,
  saveReview,
  THEME_PATTERN,
} from "../src/images/review.ts";
import { assertNotCommittable, REPO_ROOT } from "./not-committable.ts";

const MAX_BODY = 64 * 1024;
const PREVIEW_WIDTH = 1600;
const EFFECTS_DIR = join(import.meta.dirname, "../src/game/effects");
const MODULE_NAME = /^[a-z][a-z-]*$/u;

/**
 * The game's reveal effects (src/game/effects, #257) as browser JavaScript, so
 * the preview draws exactly what players will see. Node strips the types (the
 * files use only erasable TypeScript) and `./x.ts` imports become `./x.js`.
 * Only the effects' own files are served, never their tests.
 */
export function effectsModule(name: string): string | null {
  if (!MODULE_NAME.test(name) || name.includes("test")) return null;
  const file = join(EFFECTS_DIR, `${name}.ts`);
  if (!existsSync(file)) return null;
  const js = stripTypeScriptTypes(readFileSync(file, "utf8"));
  return js.replace(/(from\s+["']\.\/[a-z][a-z-]*)\.ts(["'])/gu, "$1.js$2");
}

export type ServerOptions = { contentDir: string; port: number };

function themes(candidatesDir: string) {
  if (!existsSync(candidatesDir)) return [];
  return readdirSync(candidatesDir)
    .filter((name) => THEME_PATTERN.test(name) && statSync(join(candidatesDir, name)).isDirectory())
    .sort()
    .map((slug) => {
      const list = reviewedCandidates(join(candidatesDir, slug));
      const count = (s: string) => list.filter((c) => c.review.status === s).length;
      return { slug, total: list.length, approved: count("approved"), rejected: count("rejected"), pending: count("pending") };
    });
}

function send(res: ServerResponse, status: number, body: unknown, type = "application/json; charset=utf-8") {
  const data = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  res.end(data);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  if (!(req.headers["content-type"] ?? "").startsWith("application/json")) throw new Error("send JSON");
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error("request too large");
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** The request handler, exported for tests. */
export function createHandler({ contentDir, port }: ServerOptions) {
  const candidatesDir = join(contentDir, "candidates");
  const page = readFileSync(join(import.meta.dirname, "../src/images/review-page.html"), "utf8");
  const previews = new Map<string, Buffer>();
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      // DNS rebinding: a web page can't reach us under another name.
      if (!allowedHosts.has(req.headers.host ?? "")) return send(res, 403, { error: "wrong host" });
      // Cross-site writes: only our own page may change anything.
      if (req.method !== "GET") {
        const origin = req.headers.origin;
        if (origin !== undefined && !allowedHosts.has(origin.replace(/^http:\/\//u, ""))) return send(res, 403, { error: "wrong origin" });
      }
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const parts = url.pathname.split("/").filter(Boolean);

      if (req.method === "GET" && url.pathname === "/") return send(res, 200, page, "text/html; charset=utf-8");
      if (req.method === "GET" && url.pathname === "/api/themes") return send(res, 200, themes(candidatesDir));
      if (req.method === "GET" && parts[0] === "effects" && parts.length === 2 && parts[1]!.endsWith(".js")) {
        const js = effectsModule(parts[1]!.slice(0, -3));
        return js === null ? send(res, 404, { error: "not found" }) : send(res, 200, js, "text/javascript; charset=utf-8");
      }

      const [kind, theme, item, extra] = parts;
      if (theme === undefined || !THEME_PATTERN.test(theme)) return send(res, 404, { error: "not found" });
      const themeDir = join(candidatesDir, theme);
      if (!existsSync(themeDir)) return send(res, 404, { error: "no such theme" });

      if (req.method === "GET" && kind === "api" && item === undefined) {
        return send(res, 200, { theme, candidates: reviewedCandidates(themeDir) });
      }
      if (req.method === "GET" && kind === "img" && item !== undefined && FILE_PATTERN.test(item) && extra === undefined) {
        const key = `${theme}/${item}`;
        let preview = previews.get(key);
        if (preview === undefined) {
          const file = join(themeDir, item);
          if (!existsSync(file)) return send(res, 404, { error: "no such photo" });
          preview = await sharp(file).rotate().resize({ width: PREVIEW_WIDTH, withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
          previews.set(key, preview);
        }
        return send(res, 200, preview, "image/jpeg");
      }
      if (req.method === "PUT" && kind === "api" && item !== undefined && extra === undefined) {
        const review = parseReview(await readBody(req));
        saveReview(themeDir, item, review);
        return send(res, 200, { ok: true, review });
      }
      if (req.method === "POST" && kind === "api" && item === "export" && extra === undefined) {
        const request = parseExportRequest(await readBody(req));
        const result = exportPack(contentDir, themeDir, theme, request);
        return send(res, 200, { ok: true, ...result, file: `content/${theme}.json` });
      }
      return send(res, 404, { error: "not found" });
    } catch (error) {
      return send(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  };
}

async function main() {
  const { values } = parseArgs({ options: { port: { type: "string", default: "4180" } } });
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("--port must be 1024 to 65535");
  const contentDir = join(REPO_ROOT, "content");
  assertNotCommittable(contentDir);
  const server = createServer(createHandler({ contentDir, port }));
  server.listen(port, "127.0.0.1", () => {
    console.log(`Review page: http://127.0.0.1:${port}  (Ctrl-C to stop)`);
    const found = themes(join(contentDir, "candidates"));
    if (found.length === 0) console.log('No candidates yet. Run: npm run images:find -- --theme <theme> --answers "<answer>,…"');
    for (const t of found) console.log(`  ${t.slug}: ${t.total} photos, ${t.approved} approved, ${t.pending} to review`);
  });
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
