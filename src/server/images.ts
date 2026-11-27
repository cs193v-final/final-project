// Serves per-level puzzle images (#57). Server-only.
//
// GET /img/<id>.webp → the stored bytes. The id is 128 random bits; the server
// sends a level's URL only once the player has reached it (PublicRound.imageSrc),
// so knowing one URL never gives you another. Because an id always means the
// same bytes (re-cutting makes new ids), responses are cached for a year by
// browsers and the CDN, so most loads never reach this code.
//
// Custom lobby images (#67) are the exception: they're served only while
// their lobby can be played (not deleted, expired or hidden by reports), are
// decrypted here, and are never cached by the CDN, so deleting a lobby takes
// its photos down at once (a browser that loaded one keeps it for at most
// `LOBBY_IMAGE_MAX_AGE_SECONDS`). Because the CDN never caches them, each
// load is a function call, a database read and a decryption, so they're
// rate-limited per IP (`LOBBY_LIMITS.imagesPerIp`; a 429 over it).
import "server-only";

import { getVault, resolveVault, type VaultSource } from "@/crypto/vault";
import type { Db } from "@/db";
import { findServableImage } from "@/db/lobbies";
import { RateLimitedError } from "@/game/game-result";

import { requestIpHash } from "./games";
import { checkLobbyImageLimit } from "./limits";

const FILE_NAME = /^([0-9a-f]{32})\.webp$/;

/** A year, the longest cache lifetime browsers honour. */
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

/** How long one browser may keep a lobby image: about one game. */
export const LOBBY_IMAGE_MAX_AGE_SECONDS = 60 * 60;

function tooManyRequests(): Response {
  return new Response("Too many requests", {
    status: 429,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function notFound(): Response {
  // Not cached: an image that's missing now may be cut later under the same name.
  return new Response("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/**
 * The response for `GET /img/<file>`. Anything but `<32 hex>.webp` is a 404
 * before `connect` is even called, so junk requests never open a database client.
 *
 * `search` is the request's query string. Image URLs never have one, and the
 * CDN caches each query string separately, so `?n=1`, `?n=2`, … would each
 * skip the cache and read the image from the database (security audit M5,
 * #95). Any query string is a 404 without a database read.
 *
 * A lobby image that would be served first counts one hit on the client's IP
 * (`ipHash`, read only then, so seeded images never touch the request headers
 * or the counters); over `LOBBY_LIMITS.imagesPerIp` it's a 429, without decrypting.
 */
export async function imageResponse(
  connect: () => Db,
  file: string,
  search = "",
  vault: VaultSource = getVault,
  now = new Date(),
  ipHash: () => Promise<string | null> = requestIpHash,
): Promise<Response> {
  if (search !== "") return notFound();
  const id = FILE_NAME.exec(file)?.[1];
  if (id === undefined) return notFound();
  const db = connect();
  // The vault is only resolved for a lobby image that will be served.
  const image = await findServableImage(db, { decryptBytes: (...args) => resolveVault(vault).decryptBytes(...args) }, id, now);
  if (image === null || !image.playable) return notFound();
  if (image.lobby) {
    try {
      await checkLobbyImageLimit(db, await ipHash(), now);
    } catch (error) {
      if (error instanceof RateLimitedError) return tooManyRequests();
      throw error;
    }
  }
  const bytes = image.bytes();
  const caching: Record<string, string> = image.lobby
    ? // Private: only this browser, briefly, and never the CDN.
      { "Cache-Control": `private, max-age=${LOBBY_IMAGE_MAX_AGE_SECONDS}` }
    : {
        "Cache-Control": `public, max-age=${ONE_YEAR_SECONDS}, immutable`,
        // For Vercel's CDN, which caches on this header (or s-maxage), not on
        // max-age alone (security audit M6, #95).
        "CDN-Cache-Control": `max-age=${ONE_YEAR_SECONDS}`,
      };
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": image.contentType,
      "Content-Length": String(bytes.byteLength),
      ...caching,
      // Only ever an image: browsers mustn't guess another type, and other
      // sites can't embed it. next.config.ts also sends nosniff on every
      // response (#105); this one keeps the route safe on its own.
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
      // Puzzle images shouldn't turn up in image search.
      "X-Robots-Tag": "noindex",
    },
  });
}
