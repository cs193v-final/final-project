// Spec for custom lobbies (#67) end to end, minus HTTP: the upload route's
// handler, the lobby Server Action backends, /play's game calls and the image
// route, on PGlite with the real migrations. Cookies, the session and the
// request headers are stubbed. Each "Done when" item of #67 has a describe below.
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { newUserRow } from "@/auth/user-row";
import { Vault } from "@/crypto/vault";
import * as schema from "@/db/schema";
import type { LobbyRoundInput } from "@/game/lobby";

const KEY = Buffer.alloc(32, 5);
const state = vi.hoisted(() => ({
  db: undefined as unknown,
  jar: new Map<string, string>(),
  user: null as { id: string; username: string } | null,
}));

vi.stubEnv("DATA_ENCRYPTION_KEY", KEY.toString("base64"));
vi.mock("@/db", () => ({ getDb: () => state.db }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (state.jar.has(name) ? { name, value: state.jar.get(name)! } : undefined),
    set: (name: string, value: string) => state.jar.set(name, value),
  }),
  headers: async () => new Headers({ "x-forwarded-proto": "https" }),
}));
vi.mock("@/auth/session", () => ({ getCurrentUser: async () => state.user, requestIp: async () => null }));

const lobbiesServer = await import("./lobbies");
const { createLobbyForUser, deleteMyLobby, joinLobby, lobbyLeaderboard, myLobbies, reportLobby, startLobbyGame, uploadLobbyPhoto } =
  lobbiesServer;
const { actOnGame, loadGame } = await import("./games");
const { imageResponse } = await import("./images");
const { sweepExpired } = await import("./sweep");
const { LOBBY_CAPS, LOBBY_LIMITS } = await import("./limits");
const { LOBBY_LIFETIME_MS, LOBBY_ZOOM_LEVELS, MAX_LOBBY_PUZZLES, REPORTS_TO_HIDE } = await import("@/game/lobby");
const { MAX_UPLOAD_BYTES } = await import("./lobby-images");

let pg: PGlite;
let db: PgliteDatabase<typeof schema>;
const vault = new Vault(KEY);

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle({ client: pg, schema });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
  state.db = db;
}, 60_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await pg.close();
});

beforeEach(async () => {
  state.jar.clear();
  state.user = null;
  await pg.exec("DELETE FROM rate_limits;");
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let userCount = 0;
async function newUser(name = `player${++userCount}`) {
  const row = newUserRow(vault, name, "not-a-real-hash");
  await db.insert(schema.users).values(row);
  return { id: row.id, username: name };
}

/** Act as this user (or as a logged-out visitor with its own owner cookie). */
function as(user: { id: string; username: string } | null) {
  state.user = user;
  state.jar.clear();
}

/** A phone photo with an answer in its description and a GPS position. */
async function photo(colour: { r: number; g: number; b: number }) {
  return new Uint8Array(
    await sharp({ create: { width: 640, height: 480, channels: 3, background: colour } })
      .jpeg()
      .withExif({
        IFD0: { ImageDescription: "Secret: Hoover Tower", Make: "PhoneCo" },
        IFD3: { GPSLatitudeRef: "N", GPSLatitude: "37/1 25/1 39/1", GPSLongitudeRef: "W", GPSLongitude: "122/1 10/1 0/1" },
      })
      .toBuffer(),
  );
}

function uploadRequest(body: Uint8Array, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/lobby-uploads", {
    method: "POST",
    headers: { origin: "http://localhost", host: "localhost", "content-type": "image/jpeg", ...headers },
    body: new Uint8Array(body),
  });
}

async function upload(body: Uint8Array): Promise<string> {
  const response = await uploadLobbyPhoto(uploadRequest(body));
  const json = (await response.json()) as { ok: boolean; uploadId?: string; error?: string };
  if (!json.ok) throw new Error(`upload failed: ${json.error}`);
  return json.uploadId!;
}

const ANSWERS = ["Hoover Tower", "Memorial Church", "The Oval", "Green Library", "Rodin Garden"];

async function rounds(count = 3): Promise<LobbyRoundInput[]> {
  const out: LobbyRoundInput[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      uploadId: await upload(await photo({ r: 40 * i, g: 100, b: 200 - 30 * i })),
      answer: ANSWERS[i]!,
      acceptedAnswers: i === 0 ? ["Hoover"] : [],
      focus: { x: 0.3, y: 0.6 },
    });
  }
  return out;
}

/** A new lobby by `owner`; returns its code. */
async function lobbyBy(owner: { id: string; username: string }, count = 3) {
  as(owner);
  const result = await createLobbyForUser(await rounds(count));
  if (!result.ok) throw new Error(`create failed: ${result.error}`);
  return result;
}

