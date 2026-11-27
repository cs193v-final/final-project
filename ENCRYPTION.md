# ENCRYPTION

Our zoom-out project uses encryption and hashing to protect stored information. Account-related records include an encrypted username, a username lookup, a password hash, session-token hashes, rate-limit records, IDs, and timestamps.

Encryption can be reversed with the correct key. Hashing is one-way: instead of recovering the original value, the application verifies a supplied value against the stored hash. Hashing does not prevent someone from guessing possible inputs and checking them. Keyed hashes, or HMACs, also require a secret key.

Passwords are hashed with Argon2id in src/auth/crypto.ts. We do not store plaintext passwords or reversibly encrypt them. We use HMAC-SHA256 for username lookups, rate-limit identifiers based on IP addresses, login usernames and login devices, and device tokens. These keyed hashes let the application match values without storing the original values in those lookup fields.

We use AES-256-GCM for encryption. Each encryption uses a fresh random nonce, so encrypting the same value again produces a different encrypted result. GCM also produces an authentication tag that lets the application detect tampering and reject values that fail authentication. Encrypted values have a lowercase "v1" prefix identifying the current format.

Each environment has its own master key. Production and preview keys are stored in Vercel, while the development key is stored in .env.local. In src/crypto/vault.ts, HKDF-SHA256 derives separate keys for each user and encrypted field. The derivation binds both the user ID and field name, so copying an encrypted value into another user's row or a different encrypted field causes decryption to fail.

This design depends on protecting the master key. A stolen database alone does not provide the key needed to decrypt protected values. However, someone who obtains both the master key and the encrypted records could derive the keys needed to decrypt them. The application server has access to the active master key because it needs to read and write encrypted data.

We chose server-managed encryption so the server can use protected data without requiring users to enter their passwords each time. Password-derived encryption would have different access and recovery tradeoffs; it would not automatically make every part of the application more secure. Our application currently has no password-reset function.

Master-key backups are kept outside the repository. SECRETS.md documents how the keys are managed. Key rotation is a future plan, and there is currently no rotation script. The version prefix allows us to distinguish formats or key versions later. Rotating the key would require a migration that decrypts existing records with the old key and re-encrypts them with the new one.

Session tokens are stored as hashes in the database. The browser holds the original token in the zo_session cookie. That cookie uses HttpOnly, Secure, and SameSite=Lax. HttpOnly prevents browser JavaScript from reading the cookie through document.cookie, Secure restricts its transmission to HTTPS, and SameSite=Lax restricts when it accompanies cross-site requests. The server receives the token and checks it against the stored hash.

Anonymous players also receive a random token in a cookie. In src/server/owner.ts, the database stores only a SHA-256 hash of that token. This lets the server recognize returning anonymous players without storing their original cookie tokens.

Data is protected in transit using TLS. Browser-to-server traffic uses HTTPS, and server-to-database traffic also uses TLS. In src/db/tls.ts, the application refuses to connect without sslmode=require in the database connection configuration.

We encrypt game state so players can keep their progress after refreshing, including players who are not logged in. The state records guesses, zoom-out actions, and skips. Each game's encryption key is derived from the master key using that game's ID. The server also checks game ownership before allowing access. Encryption protects stored contents, while ownership checks determine who may access a game.

Some values remain unencrypted: record IDs, timestamps, total scores, and each round's points and correctness in game_rounds. These support record relationships, session expiration, leaderboard sorting, and game-result queries. They still reveal metadata and results, even though the detailed game state is encrypted.
