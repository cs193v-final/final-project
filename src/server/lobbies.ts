// Custom lobbies on the server (#67): what the lobby Server Actions
// (src/app/lobby/actions.ts) and the upload route (src/app/api/lobby-uploads)
// call. Server-only. Every argument from the browser is untrusted; the user
// and owner come from cookies; nothing returned contains an answer or a
// code index.
//
//   upload a photo  → POST /api/lobby-uploads (login, re-encoded, encrypted)
//   create          → createLobbyForUser(rounds)     login, 3-5 uploads → code
//   join            → joinLobby(code)                 anyone with the code
//   play            → startLobbyGame(code), then /play's actAction / getGameAction
//   leaderboard     → lobbyLeaderboard(code)
//   own lobbies     → myLobbies(), deleteMyLobby(id)  login, owner only
//   report          → reportLobby(code)               anyone; hidden at REPORTS_TO_HIDE
//
// Every call is rate-limited per IP and per owner (`LOBBY_LIMITS`), and what
// they store is capped (`LOBBY_CAPS`).
import "server-only";

import { connection } from "next/server";

import { getCurrentUser } from "@/auth/session";
import { getVault } from "@/crypto/vault";
import { getDb, type Db } from "@/db";
import {
  createLobby,
  deleteUploads,
  findPlayableLobby,
  getLobbyBoard,
  getUploads,
  insertUpload,
  listOwnLobbies,
  lobbyPack,
  markLobbyDeleted,
  purgeLobby,
  reportLobby as recordReport,
  type LobbyBoard,
  type PlayableLobby,
} from "@/db/lobbies";
import { getScoringConfig } from "@/db/scoring";
import { RateLimitedError, runGameCall, type GameResult } from "@/game/game-result";
import {
  formatLobbyCode,
  InvalidLobbyError,
  newLobbyCode,
  normalizeLobbyCode,
  parseLobbyRounds,
  REPORTS_TO_HIDE,
  type LobbyError,
  type LobbyFailure,
  type LobbySummary,
  type OwnLobby,
} from "@/game/lobby";
import { errorForLog } from "@/game/log-safe";
import { GameNotFoundError } from "@/game/server-game";

import { requestIpHash, startOrReuseGame } from "./games";
import { checkLobbyLimits, checkStartLimits, LOBBY_CAPS, ownerKey } from "./limits";
import { cutLobbyLevels, MAX_UPLOAD_BYTES, reencodeUpload, UploadRefusedError } from "./lobby-images";
import { currentOrNewOwner, currentOwner } from "./owner";

export type LobbyResult<T> = ({ ok: true } & T) | LobbyFailure;

class LobbyCallError extends Error {
  constructor(readonly code: LobbyError) {
    super(code);
    this.name = "LobbyCallError";
  }
}

/** Runs a lobby call and turns known errors into codes; anything else is logged without values (#60) and is `unavailable`. */
async function runLobbyCall<T>(call: () => Promise<T>): Promise<({ ok: true } & T) | LobbyFailure> {
  try {
    return { ok: true, ...(await call()) };
  } catch (error) {
    if (error instanceof LobbyCallError) return { ok: false, error: error.code };
    if (error instanceof RateLimitedError) return { ok: false, error: "rate-limited" };
    if (error instanceof InvalidLobbyError) return { ok: false, error: "invalid" };
    if (error instanceof UploadRefusedError) return { ok: false, error: error.reason };
    console.error("lobby call failed:", JSON.stringify(errorForLog(error)));
    return { ok: false, error: "unavailable" };
  }
}

async function requireUserId(): Promise<string> {
  const user = await getCurrentUser();
  if (user === null) throw new LobbyCallError("login-required");
  return user.id;
}

/** The playable lobby a code opens, after counting one lookup. Throws `not-found` for anything else. */
async function lookUp(db: Db, code: unknown, owner: Awaited<ReturnType<typeof currentOwner>>, now: Date): Promise<PlayableLobby> {
  await checkLobbyLimits(db, "lookups", owner, await requestIpHash(), now);
  const normalized = normalizeLobbyCode(code);
  const lobby = normalized === null ? null : await findPlayableLobby(db, getVault(), normalized, now);
  if (lobby === null) throw new LobbyCallError("not-found");
  return lobby;
}