/** Plays a whole lobby game: guesses the right answer for the first `correct` photos, skips the rest. */
async function play(code: string, correct: number) {
  const start = await startLobbyGame(code);
  if (!start.ok) throw new Error(`start failed: ${start.error}`);
  let view = start.view;
  const seen: string[] = [];
  const count = view.round!.puzzleCount;
  for (let i = 0; i < count; i++) {
    seen.push(JSON.stringify(view));
    const action = i < correct ? { type: "guess", guess: ANSWERS[i]! } : { type: "skip" };
    let result = await actOnGame(view.gameId, action, view.revision);
    if (!result.ok) throw new Error(`act failed: ${result.error}`);
    result = await actOnGame(result.view.gameId, { type: "next" }, result.view.revision);
    if (!result.ok) throw new Error(`next failed: ${result.error}`);
    view = result.view;
  }
  return { view, seen };
}

const tableCount = async (table: string) =>
  Number(((await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]!).n);

// ---------------------------------------------------------------------------

describe("creating a lobby requires login, with 3-5 images", () => {
  it("refuses uploads and creating while logged out", async () => {
    as(null);
    const response = await uploadLobbyPhoto(uploadRequest(await photo({ r: 1, g: 2, b: 3 })));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: "login-required" });
    expect(await createLobbyForUser([])).toEqual({ ok: false, error: "login-required" });
  });

  it("makes a lobby from 3 to 5 photos and returns a code, once", async () => {
    const owner = await newUser();
    const three = await lobbyBy(owner, 3);
    expect(three.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/u);
    const five = await lobbyBy(owner, MAX_LOBBY_PUZZLES);
    as(null);
    expect(await joinLobby(three.code)).toMatchObject({ ok: true, lobby: { puzzleCount: 3, yours: false } });
    expect(await joinLobby(five.code)).toMatchObject({ ok: true, lobby: { puzzleCount: 5 } });
  });

  it("refuses 2 or 6 photos, and uploads that aren't yours or are used up", async () => {
    const owner = await newUser();
    as(owner);
    const mine = await rounds(MAX_LOBBY_PUZZLES);
    expect(await createLobbyForUser(mine.slice(0, 2))).toEqual({ ok: false, error: "invalid" });
    const sixth = { ...mine[0]!, uploadId: "f".repeat(32), answer: "Extra" };
    expect(await createLobbyForUser([...mine, sixth])).toEqual({ ok: false, error: "invalid" });

    as(await newUser());
    expect(await createLobbyForUser(mine.slice(0, 3))).toEqual({ ok: false, error: "invalid" });

    as(owner);
    expect((await createLobbyForUser(mine.slice(0, 3))).ok).toBe(true);
    // Used up: those uploads are gone.
    expect(await createLobbyForUser(mine.slice(0, 3))).toEqual({ ok: false, error: "invalid" });
  });

  it(`caps lobbies per player at ${LOBBY_CAPS.lobbiesPerUser}, leaving nothing behind when refused`, async () => {
    const owner = await newUser();
    for (let i = 0; i < LOBBY_CAPS.lobbiesPerUser; i++) await lobbyBy(owner);
    const packs = await tableCount("packs");
    as(owner);
    expect(await createLobbyForUser(await rounds())).toEqual({ ok: false, error: "cap-reached" });
    expect(await tableCount("packs")).toBe(packs);
  });

  it(`caps waiting uploads per player at ${LOBBY_CAPS.uploadsPerUser}`, async () => {
    as(await newUser());
    const jpeg = await photo({ r: 9, g: 9, b: 9 });
    for (let i = 0; i < LOBBY_CAPS.uploadsPerUser; i++) await upload(jpeg);
    const response = await uploadLobbyPhoto(uploadRequest(jpeg));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, error: "cap-reached" });
  });

  it(`rate-limits creating to ${LOBBY_LIMITS.createsPerOwner.max} a day per player`, async () => {
    as(await newUser());
    for (let i = 0; i < LOBBY_LIMITS.createsPerOwner.max; i++) await createLobbyForUser([{ uploadId: "a".repeat(32) }, {}, {}]);
    // Malformed requests are refused before they count; well-formed ones count even when they fail.
    const wellFormed = [0, 1, 2].map((i) => ({ uploadId: String(i).repeat(32), answer: "x", acceptedAnswers: [], focus: { x: 0, y: 0 } }));
    for (let i = 0; i < LOBBY_LIMITS.createsPerOwner.max; i++) expect(await createLobbyForUser(wellFormed)).toEqual({ ok: false, error: "invalid" });
    expect(await createLobbyForUser(wellFormed)).toEqual({ ok: false, error: "rate-limited" });
  });
});

