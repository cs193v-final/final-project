// How a user's row is built and found (#84): the encrypted username and the
// keyed hash that login looks it up by. Shared by `register` (./accounts.ts)
// and the test-user script, so the two can't drift apart. No side effects and
// no app imports: the script runs it with plain Node, so imports are relative
// with `.ts`.
import { randomUUID } from "node:crypto";

import type { Vault } from "../crypto/vault.ts";
import { usernameKey } from "./rules.ts";

/** The vault field for usernames. Changing it makes every stored username unreadable. */
export const USERNAME_FIELD = "users.username";
/** The keyed-hash purpose for usernames. Changing it breaks login and uniqueness for every existing user. */
const USERNAME_PURPOSE = "users.username";

/** The keyed hash that login looks up and that keeps usernames unique, ignoring case. */
export const usernameIndex = (vault: Vault, username: string): string =>
  vault.blindIndex(USERNAME_PURPOSE, usernameKey(username));

/**
 * A new user's row, ready for `insertUser`. The id is chosen here, because the
 * username is encrypted with a key derived from it. `username` must already
 * pass `checkUsername`, and `passwordHash` must come from `hashPassword`.
 */
export function newUserRow(vault: Vault, username: string, passwordHash: string) {
  const id = randomUUID();
  return {
    id,
    usernameEncrypted: vault.encrypt(id, USERNAME_FIELD, username),
    usernameIndex: usernameIndex(vault, username),
    passwordHash,
  };
}
