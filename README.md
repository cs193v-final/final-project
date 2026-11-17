# Final Project

CS193V final project: **Zoom Out**, a daily image-guessing game.

**Live site:** https://final-project-theta-hazel.vercel.app (a three-image practice prototype; open **Start practice**). Setup steps are under [Running your own copy](#running-your-own-copy).

**New to the project?** Read [PROJECT_BRIEF.md](PROJECT_BRIEF.md) for what we're building, who owns what, and how the pieces fit together. Coding agents: see [AGENTS.md](AGENTS.md).

## Running your own copy

### 1. Secret-scanning hooks
See [Setup after cloning](#setup-after-cloning) below. Do this first.

### 2. Database (Neon)
We use three separate [Neon](https://neon.tech) projects, one per tier, so dev work can never touch real data:

| Neon project | Used by | Where its credentials live |
|---|---|---|
| `final-project-dev` | local development | your `.env.local` (git- and Vercel-ignored) |
| `final-project-preview` | Vercel preview deploys | Vercel env vars only (Preview) |
| `final-project-prod` | the live site | Vercel env vars only (Production) |

Steps for local development:
1. `cp .env.example .env.local`
2. Get the **dev** connection strings: from Jacky (sent privately, never in chat/issues/commits), or from the `final-project-dev` project in the Neon console ("Connect" → "Copy .env") if you have access.
3. Paste them into `.env.local`. `DATABASE_URL` is the pooled URL (host contains `-pooler`), `DATABASE_URL_UNPOOLED` is the direct one, matching Neon's names.

If a tool only reads `.env` (Prisma CLI, drizzle-kit, plain `dotenv`), point it at `.env.local` instead of creating a `.env`. Either way, git and `vercel deploy` both ignore `.env*` files.

Preview and production credentials are **never** stored in files. Jacky (the deploy owner) sets them in Vercel with `vercel env add <NAME> <preview|production> --sensitive`.

Schema and migrations (#47): the schema is `src/db/schema.ts` and the SQL migrations are in `drizzle/`. After changing the schema, run `npm run db:generate` and commit the new migration. `npm run db:migrate` applies migrations to the database in `DATABASE_URL_UNPOOLED` (your dev database from `.env.local` by default). Jacky applies them to preview and production; who runs what, and when, is in [TECHNICAL.md → Database](TECHNICAL.md#database-47).

Puzzle content (#52): `npm run db:seed -- --dry-run` checks content files, and `npm run db:seed` loads the practice pack plus the private content in the git-ignored `content/` folder into your dev database. Never commit daily, Stanford or lobby content. Details: [TECHNICAL.md → Content and the seed script](TECHNICAL.md#content-and-the-seed-script-52).

**Your test user (#53).** Accounts are username and password; there's no email and no password reset. To create your own test user in the dev database, put `TEST_USER_PASSWORD=<a password you don't use anywhere else>` in `.env.local`, then run `npm run db:test-user -- <username>` and log in at `/login`. An existing username is left unchanged. Usernames are stored encrypted (#84), so `.env.local` also needs `DATA_ENCRYPTION_KEY`: make your own dev key with `openssl rand -base64 32` and keep a copy somewhere safe. (Run `npm run db:migrate` first. The encryption migration refuses to run while `users` has rows: delete your old test users, then recreate them with this command.)

**Encrypted game states (#84).** Games are stored encrypted with the same `DATA_ENCRYPTION_KEY`, so `/play` needs it too. After `npm run db:migrate` brings in migration `0006`, run `npm run db:encrypt-games` once to encrypt games stored before then (it prints only counts, and is safe to run again).

### 3. Run the app
The app is [Next.js](https://nextjs.org) (see `AGENTS.md` → Stack). With Node 24+:
```bash
npm ci
npm run dev -- -H 127.0.0.1   # then open http://localhost:3000
```
`/play` keeps its games in the database (#54), so it needs `DATABASE_URL` and a migrated database: your dev database from `.env.local` works, or a Postgres on your own machine (see below).

Checks (CI runs the same ones): `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:e2e`.

**End-to-end tests** (`npm run test:e2e`, Playwright) start the app and play it in a headless browser, so they need a database too. Either run them with your `.env.local` (they then write test games to your dev database), or point them at a local Postgres; a variable set in the shell wins over `.env.local`:
```bash
DATABASE_URL_UNPOOLED=postgresql://postgres@127.0.0.1:5432/zoomout npm run db:migrate
DATABASE_URL_UNPOOLED=postgresql://postgres@127.0.0.1:5432/zoomout npm run db:seed   # optional: /play works without it
DATABASE_URL=postgresql://postgres@127.0.0.1:5432/zoomout npm run test:e2e
```
A database on localhost is reached with node-postgres and no TLS; anything else with Neon's driver (see [TECHNICAL.md → Database](TECHNICAL.md#database-47)). On your own computer, run `npx playwright install chromium` once first.

### 4. Deploying
Deploys go through Jacky's Vercel account (free-tier limitation). See `INSTRUCTIONS.md`.

## Setup after cloning

Run this once in your clone. It installs [gitleaks](https://github.com/gitleaks/gitleaks) if needed and turns on the repo's git hooks:

```bash
scripts/install-gitleaks.sh
```

- **pre-commit** blocks commits that contain secrets (API keys, Postgres URLs/`PGPASSWORD`/`password=` with real values, `.env` files).
- **pre-push** scans *every* commit being pushed.

Notes:
- Run the script on **every computer you commit from**. The hooks block all commits on a machine without gitleaks (v8.25+).
- The hooks are an early warning, not the real gate. `--no-verify` and the GitHub web editor skip them, so CI also scans for secrets.
- If gitleaks itself fails (bad config, unknown revision), the hook says so separately and doesn't report it as a secret.
- If the GitHub API rate limit blocks the "latest version" lookup, set `GITHUB_TOKEN` or pin a version: `GITLEAKS_VERSION=8.30.1 scripts/install-gitleaks.sh`.

Real secrets go in `.env.local`, which git ignores. `.env.example` shows the variable names with placeholder values.

## CI

Every pull request and every push to `main` runs [`.github/workflows/ci.yml`](.github/workflows/ci.yml):

| Check | What it does |
|---|---|
| Secret scan + hook tests (gitleaks) | On PRs, scans the PR's commits; on `main`, scans the **full** history. A backup for hooks that weren't installed or were skipped. Then `scripts/test-hooks.sh` checks that the hooks block fake credentials (also safe to run locally) |
| Shell lint | `shellcheck` on the hook and setup scripts |
| App checks | `npm run lint`, `typecheck`, `test` and `build` for the Next.js app |
| End-to-end tests | Builds the app, starts a throwaway Postgres (service container), runs `npm run db:migrate` and `npm run db:seed`, then the Playwright tests on a desktop and a phone viewport |

CI installs a pinned gitleaks (`GITLEAKS_VERSION` + `GITLEAKS_SHA256` in `ci.yml`); update both together.

### If a real secret gets committed

1. **Rotate it first** (revoke and replace it in Neon/Vercel/etc.). Once it's pushed, assume it's leaked.
2. Remove it from the code in a new PR.
3. It still exists in old commits, so the full-history scan on `main` keeps failing. Copy the finding's **Fingerprint** from the CI log and add it to [`.gitleaksignore`](.gitleaksignore) with a comment saying what was rotated and when.