describe("file type and size limits; uploads are re-encoded without metadata (GPS especially)", () => {
  it("stores only a re-encoded, encrypted copy: no EXIF, no GPS, no description", async () => {
    as(await newUser());
    const original = await photo({ r: 200, g: 10, b: 10 });
    expect(Buffer.from(original).includes("Hoover")).toBe(true);
    const uploadId = await upload(original);
    const [row] = (await pg.query<{ bytes: Uint8Array }>("SELECT bytes FROM lobby_uploads WHERE id = $1", [uploadId])).rows;
    const stored = Buffer.from(row!.bytes);
    expect(stored.includes("Hoover")).toBe(false);
    expect(stored.subarray(0, 4).toString("latin1")).not.toBe("RIFF"); // encrypted, not a WebP file
    const plain = vault.decryptBytes(`lobby-upload:${uploadId}`, "lobby_uploads.bytes", row!.bytes);
    const meta = await sharp(plain).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(Buffer.from(plain).includes("Hoover")).toBe(false);
  });

  it("refuses other types (by their bytes), oversized bodies, and other sites", async () => {
    as(await newUser());
    const gif = new Uint8Array(await sharp({ create: { width: 8, height: 8, channels: 3, background: "red" } }).gif().toBuffer());
    const typed = await uploadLobbyPhoto(uploadRequest(gif, { "content-type": "image/jpeg" }));
    expect([typed.status, await typed.json()]).toEqual([415, { ok: false, error: "unsupported-image" }]);

    const big = await uploadLobbyPhoto(uploadRequest(new Uint8Array(MAX_UPLOAD_BYTES + 1)));
    expect([big.status, await big.json()]).toEqual([413, { ok: false, error: "too-large" }]);

    const jpeg = await photo({ r: 1, g: 1, b: 1 });
    for (const origin of ["https://evil.example", "null"]) {
      const response = await uploadLobbyPhoto(uploadRequest(jpeg, { origin }));
      expect(response.status).toBe(400);
    }
    const noOrigin = uploadRequest(jpeg);
    noOrigin.headers.delete("origin");
    expect((await uploadLobbyPhoto(noOrigin)).status).toBe(400);
  });
});

describe("answers are stored server-side only", () => {
  it("are encrypted at rest: nowhere in plain text in the database", async () => {
    await lobbyBy(await newUser());
    const dump = JSON.stringify([
      (await pg.query("SELECT * FROM puzzles WHERE id LIKE 'lobby-%'")).rows,
      (await pg.query("SELECT * FROM lobby_puzzles")).rows,
      (await pg.query("SELECT * FROM lobbies")).rows,
    ]);
    for (const answer of ANSWERS.slice(0, 3)) expect(dump).not.toContain(answer);
    const puzzles = (await pg.query<{ answer: string; accepted_answers: string[] }>("SELECT answer, accepted_answers FROM puzzles WHERE id LIKE 'lobby-%'")).rows;
    expect(puzzles.every((p) => p.answer === "" && p.accepted_answers.length === 0)).toBe(true);
  });

  it("never reach the browser while a round is played, but are checked, and shown once it ends", async () => {
    const { code } = await lobbyBy(await newUser());
    as(null);
    const { view, seen } = await play(code, 3);
    for (const json of seen) for (const answer of ANSWERS.slice(0, 3)) expect(json).not.toContain(answer);
    expect(view).toMatchObject({ finished: true, answers: ANSWERS.slice(0, 3) });
    expect(view.results.every((r) => r.outcome === "correct")).toBe(true);
  });

  it("accept the alternates the creator typed", async () => {
    const { code } = await lobbyBy(await newUser());
    as(null);
    const start = await startLobbyGame(code);
    if (!start.ok) throw new Error("start failed");
    const result = await actOnGame(start.view.gameId, { type: "guess", guess: "hoover" }, start.view.revision);
    expect(result).toMatchObject({ ok: true, view: { lastOutcome: { kind: "correct" } } });
  });
});

