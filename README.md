# Final Project

CS193V final project. Live site URL and setup instructions coming soon.

## Setup after cloning

Run this once in your clone. It installs [gitleaks](https://github.com/gitleaks/gitleaks) if needed and turns on the repo's git hooks:

```bash
scripts/install-gitleaks.sh
```

- **pre-commit** blocks commits that contain secrets (API keys, `postgres://USER:PASSWORD@host` URLs, `.env` files).
- **pre-push** scans *every* commit being pushed.

Real secrets go in `.env.local`, which git ignores. `.env.example` shows the variable names with placeholder values.

## CI

Every pull request and every push to `main` runs [`.github/workflows/ci.yml`](.github/workflows/ci.yml):

| Check | What it does |
|---|---|
| Secret scan (gitleaks) | Scans the **full** git history, a backup for hooks that weren't installed or were skipped |
| Hook tests | `scripts/test-hooks.sh` checks that the hooks block fake credentials (also safe to run locally) |
| Shell lint | `shellcheck` on the hook and setup scripts |
| App checks | `npm run lint`, `typecheck` and `test` once a `package.json` exists (skipped until then) |
