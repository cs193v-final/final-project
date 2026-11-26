// Image picker, step 1 (#179): find openly licensed photo candidates on
// Openverse and download them for a person to review (#180). Scripts only:
// app code never imports this. Run through `npm run images:find`
// (scripts/find-images.ts), which explains the options.
//
// Filters, in order:
// - license: only CC0, the Public Domain Mark, CC BY and CC BY-SA. No NC or
//   ND: cropping a photo counts as changing it.
// - from Wikimedia Commons (the only source with full-size originals), JPEG
//   files only (drawings and diagrams are mostly PNG or SVG), not marked
//   mature or sensitive;
// - at least `minWidth` pixels wide (about 3,000), checked on Openverse's
//   numbers first and again on the downloaded file;
// - CC BY and BY-SA need a named creator to credit.
//
// Credits mark BY and BY-SA photos as cropped, since the game shows crops and
// those licenses require saying a photo was changed.
//
// Downloads are named with random `pz-` ids, never the photo's title or the
// answer (titles often name the subject). One request at a time, a pause
// between them (longer before downloads), and on HTTP 429/503 a wait as long
// as the server asks; still blocked after that, the run stops. Commons
// originals wider than 3,840 px are downloaded as Wikimedia's 3,840 px copy.
// A generic User-Agent.
//
// Runs directly in Node 24 (type stripping), so imports keep their `.ts`.

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import sharp, { type Metadata } from "sharp";

export const OPENVERSE_API = "https://api.openverse.org/v1/images/";

/** Names the project, not a person (#179: no personal email). */
export const USER_AGENT = "zoom-out-image-picker/0.1 (CS 193V student project; github.com/cs193v-final/final-project)";

/** Openverse's names for the licenses that let us crop and show a photo with credit. */
export const ALLOWED_LICENSES = ["cc0", "pdm", "by", "by-sa"] as const;
export type AllowedLicense = (typeof ALLOWED_LICENSES)[number];

/** The 1,920 px practice photos already look soft at 14× zoom. */
export const DEFAULT_MIN_WIDTH = 3000;

/** A downloaded original bigger than this is refused (and not saved). */
export const MAX_DOWNLOAD_BYTES = 60 * 1024 * 1024;

/** The fields we read from an Openverse image result. Anything may be missing. */
export type OpenverseImage = {
  id?: unknown;
  title?: unknown;
  url?: unknown;
  foreign_landing_url?: unknown;
  creator?: unknown;
  license?: unknown;
  license_version?: unknown;
  provider?: unknown;
  source?: unknown;
  width?: unknown;
  height?: unknown;
  filetype?: unknown;
  mature?: unknown;
  unstable__sensitivity?: unknown;
};

export type Credit = { source: string; license: string; url?: string };

/** One saved candidate, as listed in the folder's `candidates.json`. */
export type Candidate = {
  id: string; // random "pz-…" id, also the file name
  file: string; // e.g. "pz-1a2b3c4d.jpg", next to candidates.json
  answer: string;
  width: number;
  height: number;
  credit: Credit;
  openverseId: string;
  title: string; // for the reviewer only; never used in a file name or shown to players
  fingerprint?: string; // what the photo looks like (see `fingerprint`), to skip copies; older lists may lack it
};

/**
 * Commons often has the same photo several times (re-uploads, other sizes, a
 * lightly edited copy), under different files. Two photos whose fingerprints
 * differ in at most this many of 64 bits count as the same photo. Measured on
 * real candidates (Nov 26): an exact copy is 0, a different shot of the same
 * subject by the same photographer, cropped and zoomed, is 26.
 */
export const DUPLICATE_DISTANCE = 8;

/**
 * A 64-bit "difference hash" of the photo as 16 hex digits: shrink it to 9×8
 * grey pixels and record, for each row, whether each pixel is brighter than
 * the next. Resizing, recompression and small colour edits barely change it;
 * a different crop or shot changes it a lot.
 */
export async function fingerprint(input: Buffer | string): Promise<string> {
  const px = await sharp(input).rotate().greyscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
  let bits = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) bits = (bits << 1n) | (px[y * 9 + x]! > px[y * 9 + x + 1]! ? 1n : 0n);
  }
  return bits.toString(16).padStart(16, "0");
}

