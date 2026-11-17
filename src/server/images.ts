// Serves per-level puzzle images (#57). Server-only.
//
// GET /img/<id>.webp → the stored bytes. The id is 128 random bits; the server
// sends a level's URL only once the player has reached it (PublicRound.imageSrc),
// so knowing one URL never gives you another. Because an id always means the
// same bytes (re-cutting makes new ids), responses are cached for a year by
// browsers and the CDN, so most loads never reach this code.
import "server-only";

import { getImageFile, type AnyDb } from "@/db/images";

const FILE_NAME = /^([0-9a-f]{32})\.webp$/;

/** A year, the longest cache lifetime browsers honour. */
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

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
 */
export async function imageResponse(connect: () => AnyDb, file: string): Promise<Response> {
  const id = FILE_NAME.exec(file)?.[1];
  if (id === undefined) return notFound();
  const image = await getImageFile(connect(), id);
  if (image === null) return notFound();
  return new Response(new Uint8Array(image.bytes), {
    status: 200,
    headers: {
      "Content-Type": image.contentType,
      "Content-Length": String(image.bytes.byteLength),
      "Cache-Control": `public, max-age=${ONE_YEAR_SECONDS}, immutable`,
      // Only ever an image: browsers mustn't guess another type, and other
      // sites can't embed it.
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
      // Puzzle images shouldn't turn up in image search.
      "X-Robots-Tag": "noindex",
    },
  });
}
