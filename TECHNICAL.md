# Technical Overview

> As of Nov 10, 2026. Everything described here is on `main`, except the score screens (#37, approved and waiting to merge).

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
| Score screens | `src/components/game/LiveScore.tsx`, `FinalScore.tsx` | Approved, waiting to merge (#37, Ethan). The running total and what the current image is worth while playing; a final screen with each image's points math. |
| CI and secret scanning | `.github/workflows/ci.yml`, `.githooks/` | Checks every PR. Blocks secrets at commit, push and in CI. |

## 2. Tools and services

| Tool | What it's for |
|---|---|
| **Next.js 16 + React 19 + TypeScript** | The web app. Picked because it deploys to Vercel with no setup and can talk to the database from server code later (#9). |
| **Tailwind CSS** | Styling |
| **Vitest + React Testing Library** | Unit tests and component tests |
| **ESLint** | Linting (Next.js rules) |
| **Vercel** | Hosting. One deploy owner (Jacky) because of free-tier limits. |
| **Neon Postgres** | Database. Three separate projects (dev / preview / prod). **Set up but not connected to the app yet.** |
| **GitHub Actions** | CI: secret scan, hook tests, shellcheck, lint, typecheck, tests, build |
| **gitleaks** | Secret scanning in git hooks and CI |

## 3. Stored information

- **Nothing is stored yet.** Game state lives in the browser's memory and resets on reload.
- Puzzles are a static JSON file plus images in `public/puzzles/`, shipped with the app.
- Later (open decision): daily progress, streaks, and possibly puzzles and accounts. Where and how they're stored is undecided (#21 and the brief's open decisions).

## 4. Secrets and user information

- **Secrets we have:** only the database connection strings (`DATABASE_URL`, `DATABASE_URL_UNPOOLED`). No API keys.
  - **Dev:** in each person's `.env.local`, which is git-ignored and excluded from Vercel uploads (`.vercelignore`).
  - **Preview and production:** only in Vercel as **sensitive** environment variables. Never in files, chat or commits.
  - `.env.example` shows the variable names with placeholder values only.
- **Leak protection:** gitleaks pre-commit and pre-push hooks, plus a required CI secret scan on every PR. Custom rules catch Postgres URLs, `PGPASSWORD` and `.env` files. If a secret ever leaks, we rotate it first (steps are in `README.md`).
- **User information:** none collected yet. No accounts, no names, no emails.
- **Encrypting database contents:**
  - Connections to Neon require TLS (`sslmode=require&channel_binding=require`).
  - Neon encrypts stored data at rest.
  - Before we store anything about users, we'll encrypt sensitive fields in the app before saving them. If we add accounts, passwords will be hashed and salted, never stored as-is. We'll revisit this plan when we design what gets stored.

## 5. Open questions

| Question | Next step |
|---|---|
| Database is set up but not connected | Decide what daily progress and streaks need to store, then add a server-side data layer using `DATABASE_URL` |
| Scoring values and wrong-guess rules (#21) | Playtest the three-image prototype, then fix values in `ScoringConfig` (#15) |
| Number of reveal steps; typo tolerance | Decide after the playtest. The code already accepts a pluggable answer matcher. |
| Image sourcing and licenses | Joseph to pick sources with clear licenses and record credits per puzzle (#17) |
| Daily reset time and time zone | Decide before building the daily challenge (Week 9+) |
| Keeping the code easy to change with four people working at once | Fewer stacked PRs, smaller PRs merged sooner, and asking staff for advice (see `PROGRESS.md` §3) |
| How to make the game more interesting and grow its scope | Playtest first, then pick features (daily challenge, streaks, sharing) based on what players enjoy |