/** How many of the 64 bits differ between two fingerprints. */
export function fingerprintDistance(a: string, b: string): number {
  let diff = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let count = 0;
  while (diff > 0n) {
    count += Number(diff & 1n);
    diff >>= 1n;
  }
  return count;
}

const isText = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

export function isAllowedLicense(license: unknown): license is AllowedLicense {
  return (ALLOWED_LICENSES as readonly unknown[]).includes(license);
}

const PROVIDERS: Record<string, string> = {
  wikimedia: "Wikimedia Commons",
  flickr: "Flickr",
  nappy: "nappy",
  rawpixel: "rawpixel",
  stocksnap: "StockSnap",
};

function providerName(image: OpenverseImage): string {
  const key = isText(image.source) ? image.source : isText(image.provider) ? image.provider : "Openverse";
  return PROVIDERS[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

/** "CC BY-SA 4.0, cropped", "CC0 1.0", "Public Domain Mark 1.0". `null` for a license we don't allow. */
export function licenseLabel(license: unknown, version: unknown): string | null {
  if (!isAllowedLicense(license)) return null;
  const v = isText(version) ? ` ${version.trim()}` : "";
  switch (license) {
    case "cc0":
      return `CC0${v}`;
    case "pdm":
      return `Public Domain Mark${v}`;
    case "by":
      return `CC BY${v}, cropped`;
    case "by-sa":
      return `CC BY-SA${v}, cropped`;
  }
}

/**
 * The credit players see after the round: creator and site, the license
 * (marked cropped where the license requires it) and the photo's page.
 * `null` when the photo can't be credited properly (a BY or BY-SA photo with
 * no creator, or no page to link to).
 */
export function creditFor(image: OpenverseImage): Credit | null {
  const license = licenseLabel(image.license, image.license_version);
  if (license === null || !isText(image.foreign_landing_url)) return null;
  const needsCreator = image.license === "by" || image.license === "by-sa";
  if (needsCreator && !isText(image.creator)) return null;
  const who = isText(image.creator) ? `${image.creator.trim()}, via ` : "";
  return { source: `${who}${providerName(image)}`, license, url: image.foreign_landing_url };
}

/** Why a search result is skipped, or `null` to download it. */
export function skipReason(image: OpenverseImage, minWidth: number): string | null {
  if (!isText(image.id) || !isText(image.url)) return "no id or image URL";
  if (!isAllowedLicense(image.license)) return `license "${String(image.license)}" isn't allowed`;
  if (image.mature === true) return "marked mature";
  if (Array.isArray(image.unstable__sensitivity) && image.unstable__sensitivity.length > 0) return "marked sensitive";
  if (typeof image.width !== "number" || image.width < minWidth) return `under ${minWidth} px wide`;
  if (isText(image.filetype) && !["jpg", "jpeg"].includes(image.filetype.toLowerCase())) return `a .${image.filetype} file, not a photo`;
  if (creditFor(image) === null) return "can't be credited (no creator or page)";
  return null;
}

/** A random opaque id like the content's ("pz-7c1e9a40"); says nothing about the photo. */
export function newPuzzleId(): string {
  return `pz-${randomBytes(4).toString("hex")}`;
}

/** Lowercase letters, digits and hyphens, for the candidates folder name. */
export function themeSlug(theme: string): string {
  const slug = theme.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "");
  if (slug === "") throw new Error("--theme needs at least one letter or digit");
  return slug;
}

/**
 * Wikimedia Commons only: for Flickr, Rawpixel and StockSnap, Openverse's image
 * URL is a ~1,000 px thumbnail (checked Nov 25), so none of them can pass the
 * width filter. Commons URLs are the original files. (Commons results have no
 * Openverse category, so a "photograph" filter would drop them all.)
 */
export const SEARCH_SOURCE = "wikimedia";

export function searchUrl(answer: string, page: number, pageSize = 20): string {
  const params = new URLSearchParams({
    q: answer,
    license: ALLOWED_LICENSES.join(","),
    source: SEARCH_SOURCE,
    mature: "false",
    page: String(page),
    page_size: String(pageSize),
  });
  return `${OPENVERSE_API}?${params}`;
}

export type Fetch = (url: string, init?: { headers?: Record<string, string> }) => Promise<Response>;
export type Sleep = (ms: number) => Promise<void>;
export const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * GET with the project's User-Agent. On 429 or 503 it waits (the server's
 * Retry-After if it gives one, else 2, 4, 8… seconds) and tries again, up to
 * `retries` times. Other errors are returned as they are, for the caller.
 */
