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

- **Games** (#54): every practice game is a row in `games`: the round state, every scoring event and the scoring config it started with (`state`, JSON), plus `revision`, `total` and `finished_at`, which the store keeps in sync. No answers: puzzles are referenced by id. `game_rounds` isn't written yet: its rows reference `puzzles`, and /play still reads the practice puzzles from the repo (below).
- **Who owns a game:** a logged-in user (`user_id`, once accounts exist, #53), or an anonymous owner cookie. On the first game the server sets `zo_owner`: a random 32-byte token (base64url), `HttpOnly`, `SameSite=Lax`, `Path=/`, one year, and `Secure` whenever the request came in over https (from `X-Forwarded-Proto`, which Next fills in from the connection when no proxy has). Over plain http (local dev, e2e, a phone on the LAN) it's left off, because the browser would drop a Secure cookie there. Only its SHA-256 is used as the owner id and stored (`anon_owner_hash`), so the database can't be used to act on someone's games. Anyone without the cookie, or with another one, gets "not found" for that game. Whether anonymous players may play the *daily* puzzles is still open (#54, #62); today only the practice pack exists.
- **Practice puzzles:** /play plays #52's practice pack (`PRACTICE_PACK`, id `pk_3f9c2a7e51d84b06`, from `src/puzzles/practice-pack.json`) and reads its puzzles from the repo copy (`SAMPLE_PUZZLES`), read only by server code since #54. That way /play works on a database that is migrated but not seeded: the app inserts the pack's `packs` row on first use (`ON CONFLICT DO NOTHING`), and the seed script upserts the same row and adds `puzzles` and `pack_puzzles`, so there is one practice pack either way. Reading the puzzles from the database (and then writing `game_rounds`) is a follow-up. Ids and image names are opaque since #52; the full image is still sent until per-level images (#57).
- **Packs and puzzles:** since #52 the seed script loads packs, puzzles and the daily schedule into Neon (see [Content and the seed script](#content-and-the-seed-script-52)). Daily, Stanford and lobby content exists only there, never in the repo.
- **Not stored yet:** accounts and sessions (in review, #53), daily games (in review, #58) and streaks (the logic is merged, #63; the query waits for #53 and #58). Each one updates this section when it lands.

### Database (#47)

**Tables** (`src/db/schema.ts`; owners: Jacky and Joseph):

| Table | Holds | Keys and rules |
|---|---|---|
| `users` | username, `password_hash` | UUID id. Username unique ignoring case. No email column. |
| `sessions` | `token_hash`, `user_id`, `expires_at` | The cookie token is stored only as a hash (primary key). Deleted with the user. |
| `packs` | `kind` (practice / daily / stanford / lobby), title, theme, `scoring` (per-pack override, #64; NULL = default) | Opaque text id |
| `puzzles` | answer, accepted answers, full image, focus and zoom levels, credit, `ai_solved_level` (#56) | Opaque text id. Server-only. `zoom_levels` must have at least 2 levels, each a finite number ≥ 1, ending at 1 (the full image), like `parsePuzzles` requires (follow-up A from the #74 review). That each level is smaller than the one before can't be a CHECK, so it stays in the loader, which the seed script (#52) runs on every puzzle. |
| `puzzle_images` | one image `src` per reveal level (#57): the URL the browser loads, `/img/<id>.webp` | (puzzle, level), `level` ≥ 0 and 0-based like `zoom_levels`. The upper bound (below the number of zoom levels) isn't a CHECK because it depends on the puzzle row, so `saveLevelImages` (#57) checks it. Deleted with the puzzle. |
| `image_files` | the bytes of each cut level image (WebP), width, height (#57) | Random 32-hex id, which is the secret part of the URL. Deleted with the puzzle. |
| `pack_puzzles` | a pack's puzzles in play order | (pack, position), 1-based; a puzzle at most once per pack. A puzzle in a pack can't be deleted. |
| `daily_schedule` | which pack is a day's daily challenge | `date` is the primary key, so one pack per day |
| `games` | a game: pack, owner (`user_id`, or `anon_owner_hash` if anonymous play is allowed), full `state` as JSON so a game resumes across requests (#54), `revision` (a save only applies if it hasn't changed, so two fast requests can't both update a game), `total`, `finished_at` | Deleted with the user. Never both owners. |
| `game_rounds` | one finished round, same fields as `RoundResult` | (game, position). Deleted with the game. |

Every timestamp is `timestamptz`. Lobbies come later (#67).

**Why Drizzle.** The schema is TypeScript, so queries are type-checked against it. Migrations are plain SQL files that drizzle-kit generates from the schema, so a reviewer reads exactly what will run. The runtime is small and has a first-class Neon driver, which suits Vercel functions. Prisma needs a generated client and its own schema language, and its migrations are harder to review. Kysely has no schema-to-migration tool, and raw SQL leaves every query untyped.

**How the app connects.** Only `src/db/index.ts` creates the client, and it imports `server-only`, so a Client Component that imports it fails the build. `getDb()` connects on first use with the pooled `DATABASE_URL`; `next build` doesn't need the variable. ESLint and `src/db/boundary.test.ts` stop components, `src/game/` and `"use client"` files from importing `@/db`. Both `getDb()` and `drizzle.config.ts` (and the seed script) refuse a connection string that doesn't require TLS (`src/db/tls.ts`, see [§4](#4-secrets-and-user-information)), and they check that before choosing a driver.

The driver depends on the host in `DATABASE_URL` (#54):
- **Neon** (any other host: dev, preview, production): Neon's HTTP driver, one HTTP request per query, nothing to keep open between serverless invocations.
- **localhost / 127.0.0.0/8 / ::1** (every host, if several are given): node-postgres (`pg`) over TCP. This is the same rule as the TLS exemption, from one helper (`isLoopbackDatabaseUrl` in `src/db/tls.ts`, also used by the seed script), so a database that may skip TLS is always one reached with `pg`. Neon's HTTP driver only talks to Neon's HTTP endpoint, so it can't reach the plain Postgres in the CI e2e job or on a laptop. We picked this over running Neon's WebSocket proxy next to a local Postgres: one small, standard dependency, no extra container, and the same code path for CI and local runs. 

Neither driver's extras are used (`db.batch` is Neon-only; interactive transactions are `pg`-only), so writes that must happen together are one SQL statement. A game save is `UPDATE games ... WHERE id = $1 AND revision = $2` (plus a CTE for `game_rounds`); when no row matches, another request (e.g. a second tab) saved first. The action is then **not** applied or retried, since that would apply it to a game state the player never saw; the action returns `conflict`, and the browser reloads the game with `getGameAction` and tells the player. The browser also sends one move at a time: controls are marked disabled until the last move's result is back.

In development `getDb()` keeps its client on `globalThis`, so hot reload doesn't open a new node-postgres pool on every edit.

**Running /play locally and the e2e tests.** `/play` needs a migrated database in `DATABASE_URL`. `npm run dev` reads your dev Neon database from `.env.local`. Or use a Postgres on your machine (`DATABASE_URL=postgresql://postgres@127.0.0.1:5432/zoomout`, then `DATABASE_URL_UNPOOLED=<same> npm run db:migrate` and `npm run db:seed`); a variable set in the shell wins over `.env.local`. `npm run test:e2e` starts the app with the same environment. CI does exactly this with a `postgres` service container.

**Changing the schema.** Edit `src/db/schema.ts`, run `npm run db:generate`, and commit the new file in `drizzle/` with the change. Never edit a migration that has run anywhere; add a new one. `npm test` applies every migration to an empty in-memory Postgres (PGlite) and fails if the schema and the migrations disagree.

**How migrations reach each database.** Jacky (the deploy owner) runs them, with `npm run db:migrate` (drizzle-kit, over the direct `DATABASE_URL_UNPOOLED` connection). Each migration runs before the code that needs it is deployed, so write it so the code already deployed keeps working: add tables and columns; rename or drop only in a later PR.

| Database | When | Credentials |
|---|---|---|
| dev | When a PR with a migration is ready to merge. Anyone with dev access may also run it to try the PR. | `.env.local`, which `drizzle.config.ts` reads only if the variable isn't set in the shell |
| preview | Before deploying a preview of a PR that includes a migration | Typed at a hidden prompt for that one command, never saved in a file or shell history: `read -rs URL && DATABASE_URL_UNPOOLED="$URL" npm run db:migrate; unset URL`. The values live only in Vercel and the Neon console. |
| production | Right before merging the PR (`main` deploys to production), and only after it passed on preview | Same as preview, with the production value |

A migration that adds or tightens a CHECK fails if a row already in that database breaks it, so it can't leave bad data behind; fix the row (or the seed data) and run it again. `0001_zoom_level_checks` is one of these: it has to run on dev before its PR merges, then on preview and production as in the table above.

If a migration fails partway, don't edit it; fix forward with a new migration, or restore the Neon branch to a point in time before the migration.

### Content and the seed script (#52)

**Packs.** Every mode plays a **pack**: a title, a theme, its puzzles in order, and a `kind` (`practice`, `daily`, `stanford` or `lobby`). The daily schedule maps a date (`YYYY-MM-DD`) to a daily pack. Types: `Pack`, `PackKind` and `DailyEntry` in `src/game/types.ts`; checks: `src/game/packs.ts`.

**Only the practice pack is in the repo** (`src/puzzles/sample.json` and `practice-pack.json`, images in `public/puzzles/`). Daily, Stanford and lobby answers and images are never committed: the repo is public.

**Content files** are JSON with any of three lists:

```json
{
  "puzzles": [{ "id": "pz-…", "imageUrl": "…", "answer": "…", "acceptedAnswers": [], "reveal": {…}, "credit": {…} }],
  "packs": [{ "id": "pk-…", "kind": "daily", "title": "Fruit", "theme": "Fruit", "puzzleIds": ["pz-…"] }],
  "schedule": [{ "date": "2026-11-20", "packId": "pk-…" }]
}
```

A puzzle is the same `Puzzle` format as `sample.json`, plus an optional `aiSolvedLevel` (#56). Use random ids (`pz-` + `openssl rand -hex 4`): **no id or image URL may contain an answer or accepted answer**, and the checks reject one that does (#36). They also catch single words of 3+ letters (`ben-01.jpg` for "Big Ben"), singulars (`cherry.jpg` for "Cherries") and URL-encoded names. **Strip photo metadata** before using an image: phone photos carry GPS, which gives a landmark away. Only daily packs can be scheduled, each on one day. Per-pack `scoring` isn't loaded yet (#64).

**Where private content lives:** in `content/` at the repo root, or anywhere outside the repo. `content/` is in `.gitignore` and in `.vercelignore` (a `vercel deploy` uploads from disk). It may be a symlink to a shared folder. The seed script refuses a content file inside the repo that git would commit.

**Running it.**

| Command | What it does |
|---|---|
| `npm run db:seed -- --dry-run [paths]` | Checks the content and prints a summary. No database needed. Run this while writing content. (`npm run db:seed --dry-run`, without `--`, is a dry run too.) |
| `npm run db:seed` | Loads the practice pack and every `.json` file in `content/` into the database in `DATABASE_URL_UNPOOLED` (dev, from `.env.local`, by default). |
| `npm run db:seed -- a.json more/` | The same, for these files and folders instead of `content/`. |

Credentials work like migrations: dev from `.env.local`; preview and production typed at a hidden prompt for one command (see the migrations table above). A Postgres on this machine (`localhost`, `127.x`, `::1`, e.g. CI's e2e database) is reached with `pg` (from #54); Neon with its HTTP driver. Seed preview and production only after their migrations.

**Safe to run again.** Every write is an upsert, so running it twice gives the same rows, and a run that stopped partway is fixed by running it again (the Neon HTTP driver has no transactions). It never deletes a puzzle or a pack; content you leave out stays in the database. A pack is on one day only: scheduling an unplayed pack on a new day clears its old day. Before writing anything, it refuses (and writes nothing) if it would:
- change the puzzle list of a pack that has games,
- move a date to another pack when the current one has games,
- move a pack that has games to another date,
- change how many zoom levels a played puzzle has (a game in progress could be past the new last level), or
- change the kind of a pack that has games or is on the daily schedule.

Fixing a typo in a puzzle (answer, alternates, credit, focus, image URL, zoom values) is always allowed.

The writes are separate statements, not one transaction. If a run stops partway, a pack can briefly have no puzzle list or a day no pack; running it again fixes that.

**Reading content in the app:** `getPuzzles(db, ids)`, `getPack(db, id)` and `getDailyEntry(db, date)` in `src/db/content.ts`. Server-only, like everything in `src/db/`.

### Images per zoom level (#57)

The browser used to get each puzzle's full image and crop it with CSS, so anyone could open the whole picture at level 0. Now each zoom level is cut ahead of time into its own image, and the browser only gets the level the player has reached.

- **Cutting.** `cutLevels` (`src/images/cut.ts`, using `sharp`) makes one WebP per level. Each shows exactly the window the CSS crop showed (`planLevels` in `src/game/levels.ts`). Phone photos are turned upright first. Images are never upscaled, and are at most 1600 × 1600 px, so a large original never reaches the browser. **All metadata is dropped**, including GPS location, which could otherwise name a landmark. Originals must be JPEG, PNG, WebP or HEIF and at most 50 megapixels, and levels are cut one at a time; `saveLevelImages` refuses any level over 1 MiB (security audit, #95).
- **Storage (decided in #57): Postgres.** The bytes go in `image_files`, and `puzzle_images` maps each (puzzle, level) to its URL. No extra service or token: it uses the database credentials we already have. About 25 MB for ~60 puzzles, well within Neon's free 0.5 GB. We chose this over Vercel Blob, whose store and upload token only the Vercel project owner could manage on the free tier.
- **Serving.** `GET /img/<id>.webp` (`src/app/img/[file]/route.ts`, `src/server/images.ts`). The response is cached for a year by browsers (`Cache-Control: … immutable`) and by Vercel's CDN (`CDN-Cache-Control`; still to confirm on a preview deploy with `x-vercel-cache: HIT`), so most loads never reach the database. A missing image is a 404 that isn't cached. Anything but 32 hex characters plus `.webp`, and any URL with a query string (which the CDN would cache separately), is a 404 without a query. Once an image is cached it can only be taken back with a Vercel cache purge, even after its row is deleted.
- **What protects a level: a secret URL.** Each image id is 128 random bits, never derived from the puzzle, the level or the answer. The server only sends the current level's URL (`PublicRound.imageSrc`), and one URL says nothing about another. Re-cutting a puzzle gives every level a new id and deletes the old files. A player could share a URL they've reached, which is no worse than sharing the answer.
- **Previewing levels while writing content.** `npm run images:preview -- photo.jpg --focus 0.4,0.66 --zoom 10,5,2.5,1` writes every level to a temporary folder (or `--out`), and says which levels will look soft on a 2× screen, meaning the original is too small for that zoom (#34). It won't write inside the repo unless that folder is git-ignored; symlinks are followed first, and a folder named like `..previews` still counts as inside.
- **Still to do (after #54 merges; #52 has):** a command that cuts every seeded puzzle into the database, the game sending `imageSrc` from `puzzle_images`, the viewer showing pre-cut images, and removing the temporary `PublicRound.reveal`.

## 4. Secrets and user information

- **Secrets we have:** only the database connection strings (`DATABASE_URL`, `DATABASE_URL_UNPOOLED`). No API keys.
  - **Dev:** in each person's `.env.local`, which is git-ignored and excluded from Vercel uploads (`.vercelignore`).
  - **Preview and production:** only in Vercel as **sensitive** environment variables. Never in files, chat or commits.
  - `.env.example` shows the variable names with placeholder values only.
- **Leak protection:** gitleaks pre-commit and pre-push hooks, plus a required CI secret scan on every PR. Custom rules catch Postgres URLs, `PGPASSWORD` and `.env` files. If a secret ever leaks, we rotate it first (steps are in `README.md`).
- **User information:** no accounts, names or emails yet. The only thing that identifies a visitor is the anonymous owner cookie (#54): a random token, stored on the server only as its SHA-256. When accounts land (#53), the database stores a username and a password hash only, and sessions only as token hashes; `getCurrentUser()` in `src/server/current-user.ts` is where #53 plugs in.
- **No `NEXT_PUBLIC_` database variables.** Next.js copies every `NEXT_PUBLIC_` variable into the browser's JavaScript. `src/db/env-names.test.ts` fails if a name with DATABASE, POSTGRES, NEON or a `PG...` part gets that prefix anywhere in `src/`, `.github/`, the root `*.config.*` files or `.env.example` (it never reads `.env.local`).
- **Only server code reaches the database.** `src/db/index.ts` imports `server-only`; ESLint (`src/components/**`, `src/game/**`) and `src/db/boundary.test.ts` (those folders plus every `"use client"` file, `@/db` and relative imports) block client code from importing `src/db`.

### TLS on every database connection (#60)

- `getDb()` (the app), `drizzle.config.ts` (migrations) and the seed script all call `assertDatabaseUrlRequiresTls` in `src/db/tls.ts` before connecting. It accepts `sslmode=require`, `verify-ca` or `verify-full` (Neon's `channel_binding=require` may stay), and rejects a missing `sslmode` and `disable`, `allow` or `prefer`, since libpq's default (`prefer`) quietly falls back to plain text.
- **Exemption:** a database on this machine (host `localhost`, anything in `127.0.0.0/8`, or `::1`, every host if several are given) may connect without TLS, for the Postgres service container in CI (#54). Its traffic never leaves the machine. Lookalikes such as `localhost.evil.com` or `127.0.0.1.nip.io` are not exempt. The app and the seed script use node-postgres for exactly these hosts (same helper).
- Error messages name the variable and the reason, never the connection string, user, host or password (tested in `src/db/tls.test.ts`).
- Neon's HTTP driver sends queries over HTTPS in any case. The check runs everywhere a connection string is used: `getDb()`, `drizzle.config.ts` (drizzle-kit), and the seed script, both in `scripts/seed.ts` and in `connect()` in `scripts/seed-db.ts`, so no caller can connect without it.

### What we store about users

Games are written since #54 (`/play`); the account tables wait for #53. This is what the schema (`src/db/schema.ts`) holds, and how each item is protected. No email, real name, IP address or other personal detail is stored.

| Data | Column(s) | How it's protected | Who can read it |
|---|---|---|---|
| Username | `users.username` | Stored as typed, not hashed or encrypted (the app needs to display it). Unique ignoring case. Whether other players see it (e.g. on leaderboards, #62) is not decided. | The server and the user; others only if a feature decides to show it |
| Password | `users.password_hash` | Only a salted hash is stored, never the password (schema comment and the "store only hashes" test). **PLANNED (#53):** the algorithm (argon2id or bcrypt) and its parameters. | The server only, to check a login. Never sent to a browser. |
| Session | `sessions.token_hash`, `user_id`, `created_at`, `expires_at` | The cookie holds a random token; the database holds only its hash (e.g. SHA-256), so a database leak doesn't hand out live sessions. **PLANNED (#53):** token generation, the hash, cookie flags (`HttpOnly`, `Secure`, `SameSite`), expiry and logout, and rate limiting on login and sign-up. | The server only |
| Games and rounds | `games.*` (owner, `state`, `total`, timestamps), `game_rounds.*` (outcome, points, wrong guesses, reveal level, `finished_at`) | `state` is server-only and never sent to the browser; the browser gets only a `GameView`. Every read or write checks that the game belongs to the requesting user or anonymous owner (#54; a stranger gets "not found", tested in unit and e2e tests). `game_rounds` isn't written for practice games yet. What leaderboards (#62) show is not decided. | The server, and the game's owner through `GameView` |
| Anonymous owner | `games.anon_owner_hash` | The SHA-256 of the random token in the `zo_owner` cookie (#54), never the token; the store refuses anything that isn't a 64-character hex digest. The cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` over https. Used for the practice pack; whether daily packs allow anonymous play is open (#54/#62). | The server only |
| Timestamps | `created_at` on users, sessions and games; `updated_at` on games; `finished_at` on games and rounds; `expires_at` on sessions | Same as the row they belong to | Same as the row |

Protection that applies to all of it, **in place now**:

- **Server-only access:** see above (`server-only`, ESLint rule, boundary test). Only Route Handlers, Server Actions and Server Components may query it.
- **TLS in transit:** enforced in code, see above.
- **Logs without values (#60):** when a game call fails unexpectedly, the server logs the error's name, message, Postgres code and SQL text (`errorForLog` in `src/game/log-safe.ts`), but not the query's parameters or Postgres's `detail`, which can quote an owner hash, a guess or a password hash. Tested in `src/game/log-safe.test.ts`.
- **Encrypted at rest:** Neon encrypts stored data at rest. Three separate Neon projects (dev, preview, prod), so dev work never touches real data.
- **Deleted with the account:** deleting a `users` row deletes its sessions, games and their rounds (`ON DELETE CASCADE`, tested in `src/db/schema.test.ts`). **PLANNED (#53):** a way for a user to delete their account.
- **Who holds the keys:** connection strings are in the dev `.env.local` files and, for preview and production, only in Vercel (sensitive) and the Neon console, set by Jacky as the deploy owner (see above).

**Done for games (#54):** per-owner access tests, and unit and e2e checks that no Server Action response or page HTML contains the current puzzle's answer while it is being played. **Not done yet** (needs #53): the same for sessions and accounts. We don't encrypt individual columns in the app: passwords and tokens are hashed instead (they never need to be read back), and the rest (usernames, game results) has to be read back by the app, so it relies on server-only access, TLS and Neon's encryption at rest.

## 5. Open questions

| Question | Next step |
|---|---|
| /play still reads the practice puzzles from the repo, and sends the full image | Since #52 the practice pack has opaque ids and image names, and the seed script also puts it in the database. /play reading puzzles from the database (and then writing `game_rounds`) is a follow-up; per-level images (#57) stop sending the full image. Image storage is settled (Postgres, #57). Anonymous play for daily packs is still open. |
| Scoring values and wrong-guess rules (#21) | Playtest the three-image prototype (notes in `PLAYTEST.md`), then change the values in `src/game/scoring-config.ts` |
| Number of reveal steps; typo tolerance | Decide after the playtest. The code already accepts a pluggable answer matcher. |
| Image sourcing and licenses | The three sample photos are CC BY-SA, with credits in the data (#32) and shown after each round (#35). Open: where to source daily puzzles, and neutral file names so they don't give the answer away (#36) |
| Daily reset time and time zone | Default: midnight `America/Los_Angeles` (`DEFAULT_DAILY_RESET` in `src/game/daily-date.ts`, #58). It's a config value, so it can change after playtesting. |
| Keeping the code easy to change with four people working at once | Fewer stacked PRs, smaller PRs merged sooner, and asking staff for advice (see `PROGRESS.md` §3) |
| How to make the game more interesting and grow its scope | Playtest first, then pick features (daily challenge, streaks, sharing) based on what players enjoy |
