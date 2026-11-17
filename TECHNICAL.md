# Technical Overview

> As of Nov 10, 2026. Everything described here is on `main` and deployed to the live site.

## 1. Main pieces

How a turn works (#54): **player clicks or types → the browser calls a Server Action with a `GameAction` → the game service on the server loads the game from Postgres, applies the action with the round logic, scores it, and saves it → the browser gets back a `GameView` and re-renders.** The browser never has the answers: `GameView` has no answer or accepted answers until the round has ended, and scores are worked out only on the server.

```
browser (PracticeGame)                          server
  GameAction ──► Server Action (src/app/play/actions.ts)
                   └─► src/server/games.ts      owner from the cookie, practice pack, error codes
                         └─► src/game/server-game.ts   round.ts + guess.ts + scoring.ts, builds the GameView
                               └─► PgGameStore (src/db/games.ts) ──► Postgres `games`
  GameView  ◄────────────────────────────────────┘ (or an error code: not-found / invalid / conflict / unavailable)
```

| Piece | Where | What it does |
|---|---|---|
| Web app (Next.js) | `src/app/` | Pages: `/` (start screen, `src/components/StartScreen.tsx`) and `/play` (the practice game, #25 and #35). `/play?game=<id>` resumes a game after a refresh. |
| Game logic | `src/game/` | Plain TypeScript with no React or Next.js, so it's easy to test. `guess.ts` normalizes and checks guesses. `round.ts` is the round state machine (zoom out / guess / skip / next) and produces scoring events. `types.ts` holds the shared types from the brief. Runs on the server only, since #54. |
| Server-side games | `src/game/server-game.ts`, `src/server/`, `src/app/play/actions.ts` | #54. `server-game.ts` is the framework-free service (`startGame` / `act` / `getGame`, the `GameView` projection, input checks). `src/server/games.ts` wires it to the database, the practice pack and the owner cookie (`src/server/owner.ts`). The Server Actions are the only way the browser reaches it. |
| Game UI | `src/components/game/` | `PracticeGame` renders the `GameView` it gets from the server and sends `GameAction`s; it imports no puzzle data and no game logic (`src/components/client-imports.test.ts` checks). `GuessPanel` is the guess box, feedback and buttons (#25). |
| Puzzle data | `src/puzzles/sample.json`, `src/game/puzzles.ts`, `public/puzzles/` | Three sample puzzles with CC BY-SA photos and credits (#32). `puzzles.ts` checks the data and names the bad field when something is wrong. |
| Image viewer | `src/components/game/ImageViewer.tsx`, `ZoomOutButton.tsx`, crop math in `src/game/crop.ts` | Shows the tight crop and steps out one zoom level at a time (#30, #31). Added to `/play` in #35. |
| Scoring | `src/game/scoring.ts`, values in `scoring-config.ts` | Turns scoring events into points with a breakdown (#27). |
| Score screens | `src/components/game/LiveScore.tsx`, `FinalScore.tsx` | #37 (Ethan). The running total and what the current image is worth while playing; a final screen with each image's points math. |
| Database | `src/db/schema.ts`, migrations in `drizzle/`, client in `src/db/index.ts`, game store in `src/db/games.ts` | Tables for accounts, packs, puzzles, the daily schedule and server-side games (#47). `/play` stores its games in `games` (#54). See [Database](#database-47). |
| CI and secret scanning | `.github/workflows/ci.yml`, `.githooks/` | Checks every PR. Blocks secrets at commit, push and in CI. |

## 2. Tools and services

| Tool | What it's for |
|---|---|
| **Next.js 16 + React 19 + TypeScript** | The web app. Picked because it deploys to Vercel with no setup and can talk to the database from server code later (#9). |
| **Tailwind CSS** | Styling |
| **Vitest + React Testing Library** | Unit tests and component tests |
| **ESLint** | Linting (Next.js rules) |
| **Vercel** | Hosting. One deploy owner (Jacky) because of free-tier limits. |
| **Neon Postgres** | Database. Three separate projects (dev / preview / prod). `/play` keeps its games there (#54). |
| **node-postgres (`pg`)** | Only for a Postgres on the same machine: the CI e2e job's service container, or a local Postgres for e2e runs. Also what `drizzle-kit migrate` uses. See "How the app connects" below. |
| **Drizzle ORM + drizzle-kit** | Typed queries and SQL migrations (#47). Why: see [Database](#database-47). |
| **PGlite** | In-memory Postgres for tests: the migrations are applied to it in `npm test`, no network needed |
| **Playwright** | End-to-end tests in a real (headless) browser, against a real Postgres (`e2e/`) |
| **GitHub Actions** | CI: secret scan, hook tests, shellcheck, lint, typecheck, tests, build, and the e2e tests with a Postgres service container |
| **gitleaks** | Secret scanning in git hooks and CI |

## 3. Stored information

- **Games** (#54): every practice game is a row in `games`: the round state, every scoring event and the scoring config it started with (`state`, JSON), plus `revision`, `total` and `finished_at`, which the store keeps in sync. No answers: puzzles are referenced by id. `game_rounds` isn't written yet, because its rows reference `puzzles` and the practice puzzles are still in code (#52).
- **Who owns a game:** a logged-in user (`user_id`, once accounts exist, #53), or an anonymous owner cookie. On the first game the server sets `zo_owner`: a random 32-byte token (base64url), `HttpOnly`, `SameSite=Lax`, `Path=/`, one year, and `Secure` whenever the request came in over https (from `X-Forwarded-Proto`, which Next fills in from the connection when no proxy has). Over plain http (local dev, e2e, a phone on the LAN) it's left off, because the browser would drop a Secure cookie there. Only its SHA-256 is used as the owner id and stored (`anon_owner_hash`), so the database can't be used to act on someone's games. Anyone without the cookie, or with another one, gets "not found" for that game. Whether anonymous players may play the *daily* puzzles is still open (#54, #62); today only the practice pack exists.
- **Puzzles** are still a static JSON file plus images in `public/puzzles/`, shipped with the app but read only by server code since #54. They move to the database with packs (#52). Until then, and until per-level images (#57), the image path (`/puzzles/giraffe.jpg`) and the puzzle ids in finished rounds' results still name some answers.
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

**How the app connects.** Only `src/db/index.ts` creates the client, and it imports `server-only`, so a Client Component that imports it fails the build. `getDb()` connects on first use with the pooled `DATABASE_URL`; `next build` doesn't need the variable. ESLint and `src/db/boundary.test.ts` stop components, `src/game/` and `"use client"` files from importing `@/db`.

The driver depends on the host in `DATABASE_URL` (#54):
- **Neon** (any other host: dev, preview, production): Neon's HTTP driver, one HTTP request per query, nothing to keep open between serverless invocations.
- **localhost / 127.x / ::1**: node-postgres (`pg`) over TCP. Neon's HTTP driver only talks to Neon's HTTP endpoint, so it can't reach the plain Postgres in the CI e2e job or on a laptop. We picked this over running Neon's WebSocket proxy next to a local Postgres: one small, standard dependency, no extra container, and the same code path for CI and local runs. A loopback database never leaves the machine, so it doesn't need TLS.

Neither driver's extras are used (`db.batch` is Neon-only; interactive transactions are `pg`-only), so writes that must happen together are one SQL statement. A game save is `UPDATE games ... WHERE id = $1 AND revision = $2` (plus a CTE for `game_rounds`); when no row matches, another request (e.g. a second tab) saved first. The action is then **not** applied or retried, since that would apply it to a game state the player never saw; the action returns `conflict`, and the browser reloads the game with `getGameAction` and tells the player. The browser also sends one move at a time: controls are marked disabled until the last move's result is back.

In development `getDb()` keeps its client on `globalThis`, so hot reload doesn't open a new node-postgres pool on every edit.

**Running /play locally and the e2e tests.** `/play` needs a migrated database in `DATABASE_URL`. `npm run dev` reads your dev Neon database from `.env.local`. Or use a Postgres on your machine (`DATABASE_URL=postgresql://postgres@127.0.0.1:5432/zoomout`, then `DATABASE_URL_UNPOOLED=<same> npm run db:migrate`); a variable set in the shell wins over `.env.local`. `npm run test:e2e` starts the app with the same environment. CI does exactly this with a `postgres` service container.

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
- **User information:** no accounts, names or emails yet. The only thing that identifies a visitor is the anonymous owner cookie (#54): a random token, stored on the server only as its SHA-256. When accounts land (#53), the database stores a username and a password hash only, and sessions only as token hashes; `getCurrentUser()` in `src/server/current-user.ts` is where #53 plugs in.
- **Encrypting database contents:**
  - Connections to Neon require TLS (`sslmode=require&channel_binding=require`).
  - Neon encrypts stored data at rest.
  - Before we store anything about users, we'll encrypt sensitive fields in the app before saving them. If we add accounts, passwords will be hashed and salted, never stored as-is. We'll revisit this plan when we design what gets stored.

## 5. Open questions

| Question | Next step |
|---|---|
| Puzzles are still in code, and image paths and sample ids name answers | Packs and the seed script (#52) move puzzles to the database with opaque ids; per-level images (#57) stop sending the full image. Then remove the masking in `e2e/practice.spec.ts` and the `.fails` in `server-game.test.ts`. Anonymous play for daily packs is still open. |
| Scoring values and wrong-guess rules (#21) | Playtest the three-image prototype (notes in `PLAYTEST.md`), then change the values in `src/game/scoring-config.ts` |
| Number of reveal steps; typo tolerance | Decide after the playtest. The code already accepts a pluggable answer matcher. |
| Image sourcing and licenses | The three sample photos are CC BY-SA, with credits in the data (#32) and shown after each round (#35). Open: where to source daily puzzles, and neutral file names so they don't give the answer away (#36) |
| Daily reset time and time zone | Decide before building the daily challenge (Week 9+) |
| Keeping the code easy to change with four people working at once | Fewer stacked PRs, smaller PRs merged sooner, and asking staff for advice (see `PROGRESS.md` §3) |
| How to make the game more interesting and grow its scope | Playtest first, then pick features (daily challenge, streaks, sharing) based on what players enjoy |
