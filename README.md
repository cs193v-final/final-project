# Final Project

CS193V final project. Live site URL and setup instructions coming soon.

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
| App checks | `npm run lint`, `typecheck` and `test` once a `package.json` exists (skipped until then; expects npm with a committed `package-lock.json` at the repo root) |

CI installs a pinned gitleaks (`GITLEAKS_VERSION` + `GITLEAKS_SHA256` in `ci.yml`); update both together.

### If a real secret gets committed

1. **Rotate it first** (revoke and replace it in Neon/Vercel/etc.). Once it's pushed, assume it's leaked.
2. Remove it from the code in a new PR.
3. It still exists in old commits, so the full-history scan on `main` keeps failing. Copy the finding's **Fingerprint** from the CI log and add it to [`.gitleaksignore`](.gitleaksignore) with a comment saying what was rotated and when.
