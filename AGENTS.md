# Agent instructions

Rules for any coding agent working in this repo. Keep this file short. Project context lives in the brief.

## Read first
- [`PROJECT_BRIEF.md`](PROJECT_BRIEF.md): what we're building, who owns what, shared interfaces, open decisions.
- [`INSTRUCTIONS.md`](INSTRUCTIONS.md): course requirements and the checkpoint checklist.
- Look at the current code before writing any. The brief describes **planned** work; don't assume something exists because it's in the plan.

## Git workflow
- **Never commit or push to `main`.** It's protected: a PR with 1 approval is required.
- One issue per branch and PR. Put `Closes #<n>` in the PR body.
- Never force-push a branch someone else is working on, and never rewrite `main` history.
- Keep changes focused. Don't reformat or refactor unrelated files.

## Secrets
- Real values go **only** in `.env.local` (git-ignored). Never put real values in `.env.example`, code, docs or commits.
- After cloning, run `scripts/install-gitleaks.sh` to turn on the secret-scanning hooks. Do this on every computer you commit from.
- Never bypass the hooks with `--no-verify`.

## Shared interfaces
- `Puzzle`, `RevealLevel`, `GuessOutcome`, `ScoringEvent`, `ScoringConfig` and `RoundResult` are shared between owners (see the brief).
- Don't change one without its owner reviewing the PR. If a change is needed, say so in the PR description.
- Don't treat items under "Open decisions" in the brief as settled. Ask, or keep them configurable.

## Commands
- No app has been set up yet. When it is, list the install, dev, lint, typecheck and test commands here.
- Test the secret-scanning hooks: `scripts/test-hooks.sh`.
- CI (`.github/workflows/ci.yml`) runs a secret scan, the hook tests and `shellcheck` on every PR. It also runs `npm run lint`, `npm run typecheck` and `npm test` once a `package.json` exists (skipped until then).

## Before opening a PR
- Run lint, typecheck and tests, if they exist.
- In the PR description, write what you verified and how: tests run, manual playthrough, browsers or devices checked.
