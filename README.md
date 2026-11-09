# Final Project

CS193V final project. Live site URL and setup instructions coming soon.

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

### 3. Deploying
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
