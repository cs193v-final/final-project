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
