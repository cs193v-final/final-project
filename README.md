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
