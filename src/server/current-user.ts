// Who is logged in. Server-only.
import "server-only";

import type { PublicUser } from "@/game/types";

/**
 * The logged-in user for this request, or null.
 *
 * TODO(#53, Ethan): read the session cookie and look it up in `sessions`.
 * Until accounts exist nobody is logged in, so every game belongs to an
 * anonymous owner cookie (src/server/owner.ts). Once this returns a user,
 * their games are owned by `{ userId }` with no other change.
 */
export async function getCurrentUser(): Promise<PublicUser | null> {
  return null;
}
