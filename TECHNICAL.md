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

**How the app connects.** Only `src/db/index.ts` creates the client, and it imports `server-only`, so a Client Component that imports it fails the build. `getDb()` connects on first use with the pooled `DATABASE_URL` through Neon's HTTP driver; `next build` doesn't need the variable. ESLint and `src/db/boundary.test.ts` stop components, `src/game/` and `"use client"` files from importing `@/db`.

**Changing the schema.** Edit `src/db/schema.ts`, run `npm run db:generate`, and commit the new file in `drizzle/` with the change. Never edit a migration that has run anywhere; add a new one. `npm test` applies every migration to an empty in-memory Postgres (PGlite) and fails if the schema and the migrations disagree.

**How migrations reach each database.** Jacky (the deploy owner) runs them, with `npm run db:migrate` (drizzle-kit, over the direct `DATABASE_URL_UNPOOLED` connection). Each migration runs before the code that needs it is deployed, so write it so the code already deployed keeps working: add tables and columns; rename or drop only in a later PR.

| Database | When | Credentials |
|---|---|---|
| dev | When a PR with a migration is ready to merge. Anyone with dev access may also run it to try the PR. | `.env.local`, which `drizzle.config.ts` reads only if the variable isn't set in the shell |
| preview | Before deploying a preview of a PR that includes a migration | Typed at a hidden prompt for that one command, never saved in a file or shell history: `read -rs URL && DATABASE_URL_UNPOOLED="$URL" npm run db:migrate; unset URL`. The values live only in Vercel and the Neon console. |
| production | Right before merging the PR (`main` deploys to production), and only after it passed on preview | Same as preview, with the production value |

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

A puzzle is the same `Puzzle` format as `sample.json`, plus an optional `aiSolvedLevel` (#56). Use random ids (`pz-` + `openssl rand -hex 4`): **no id or image URL may contain an answer or accepted answer**, and the checks reject one that does (#36). Only daily packs can be scheduled, each on one day. Per-pack `scoring` isn't loaded yet (#64).

**Where private content lives:** in `content/` at the repo root, which is git-ignored, or anywhere outside the repo. The seed script refuses a content file inside the repo that git would commit.

**Running it.**

| Command | What it does |
|---|---|
| `npm run db:seed -- --dry-run [paths]` | Checks the content and prints a summary. No database needed. Run this while writing content. |
| `npm run db:seed` | Loads the practice pack and every `.json` file in `content/` into the database in `DATABASE_URL_UNPOOLED` (dev, from `.env.local`, by default). |
| `npm run db:seed -- a.json more/` | The same, for these files and folders instead of `content/`. |

Credentials work like migrations: dev from `.env.local`; preview and production typed at a hidden prompt for one command (see the migrations table above). Seed preview and production only after their migrations.

**Safe to run again.** Every write is an upsert, so running it twice gives the same rows, and a run that stopped partway is fixed by running it again (the Neon HTTP driver has no transactions). It never deletes anything; content you leave out stays in the database. Before writing anything, it refuses (and writes nothing) if it would:
- change the puzzle list of a pack that has games, or
- move a date to another pack when the current one has games.

Fixing a typo in a puzzle (answer, alternates, credit, focus) is always allowed.

**Reading content in the app:** `getPuzzles(db, ids)`, `getPack(db, id)` and `getDailyEntry(db, date)` in `src/db/content.ts`. Server-only, like everything in `src/db/`.

## 4. Secrets and user information

- **Secrets we have:** only the database connection strings (`DATABASE_URL`, `DATABASE_URL_UNPOOLED`). No API keys.
  - **Dev:** in each person's `.env.local`, which is git-ignored and excluded from Vercel uploads (`.vercelignore`).
  - **Preview and production:** only in Vercel as **sensitive** environment variables. Never in files, chat or commits.
  - `.env.example` shows the variable names with placeholder values only.
- **Leak protection:** gitleaks pre-commit and pre-push hooks, plus a required CI secret scan on every PR. Custom rules catch Postgres URLs, `PGPASSWORD` and `.env` files. If a secret ever leaks, we rotate it first (steps are in `README.md`).
- **User information:** none collected yet. No accounts, no names, no emails. When accounts land (#53), the database stores a username and a password hash only, and sessions only as token hashes.
- **Encrypting database contents:**
  - Connections to Neon require TLS (`sslmode=require&channel_binding=require`).
  - Neon encrypts stored data at rest.
  - Before we store anything about users, we'll encrypt sensitive fields in the app before saving them. If we add accounts, passwords will be hashed and salted, never stored as-is. We'll revisit this plan when we design what gets stored.

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