export async function fetchWithBackoff(
  url: string,
  fetchFn: Fetch,
  sleep: Sleep,
  retries = 4,
  onWait: (seconds: number) => void = () => {},
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetchFn(url, { headers: { "User-Agent": USER_AGENT } });
    if ((response.status !== 429 && response.status !== 503) || attempt >= retries) return response;
    const retryAfter = Number(response.headers.get("retry-after"));
    // Wait as long as the server asks (Wikimedia asks for 600 s), up to MAX_WAIT_SECONDS:
    // retrying sooner only keeps the block going.
    const seconds = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, MAX_WAIT_SECONDS) : 2 ** (attempt + 1);
    onWait(seconds);
    await sleep(seconds * 1000);
  }
}

/** The longest Retry-After we honour; a longer one is waited this long, then tried again. */
export const MAX_WAIT_SECONDS = 15 * 60;

/** Thrown when a server still says "too many requests" after waiting: stop the run rather than keep asking. */
export class RateLimitedError extends Error {
  constructor(host: string) {
    super(`${host} still says "too many requests" after waiting. Stopped; run the same command again later (saved photos are kept).`);
    this.name = "RateLimitedError";
  }
}

/** Wikimedia serves resized copies of originals at fixed widths; this is the biggest common one. */
export const COMMONS_DOWNLOAD_WIDTH = 3840;

/**
 * For a Wikimedia Commons original wider than `COMMONS_DOWNLOAD_WIDTH`, the URL
 * of its resized copy at that width; otherwise the URL as it is. Originals are
 * often 8,000+ px and 10-20 MB, and big downloads hit Wikimedia's rate limit
 * fastest; 3,840 px is still sharp at the game's zoom.
 */
