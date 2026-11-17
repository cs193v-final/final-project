# Technical Overview

> As of Nov 10, 2026. Everything described here is on `main` and deployed to the live site.

## 1. Main pieces

How a turn works today: **player clicks or types → the React page sends an action → the game logic returns the new state plus scoring events → the page re-renders.** Everything runs in the browser. There's no server code or database access yet.

| Piece | Where | What it does |
|---|---|---|
| Web app (Next.js) | `src/app/` | Pages: `/` (start screen, `src/components/StartScreen.tsx`) and `/play` (the practice game, #25 and #35). |
| Game logic | `src/game/` | Plain TypeScript with no React or Next.js, so it's easy to test. `guess.ts` normalizes and checks guesses. `round.ts` is the round state machine (zoom out / guess / skip / next) and produces scoring events. `types.ts` holds the shared types from the brief. |
| Game UI | `src/components/game/` | `PracticeGame` holds the game state (`useReducer`). `GuessPanel` is the guess box, feedback and buttons (#25). |
| Puzzle data | `src/puzzles/sample.json`, `src/game/puzzles.ts`, `public/puzzles/` | Three sample puzzles with CC BY-SA photos and credits (#32). `puzzles.ts` checks the data and names the bad field when something is wrong. |
| Image viewer | `src/components/game/ImageViewer.tsx`, `ZoomOutButton.tsx`, crop math in `src/game/crop.ts` | Shows the tight crop and steps out one zoom level at a time (#30, #31). Added to `/play` in #35. |
| Scoring | `src/game/scoring.ts`, values in `scoring-config.ts` | Turns scoring events into points with a breakdown (#27). |
| Score screens | `src/components/game/LiveScore.tsx`, `FinalScore.tsx` | #37 (Ethan). The running total and what the current image is worth while playing; a final screen with each image's points math. |
| Database schema | `src/db/schema.ts`, migrations in `drizzle/`, client in `src/db/index.ts` | Tables for accounts, packs, puzzles, the daily schedule and server-side games (#47). Not used by any page yet. See [Database](#database-47). |
| CI and secret scanning | `.github/workflows/ci.yml`, `.githooks/` | Checks every PR. Blocks secrets at commit, push and in CI. |

## 2. Tools and services

| Tool | What it's for |
|---|---|
| **Next.js 16 + React 19 + TypeScript** | The web app. Picked because it deploys to Vercel with no setup and can talk to the database from server code later (#9). |
| **Tailwind CSS** | Styling |
| **Vitest + React Testing Library** | Unit tests and component tests |
| **ESLint** | Linting (Next.js rules) |
| **Vercel** | Hosting. One deploy owner (Jacky) because of free-tier limits. |
| **Neon Postgres** | Database. Three separate projects (dev / preview / prod). Schema and migrations exist (#47); no page queries it yet. |
| **Drizzle ORM + drizzle-kit** | Typed queries and SQL migrations (#47). Why: see [Database](#database-47). |
| **PGlite** | In-memory Postgres for tests: the migrations are applied to it in `npm test`, no network needed |
| **GitHub Actions** | CI: secret scan, hook tests, shellcheck, lint, typecheck, tests, build |
| **gitleaks** | Secret scanning in git hooks and CI |

## 3. Stored information

- **Nothing is stored yet.** Game state lives in the browser's memory and resets on reload. The tables below exist (#47) but no feature writes to them yet.
- Puzzles are a static JSON file plus images in `public/puzzles/`, shipped with the app.
- Later (open decision): daily progress, streaks, and possibly puzzles and accounts. Where and how they're stored is undecided (#21 and the brief's open decisions).

### Database (#47)

**Tables** (`src/db/schema.ts`; owners: Jacky and Joseph):

| Table | Holds | Keys and rules |
|---|---|---|
| `users` | username, `password_hash` | UUID id. Username unique ignoring case. No email column. |
| `sessions` | `token_hash`, `user_id`, `expires_at` | The cookie token is stored only as a hash (primary key). Deleted with the user. |
| `packs` | `kind` (practice / daily / stanford / lobby), title, theme, `scoring` (per-pack override, #64; NULL = default) | Opaque text id |
| `puzzles` | answer, accepted answers, full image, focus and zoom levels, credit, `ai_solved_level` (#56) | Opaque text id. Server-only. |
| `puzzle_images` | one image `src` per reveal level (#57) | (puzzle, level). Deleted with the puzzle. |
| `pack_puzzles` | a pack's puzzles in play order | (pack, position), 1-based; a puzzle at most once per pack. A puzzle in a pack can't be deleted. |
| `daily_schedule` | which pack is a day's daily challenge | `date` is the primary key, so one pack per day |
| `games` | a game: pack, owner (`user_id`, or `anon_owner_hash` if anonymous play is allowed), full `state` as JSON so a game resumes across requests (#54), `revision` (a save only applies if it hasn't changed, so two fast requests can't both update a game), `total`, `finished_at` | Deleted with the user. Never both owners. |
| `game_rounds` | one finished round, same fields as `RoundResult` | (game, position). Deleted with the game. |

Every timestamp is `timestamptz`. Lobbies come later (#67).

**Why Drizzle.** The schema is TypeScript, so queries are type-checked against it. Migrations are plain SQL files that drizzle-kit generates from the schema, so a reviewer reads exactly what will run. The runtime is small and has a first-class Neon driver, which suits Vercel functions. Prisma needs a generated client and its own schema language, and its migrations are harder to review. Kysely has no schema-to-migration tool, and raw SQL leaves every query untyped.

**How the app connects.** Only `src/db/index.ts` creates the client, and it imports `server-only`, so a Client Component that imports it fails the build. `getDb()` connects on first use with the pooled `DATABASE_URL` through Neon's HTTP driver; `next build` doesn't need the variable. ESLint and `src/db/boundary.test.ts` stop components, `src/game/` and `"use client"` files from importing `@/db`. Both `getDb()` and `drizzle.config.ts` refuse a connection string that doesn't require TLS (`src/db/tls.ts`, see [§4](#4-secrets-and-user-information)).

**Changing the schema.** Edit `src/db/schema.ts`, run `npm run db:generate`, and commit the new file in `drizzle/` with the change. Never edit a migration that has run anywhere; add a new one. `npm test` applies every migration to an empty in-memory Postgres (PGlite) and fails if the schema and the migrations disagree.

**How migrations reach each database.** Jacky (the deploy owner) runs them, with `npm run db:migrate` (drizzle-kit, over the direct `DATABASE_URL_UNPOOLED` connection). Each migration runs before the code that needs it is deployed, so write it so the code already deployed keeps working: add tables and columns; rename or drop only in a later PR.

| Database | When | Credentials |
|---|---|---|
| dev | When a PR with a migration is ready to merge. Anyone with dev access may also run it to try the PR. | `.env.local`, which `drizzle.config.ts` reads only if the variable isn't set in the shell |
| preview | Before deploying a preview of a PR that includes a migration | Typed at a hidden prompt for that one command, never saved in a file or shell history: `read -rs URL && DATABASE_URL_UNPOOLED="$URL" npm run db:migrate; unset URL`. The values live only in Vercel and the Neon console. |
| production | Right before merging the PR (`main` deploys to production), and only after it passed on preview | Same as preview, with the production value |

If a migration fails partway, don't edit it; fix forward with a new migration, or restore the Neon branch to a point in time before the migration.

## 4. Secrets and user information

- **Secrets we have:** only the database connection strings (`DATABASE_URL`, `DATABASE_URL_UNPOOLED`). No API keys.
  - **Dev:** in each person's `.env.local`, which is git-ignored and excluded from Vercel uploads (`.vercelignore`).
  - **Preview and production:** only in Vercel as **sensitive** environment variables. Never in files, chat or commits.
  - `.env.example` shows the variable names with placeholder values only.
- **Leak protection:** gitleaks pre-commit and pre-push hooks, plus a required CI secret scan on every PR. Custom rules catch Postgres URLs, `PGPASSWORD` and `.env` files. If a secret ever leaks, we rotate it first (steps are in `README.md`).
- **No `NEXT_PUBLIC_` database variables.** Next.js copies every `NEXT_PUBLIC_` variable into the browser's JavaScript. `src/db/env-names.test.ts` fails if a name with DATABASE, POSTGRES, NEON or a `PG...` part gets that prefix anywhere in `src/`, `.github/`, the root `*.config.*` files or `.env.example` (it never reads `.env.local`).
- **Only server code reaches the database.** `src/db/index.ts` imports `server-only`; ESLint (`src/components/**`, `src/game/**`) and `src/db/boundary.test.ts` (those folders plus every `"use client"` file, `@/db` and relative imports) block client code from importing `src/db`.

### TLS on every database connection (#60)

- `getDb()` (the app) and `drizzle.config.ts` (migrations) both call `assertDatabaseUrlRequiresTls` in `src/db/tls.ts` before connecting. It accepts `sslmode=require`, `verify-ca` or `verify-full` (Neon's `channel_binding=require` may stay), and rejects a missing `sslmode` and `disable`, `allow` or `prefer`, since libpq's default (`prefer`) quietly falls back to plain text.
- **Exemption:** a database on this machine (host `localhost`, `127.0.0.1` or `::1`, every host if several are given) may connect without TLS, for the Postgres service container in CI (#54). Its traffic never leaves the machine. Lookalikes such as `localhost.evil.com` are not exempt.
- Error messages name the variable and the reason, never the connection string, user, host or password (tested in `src/db/tls.test.ts`).
- Neon's HTTP driver sends queries over HTTPS in any case; the check also covers drizzle-kit, and stops a wrong URL from being used anywhere.

### What we store about users

Nothing is written yet: no feature uses these tables until accounts (#53) and server-side games (#54) land. This is what the schema (`src/db/schema.ts`) will hold, and how each item is protected. No email, real name, IP address or other personal detail is stored.

| Data | Column(s) | How it's protected | Who can read it |
|---|---|---|---|
| Username | `users.username` | Stored as typed, not hashed or encrypted (the app needs to display it). Unique ignoring case. Whether other players see it (e.g. on leaderboards, #62) is not decided. | The server and the user; others only if a feature decides to show it |
| Password | `users.password_hash` | Only a salted hash is stored, never the password (schema comment and the "store only hashes" test). **PLANNED (#53):** the algorithm (argon2id or bcrypt) and its parameters. | The server only, to check a login. Never sent to a browser. |
| Session | `sessions.token_hash`, `user_id`, `created_at`, `expires_at` | The cookie holds a random token; the database holds only its hash (e.g. SHA-256), so a database leak doesn't hand out live sessions. **PLANNED (#53):** token generation, the hash, cookie flags (`HttpOnly`, `Secure`, `SameSite`), expiry and logout, and rate limiting on login and sign-up. | The server only |
| Games and rounds | `games.*` (owner, `state`, `total`, timestamps), `game_rounds.*` (outcome, points, wrong guesses, reveal level, `finished_at`) | `state` is server-only and never sent to the browser. **PLANNED (#54):** every read or write checks that the game belongs to the requesting user or anonymous owner. What leaderboards (#62) show is not decided. | The server and, once #54 lands, the game's owner only |
| Anonymous owner | `games.anon_owner_hash` | Only a hash of an anonymous-player cookie, never the cookie value. Whether anonymous play exists at all is open (#54/#62). | The server only |
| Timestamps | `created_at` on users, sessions and games; `updated_at` on games; `finished_at` on games and rounds; `expires_at` on sessions | Same as the row they belong to | Same as the row |

Protection that applies to all of it, **in place now**:

- **Server-only access:** see above (`server-only`, ESLint rule, boundary test). Only Route Handlers, Server Actions and Server Components may query it.
- **TLS in transit:** enforced in code, see above.
- **Encrypted at rest:** Neon encrypts stored data at rest. Three separate Neon projects (dev, preview, prod), so dev work never touches real data.
- **Deleted with the account:** deleting a `users` row deletes its sessions, games and their rounds (`ON DELETE CASCADE`, tested in `src/db/schema.test.ts`). **PLANNED (#53):** a way for a user to delete their account.
- **Who holds the keys:** connection strings are in the dev `.env.local` files and, for preview and production, only in Vercel (sensitive) and the Neon console, set by Jacky as the deploy owner (see above).

**Not done yet** (needs #53 and #54 code): per-user access tests for games and sessions, and checks that no response or page source contains answers while a round is playing, or another user's data. We don't encrypt individual columns in the app: passwords and tokens are hashed instead (they never need to be read back), and the rest (usernames, game results) has to be read back by the app, so it relies on server-only access, TLS and Neon's encryption at rest.

## 5. Open questions

| Question | Next step |
|---|---|
| Schema is in the repo (#47) but nothing queries it yet | Packs and the seed script (#52), then server-side games (#54). Anonymous play and image storage are still open. |
| Scoring values and wrong-guess rules (#21) | Playtest the three-image prototype (notes in `PLAYTEST.md`), then change the values in `src/game/scoring-config.ts` |
| Number of reveal steps; typo tolerance | Decide after the playtest. The code already accepts a pluggable answer matcher. |
| Image sourcing and licenses | The three sample photos are CC BY-SA, with credits in the data (#32) and shown after each round (#35). Open: where to source daily puzzles, and neutral file names so they don't give the answer away (#36) |
| Daily reset time and time zone | Decide before building the daily challenge (Week 9+) |
| Keeping the code easy to change with four people working at once | Fewer stacked PRs, smaller PRs merged sooner, and asking staff for advice (see `PROGRESS.md` §3) |
| How to make the game more interesting and grow its scope | Playtest first, then pick features (daily challenge, streaks, sharing) based on what players enjoy |