// ---------------------------------------------------------------------------
// Upload (Route Handler)
// ---------------------------------------------------------------------------

const UPLOAD_STATUS: Record<LobbyError, number> = {
  "login-required": 401,
  invalid: 400,
  "not-found": 404,
  "rate-limited": 429,
  "cap-reached": 409,
  "unsupported-image": 415,
  "too-large": 413,
  unavailable: 503,
};

/**
 * Same-origin only: a Route Handler doesn't get the Origin check Server
 * Actions have, so do it here. Browsers always send Origin on a POST.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (origin === null || host === null) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Reads at most `max` bytes of the body; more is `too-large` without reading the rest. */
async function readCapped(request: Request, max: number): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > max) throw new UploadRefusedError("too-large");
  if (request.body === null) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new UploadRefusedError("too-large");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    body.set(chunk, at);
    at += chunk.byteLength;
  }
  return body;
}

/**
 * `POST /api/lobby-uploads`: the body is one photo's bytes (not a form).
 * Login required. Answers `{ ok: true, uploadId, width, height }` or
 * `{ ok: false, error }` with a matching status. The photo is re-encoded
 * with no metadata before anything is stored.
 */
export async function uploadLobbyPhoto(request: Request, now = new Date()): Promise<Response> {
  const result = await runLobbyCall(async () => {
    if (!isSameOrigin(request)) throw new LobbyCallError("invalid");
    const userId = await requireUserId();
    const db = getDb();
    await checkLobbyLimits(db, "uploads", { userId }, await requestIpHash(), now);
    const photo = await reencodeUpload(await readCapped(request, MAX_UPLOAD_BYTES));
    const uploadId = await insertUpload(db, getVault(), userId, photo, { perUser: LOBBY_CAPS.uploadsPerUser, totalBytes: LOBBY_CAPS.uploadBytesTotal }, now);
    if (uploadId === null) throw new LobbyCallError("cap-reached");
    return { uploadId, width: photo.width, height: photo.height };
  });
  return Response.json(result, {
    status: result.ok ? 200 : UPLOAD_STATUS[result.error],
    headers: { "Cache-Control": "no-store" },
  });
}

// ---------------------------------------------------------------------------
// Server Action backends
// ---------------------------------------------------------------------------

/**
 * Creates a lobby from 3-5 of the user's uploads. Returns the share code
 * (formatted, e.g. `7KQ2-M9XD-0A1B-ZZ34`) once; the owner can see it again
 * in `myLobbies`. Uses up the uploads.
 */
export async function createLobbyForUser(
  rounds: unknown,
  now = new Date(),
): Promise<LobbyResult<{ lobbyId: string; code: string; expiresAt: string }>> {
  await connection();
  return runLobbyCall(async () => {
    const userId = await requireUserId();
    const parsed = parseLobbyRounds(rounds);
    const db = getDb();
    await checkLobbyLimits(db, "creates", { userId }, await requestIpHash(), now);
    const vault = getVault();
    const ids = parsed.map((r) => r.uploadId);
    const uploads = await getUploads(db, vault, userId, ids);
    // Every upload must be this user's, and still there.
    if (uploads.size !== ids.length) throw new LobbyCallError("invalid");
    const cut = [];
    for (const round of parsed) {
      cut.push({ ...round, levels: await cutLobbyLevels(uploads.get(round.uploadId)!.bytes, round.focus) });
    }
    const code = newLobbyCode();
    const created = await createLobby(db, vault, {
      ownerUserId: userId,
      code,
      rounds: cut,
      caps: { perUser: LOBBY_CAPS.lobbiesPerUser, total: LOBBY_CAPS.lobbiesTotal, totalImageBytes: LOBBY_CAPS.lobbyImageBytes },
      now,
    });
    if (created === null) throw new LobbyCallError("cap-reached");
    await deleteUploads(db, userId, ids);
    return { lobbyId: created.lobbyId, code: formatLobbyCode(code), expiresAt: created.expiresAt.toISOString() };
  });
}

/** What a player sees after typing a code: how many photos, until when, and whether it's theirs. */
export async function joinLobby(code: unknown, now = new Date()): Promise<LobbyResult<{ lobby: LobbySummary }>> {
  await connection();
  return runLobbyCall(async () => {
    const owner = await currentOwner();
    const lobby = await lookUp(getDb(), code, owner, now);
    const yours = owner !== null && "userId" in owner && owner.userId === lobby.ownerUserId;
    return { lobby: { puzzleCount: lobby.puzzleIds.length, expiresAt: lobby.expiresAt.toISOString(), yours } };
  });
}

