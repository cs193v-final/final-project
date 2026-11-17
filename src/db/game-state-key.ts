// How a game's state is encrypted (#84): which vault field, and whose key.
// No runtime imports, so the plain-Node backfill script
// (scripts/encrypt-game-states.ts) can load it as well as src/db/games.ts.
import type { GameOwner } from "../game/server-game.ts";

/** The vault field for a game's state. */
export const STATE_FIELD = "games.state";

/**
 * Whose key encrypts a game's state: its owner and the game itself, so a
 * state copied to another game or another owner doesn't decrypt.
 */
export function stateKeyId(owner: GameOwner, gameId: string): string {
  const who = "userId" in owner ? `user:${owner.userId}` : `anon:${owner.anonId}`;
  return `${who}/game:${gameId}`;
}