describe("hard-to-guess codes, and joining by code", () => {
  it("stores a code only as a keyed hash and encrypted for its owner, who can see it again", async () => {
    const owner = await newUser();
    const { code, lobbyId } = await lobbyBy(owner);
    const raw = code.replaceAll("-", "");
    const row = JSON.stringify((await pg.query("SELECT * FROM lobbies WHERE id = $1", [lobbyId])).rows);
    expect(row).not.toContain(raw);
    as(owner);
    expect(await myLobbies()).toMatchObject({ ok: true, lobbies: [{ id: lobbyId, code, puzzleCount: 3, hidden: false, plays: 0 }] });
    as(null);
    expect(await myLobbies()).toEqual({ ok: false, error: "login-required" });
  });

  it("joins however the code is typed; anything else is not-found", async () => {
    const owner = await newUser();
    const { code } = await lobbyBy(owner);
    as(null);
    for (const typed of [code, code.toLowerCase(), code.replaceAll("-", " ").replaceAll("0", "o")]) {
      expect((await joinLobby(typed)).ok).toBe(true);
    }
    for (const bad of ["", "nope", 42, null, `${code.slice(0, -1)}${code.endsWith("Z") ? "Y" : "Z"}`]) {
      expect(await joinLobby(bad)).toEqual({ ok: false, error: "not-found" });
    }
    as(owner);
    expect(await joinLobby(code)).toMatchObject({ ok: true, lobby: { yours: true } });
  });

  it(`rate-limits lookups to ${LOBBY_LIMITS.lookupsPerOwner.max} an hour per player, so codes can't be guessed`, async () => {
    as(await newUser());
    for (let i = 0; i < LOBBY_LIMITS.lookupsPerOwner.max; i++) expect((await joinLobby("0000-0000-0000-0000")).ok).toBe(false);
    expect(await joinLobby("0000-0000-0000-0000")).toEqual({ ok: false, error: "rate-limited" });
  });

  it("serves a lobby's level images, never to the CDN, and only while it can be played", async () => {
    const owner = await newUser();
    const { code, lobbyId } = await lobbyBy(owner);
    as(null);
    const start = await startLobbyGame(code);
    if (!start.ok) throw new Error("start failed");
    const file = start.view.round!.imageSrc.replace("/img/", "");
    const served = await imageResponse(() => db, file, "", vault);
    expect(served.status).toBe(200);
    expect(served.headers.get("cache-control")).toMatch(/^private/u);
    expect(served.headers.get("cdn-cache-control")).toBeNull();
    const bytes = new Uint8Array(await served.arrayBuffer());
    const meta = await sharp(bytes).metadata();
    expect([meta.format, meta.exif]).toEqual(["webp", undefined]);
    expect(start.view.round!.levelCount).toBe(LOBBY_ZOOM_LEVELS.length);

    // Stored encrypted.
    const id = file.replace(".webp", "");
    const [row] = (await pg.query<{ bytes: Uint8Array }>("SELECT bytes FROM image_files WHERE id = $1", [id])).rows;
    expect(Buffer.from(row!.bytes).subarray(0, 4).toString("latin1")).not.toBe("RIFF");

    await pg.query("UPDATE lobbies SET hidden_at = now() WHERE id = $1", [lobbyId]);
    expect((await imageResponse(() => db, file, "", vault)).status).toBe(404);
  });
});

describe("a lobby leaderboard", () => {
  it("ranks logged-in players by their first finished game; replays and anonymous games don't count", async () => {
    const { code } = await lobbyBy(await newUser());
    const ann = await newUser("Ann");
    const bob = await newUser("Bob");
    as(ann);
    await play(code, 1);
    await play(code, 3); // a replay, with the answers known: not counted
    as(bob);
    await play(code, 2);
    as(null);
    await play(code, 3); // anonymous

    as(bob);
    const result = await lobbyLeaderboard(code);
    if (!result.ok) throw new Error(result.error);
    expect(result.board.players).toBe(2);
    expect(result.board.top.map((e) => [e.rank, e.username])).toEqual([
      [1, "Bob"],
      [2, "Ann"],
    ]);
    expect(result.board.you).toMatchObject({ rank: 1, username: "Bob" });
    expect(JSON.stringify(result)).not.toMatch(/user_?id|[0-9a-f]{8}-[0-9a-f]{4}/u);

    as(null);
    expect(await lobbyLeaderboard(code)).toMatchObject({ ok: true, board: { you: null } });
    expect(await lobbyLeaderboard("0000-0000-0000-0000")).toEqual({ ok: false, error: "not-found" });
  });
});