/**
 * Starts (or resumes) the current owner's game of the lobby `code` opens,
 * creating the anonymous owner cookie if needed, like practice. Counts as a
 * lookup and as a game start. Moves then go through /play's `actAction`; a
 * lobby that's deleted, expires or is hidden mid-game ends it as `not-found`.
 * Only logged-in players' games count for the lobby's leaderboard.
 */
export async function startLobbyGame(code: unknown, now = new Date()): Promise<GameResult> {
  await connection();
  return runGameCall(async () => {
    const owner = await currentOrNewOwner();
    const db = getDb();
    let lobby: PlayableLobby;
    try {
      lobby = await lookUp(db, code, owner, now);
    } catch (error) {
      if (error instanceof LobbyCallError) throw new GameNotFoundError();
      throw error;
    }
    await checkStartLimits(db, owner, await requestIpHash(), now);
    return startOrReuseGame(db, owner, lobbyPack(lobby), () => getScoringConfig(lobby.packId));
  });
}

/** The lobby's leaderboard and the current player's own entry. */
export async function lobbyLeaderboard(code: unknown, now = new Date()): Promise<LobbyResult<{ board: LobbyBoard }>> {
  await connection();
  return runLobbyCall(async () => {
    const owner = await currentOwner();
    const db = getDb();
    const lobby = await lookUp(db, code, owner, now);
    const userId = owner !== null && "userId" in owner ? owner.userId : null;
    return { board: await getLobbyBoard(db, getVault(), lobby.packId, userId) };
  });
}

/** The current user's lobbies (not deleted or expired), with their codes. */
export async function myLobbies(now = new Date()): Promise<LobbyResult<{ lobbies: OwnLobby[] }>> {
  await connection();
  return runLobbyCall(async () => {
    const userId = await requireUserId();
    const db = getDb();
    await checkLobbyLimits(db, "manage", { userId }, await requestIpHash(), now);
    const lobbies = await listOwnLobbies(db, getVault(), userId, now);
    return { lobbies: lobbies.map((l) => ({ ...l, code: formatLobbyCode(l.code) })) };
  });
}

/**
 * Deletes one of the current user's lobbies: hidden from everyone at once,
 * then its games, photos and answers are deleted. If that stops partway the
 * daily sweep finishes it. Someone else's lobby is `not-found`.
 */
export async function deleteMyLobby(lobbyId: unknown, now = new Date()): Promise<LobbyResult<Record<never, never>>> {
  await connection();
  return runLobbyCall(async () => {
    const userId = await requireUserId();
    const db = getDb();
    await checkLobbyLimits(db, "manage", { userId }, await requestIpHash(), now);
    if (typeof lobbyId !== "string" || !(await markLobbyDeleted(db, lobbyId, userId, now))) throw new LobbyCallError("not-found");
    try {
      await purgeLobby(db, lobbyId);
    } catch (error) {
      // Already hidden; the sweep (purgeDeadLobbies) finishes it.
      console.error("lobby purge stopped partway:", JSON.stringify(errorForLog(error)));
    }
    return {};
  });
}

/**
 * Reports the lobby `code` opens. Anyone may report (an anonymous player gets
 * the owner cookie, so each browser counts once); reporting your own lobby
 * does nothing. At `REPORTS_TO_HIDE` distinct reports it's hidden from
 * everyone until reviewed. `hidden` says whether it is now.
 */
export async function reportLobby(code: unknown, now = new Date()): Promise<LobbyResult<{ hidden: boolean }>> {
  await connection();
  return runLobbyCall(async () => {
    const owner = await currentOrNewOwner();
    const db = getDb();
    await checkLobbyLimits(db, "reports", owner, await requestIpHash(), now);
    const lobby = await lookUp(db, code, owner, now);
    if ("userId" in owner && owner.userId === lobby.ownerUserId) return { hidden: false };
    const { hidden } = await recordReport(db, getVault(), lobby.id, ownerKey(owner), REPORTS_TO_HIDE, now);
    return { hidden };
  });
}