export function downloadUrl(url: string, width: unknown): string {
  const match = /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/([0-9a-f])\/([0-9a-f]{2})\/([^/?#]+)$/u.exec(url);
  if (match === null || typeof width !== "number" || width <= COMMONS_DOWNLOAD_WIDTH) return url;
  const [, a, ab, name] = match;
  return `https://upload.wikimedia.org/wikipedia/commons/thumb/${a}/${ab}/${name}/${COMMONS_DOWNLOAD_WIDTH}px-${name}`;
}

const EXTENSIONS: Record<string, string> = { jpeg: "jpg", png: "png", webp: "webp" };

export type FindOptions = {
  answers: string[]; // one search per answer, e.g. the five puzzles of a theme
  outDir: string; // already checked not to be committable
  perAnswer: number; // how many photos to keep for each answer
  minWidth: number;
  maxPages: number; // search result pages to look through per answer
  fetch: Fetch;
  sleep: Sleep;
  pauseMs: number; // between searches, to stay well under Openverse's limits
  downloadPauseMs?: number; // before each photo download (default 5,000): Wikimedia's limit is stricter
  log: (line: string) => void;
};

export type FindSummary = { saved: Candidate[]; skipped: number };

/** Reads `candidates.json` in `dir`, or an empty list. */
export function readCandidates(dir: string): Candidate[] {
  const file = join(dir, "candidates.json");
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Candidate[]) : [];
}

function writeCandidates(dir: string, list: Candidate[]) {
  const file = join(dir, "candidates.json");
  writeFileSync(`${file}.tmp`, `${JSON.stringify(list, null, 2)}\n`);
  renameSync(`${file}.tmp`, file); // never a half-written list
}

/**
 * Searches each answer and saves up to `perAnswer` new photos per answer into
 * `outDir`, with their credits in `candidates.json` (added to what's already
 * there). A photo saved before is skipped, and so is a copy of one under
 * another file (`DUPLICATE_DISTANCE`). One request at a time.
 */
export async function findCandidates(options: FindOptions): Promise<FindSummary> {
  const { outDir, perAnswer, minWidth, maxPages, sleep, pauseMs, log } = options;
  mkdirSync(outDir, { recursive: true });
  const list = readCandidates(outDir);
  const seen = new Set(list.map((c) => c.openverseId));
  // Fingerprint photos saved by an older version of this script, once.
  let added = false;
  for (const c of list) {
    if (c.fingerprint === undefined && existsSync(join(outDir, c.file))) {
      c.fingerprint = await fingerprint(join(outDir, c.file));
      added = true;
    }
  }
  if (added) writeCandidates(outDir, list);
  const saved: Candidate[] = [];
  let skipped = 0;
  let first = true;
  const get = async (url: string, kind: "search" | "download" = "search") => {
    if (!first) await sleep(kind === "download" ? (options.downloadPauseMs ?? 5000) : pauseMs);
    first = false;
    const response = await fetchWithBackoff(url, options.fetch, sleep, 6, (seconds) =>
      log(`  ${new URL(url).host} asked us to wait ${seconds} s; waiting…`),
    );
    if (response.status === 429) throw new RateLimitedError(new URL(url).host);
    return response;
  };

  for (const answer of options.answers) {
    let kept = 0;
    for (let page = 1; page <= maxPages && kept < perAnswer; page++) {
      const response = await get(searchUrl(answer, page));
      if (!response.ok) {
        log(`"${answer}": search page ${page} failed (HTTP ${response.status}); moving on`);
        break;
      }
      const body = (await response.json()) as { results?: OpenverseImage[]; page_count?: number };
      const results = Array.isArray(body.results) ? body.results : [];
      for (const image of results) {
        if (kept >= perAnswer) break;
        if (isText(image.id) && seen.has(image.id)) continue;
        const reason = skipReason(image, minWidth);
        if (reason !== null) {
          skipped++;
          continue;
        }
        const candidate = await download(image, answer, get, options, list);
        if (candidate === null) {
          skipped++;
          continue;
        }
        list.push(candidate);
        writeCandidates(outDir, list);
        seen.add(candidate.openverseId);
        saved.push(candidate);
        kept++;
        log(`"${answer}": saved ${candidate.file} (${candidate.width}×${candidate.height}, ${candidate.credit.license})`);
      }
      if (results.length === 0 || (typeof body.page_count === "number" && page >= body.page_count)) break;
    }
    if (kept < perAnswer) log(`"${answer}": found ${kept} of ${perAnswer}; try another wording, or more --pages`);
  }
  return { saved, skipped };
}

/** Downloads one photo, checks it's a real image that's wide enough, and saves it. `null` if not. */
async function download(
  image: OpenverseImage,
  answer: string,
  get: (url: string, kind?: "search" | "download") => Promise<Response>,
  { outDir, minWidth, log }: FindOptions,
  saved: readonly Candidate[],
): Promise<Candidate | null> {
  const response = await get(downloadUrl(image.url as string, image.width), "download");
  if (!response.ok) {
    log(`  skipped a photo: download failed (HTTP ${response.status})`);
    return null;
  }
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_DOWNLOAD_BYTES) {
    log("  skipped a photo: too large to download");
    return null;
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_DOWNLOAD_BYTES) {
    log("  skipped a photo: too large to download");
    return null;
  }
  let meta: Metadata;
  try {
    meta = await sharp(bytes).metadata();
  } catch {
    log("  skipped a photo: not an image sharp can read");
    return null;
  }
  const ext = meta.format === undefined ? undefined : EXTENSIONS[meta.format];
  if (ext === undefined || meta.width === undefined || meta.height === undefined) {
    log(`  skipped a photo: unsupported format (${meta.format ?? "unknown"})`);
    return null;
  }
  // EXIF orientation 5–8 swaps width and height when shown.
  const [width, height] = (meta.orientation ?? 1) >= 5 ? [meta.height, meta.width] : [meta.width, meta.height];
  if (width < minWidth) {
    log(`  skipped a photo: really ${width} px wide, under ${minWidth}`);
    return null;
  }
  const print = await fingerprint(bytes);
  const copyOf = saved.find((c) => c.fingerprint !== undefined && fingerprintDistance(c.fingerprint, print) <= DUPLICATE_DISTANCE);
  if (copyOf !== undefined) {
    log(`  skipped a photo: the same photo as ${copyOf.file}, already saved`);
    return null;
  }
  let id = newPuzzleId();
  while (existsSync(join(outDir, `${id}.${ext}`))) id = newPuzzleId();
  const file = `${id}.${ext}`;
  writeFileSync(join(outDir, file), bytes, { flag: "wx" }); // "wx": never overwrite a file
  return {
    id,
    file,
    answer,
    width,
    height,
    credit: creditFor(image)!,
    openverseId: image.id as string,
    title: isText(image.title) ? image.title : "",
    fingerprint: print,
  };
}