describe("delete and report; lobbies expire", () => {
  it("only its owner can delete a lobby, and everything of it goes: games, photos, answers, pack", async () => {
    const owner = await newUser();
    const { code, lobbyId } = await lobbyBy(owner);
    as(await newUser());
    const { view } = await play(code, 1);
    expect(await deleteMyLobby(lobbyId)).toEqual({ ok: false, error: "not-found" });
    as(null);
    expect(await deleteMyLobby(lobbyId)).toEqual({ ok: false, error: "login-required" });

    const before = { images: await tableCount("image_files"), puzzles: await tableCount("puzzles"), games: await tableCount("games") };
    as(owner);
    expect(await deleteMyLobby(lobbyId)).toEqual({ ok: true });
    expect(await deleteMyLobby(lobbyId)).toEqual({ ok: false, error: "not-found" });
    expect(await joinLobby(code)).toEqual({ ok: false, error: "not-found" });
    expect(await tableCount("image_files")).toBe(before.images - 3 * LOBBY_ZOOM_LEVELS.length);
    expect(await tableCount("puzzles")).toBe(before.puzzles - 3);
    expect(await tableCount("games")).toBe(before.games - 1);
    expect((await pg.query("SELECT 1 FROM lobbies WHERE id = $1", [lobbyId])).rows).toEqual([]);
    expect((await myLobbies()).ok && (await myLobbies())).not.toMatchObject({ lobbies: [{ id: lobbyId }] });
    // The player's game is gone with it.
    as(null);
    expect((await loadGame(view.gameId)).ok).toBe(false);
  });

  it(`hides a lobby after ${REPORTS_TO_HIDE} distinct reports, a game in progress included`, async () => {
    const owner = await newUser();
    const { code, lobbyId } = await lobbyBy(owner);
    // Someone is mid-game.
    as(null);
    const player = await startLobbyGame(code);
    if (!player.ok) throw new Error("start failed");
    const playerCookies = new Map(state.jar);

    // The owner's own report and repeated reports don't count.
    as(owner);
    expect(await reportLobby(code)).toEqual({ ok: true, hidden: false });
    const first = await newUser();
    as(first);
    expect(await reportLobby(code)).toEqual({ ok: true, hidden: false });
    expect(await reportLobby(code)).toEqual({ ok: true, hidden: false });
    for (let i = 1; i < REPORTS_TO_HIDE - 1; i++) {
      as(await newUser());
      expect(await reportLobby(code)).toEqual({ ok: true, hidden: false });
    }
    as(null); // an anonymous reporter counts once per browser
    expect(await reportLobby(code)).toEqual({ ok: true, hidden: true });

    const [row] = (await pg.query<{ report_count: number }>("SELECT report_count FROM lobbies WHERE id = $1", [lobbyId])).rows;
    expect(row!.report_count).toBe(REPORTS_TO_HIDE);
    expect(await joinLobby(code)).toEqual({ ok: false, error: "not-found" });
    expect(await reportLobby(code)).toEqual({ ok: false, error: "not-found" });
    // The player's next move finds it gone.
    state.jar = playerCookies;
    expect(await actOnGame(player.view.gameId, { type: "reveal" }, player.view.revision)).toEqual({ ok: false, error: "not-found" });
    // Its owner still sees it, flagged.
    as(owner);
    expect(await myLobbies()).toMatchObject({ ok: true, lobbies: [{ id: lobbyId, hidden: true }] });
  });

  it("expires after 30 days, and the sweep deletes it and stale uploads", async () => {
    const owner = await newUser();
    const { code, lobbyId, expiresAt } = await lobbyBy(owner);
    expect(new Date(expiresAt).getTime() - Date.now()).toBeGreaterThan(LOBBY_LIFETIME_MS - 60_000);
    as(owner);
    await upload(await photo({ r: 5, g: 5, b: 5 })); // never used
    const later = new Date(new Date(expiresAt).getTime() + 1);
    as(null);
    expect((await joinLobby(code)).ok).toBe(true);
    expect(await joinLobby(code, later)).toEqual({ ok: false, error: "not-found" });

    const counts = await sweepExpired(db as never, later);
    expect(counts.lobbies).toBeGreaterThanOrEqual(1);
    expect(counts.lobbyUploads).toBeGreaterThanOrEqual(1);
    expect((await pg.query("SELECT 1 FROM lobbies WHERE id = $1", [lobbyId])).rows).toEqual([]);
    expect(await tableCount("lobby_uploads")).toBe(0);
  });

  it("deleting an account hides its lobbies at once; the sweep deletes them", async () => {
    const owner = await newUser();
    const { code, lobbyId } = await lobbyBy(owner);
    await pg.query("DELETE FROM users WHERE id = $1", [owner.id]);
    as(null);
    expect(await joinLobby(code)).toEqual({ ok: false, error: "not-found" });
    await sweepExpired(db as never, new Date());
    expect((await pg.query("SELECT 1 FROM lobbies WHERE id = $1", [lobbyId])).rows).toEqual([]);
  });
});
