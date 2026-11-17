// How a game's state is encrypted (#84): which vault field, and which key.
// No imports, so the plain-Node backfill script (scripts/encrypt-game-states.ts)
// and src/db/games.ts use the same code and can't drift apart.

/** The vault field for a game's state. */
export const STATE_FIELD = "games.state";

/**
 * Whose key encrypts a game's state: the game's own id, which never changes.
 * A state copied to another game's row doesn't decrypt. The owner isn't part
 * of the key: it never changes either, and `server-game` checks it on every
 * call. Lowercased, because Postgres returns uuids in lowercase and an id
 * given in uppercase must give the same key.
 */
export function stateKeyId(gameId: string): string {
  return `game:${gameId.toLowerCase()}`;
}
