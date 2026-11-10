# Agent instructions

Rules for any coding agent working in this repo. Keep this file short. Project context lives in the brief.

## Read first
- [`PROJECT_BRIEF.md`](PROJECT_BRIEF.md): what we're building, who owns what, shared interfaces, open decisions.
- [`INSTRUCTIONS.md`](INSTRUCTIONS.md): course requirements and the checkpoint checklist.
- Look at the current code before writing any. The brief describes **planned** work; don't assume something exists because it's in the plan.

## Stack (decided in #9)
- **Next.js 16** (App Router, `src/` directory, Turbopack) + **React 19** + **TypeScript 5.9** (strict, plus `noUncheckedIndexedAccess`).
- **Tailwind CSS 4** for styling. **ESLint 9** with `eslint-config-next` (core-web-vitals + typescript).
- **Vitest** for unit tests. Hosted on **Vercel** (`vercel.json` sets the Next.js preset; Node.js runtime, the default; don't add `runtime = 'edge'`). Database: **Neon Postgres**, see `README.md`.
- Scaffolded with `npx create-next-app@16.4.6 --ts --eslint --tailwind --app --src-dir --import-alias "@/*" --use-npm --turbopack`, then merged by hand. TypeScript is pinned to 5.9 to match Next 16, and `typecheck` runs `next typegen` first, because route types like `LayoutProps` are generated. `next-env.d.ts` and `.next/` are git-ignored.
- Next 16 differs from older versions (async `params`/`cookies()`, `proxy.ts` instead of `middleware.ts`, Cache Components). Read the bundled docs below before writing Next code.

## Layout
- `src/app/`: routes (App Router). `page.tsx` is currently a **placeholder** home page.
- `src/game/`: framework-independent game logic (types, guess checking, round state). No React or Next imports here, so it stays unit-testable. Tests sit next to the code as `*.test.ts`.
- `public/`: static files (puzzle images go here or in a subfolder).
- Import from `src` with the `@/` alias (`@/game/guess`).

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

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
- Install: `npm ci` (Node 24, pinned in `package.json` `engines` so Vercel matches CI).
- Dev server: `npm run dev`. In this course's container, bind IPv4 so the browser can reach it: `npm run dev -- -H 127.0.0.1`.
- Lint: `npm run lint`. Typecheck: `npm run typecheck`. Tests: `npm test` (`npm run test:watch` while working). Build: `npm run build`.
- Test the secret-scanning hooks: `scripts/test-hooks.sh`.
- CI (`.github/workflows/ci.yml`) runs a secret scan, the hook tests, `shellcheck`, then `lint`, `typecheck`, `test` and `build` on every PR.

## Before opening a PR
- Run lint, typecheck and tests, if they exist.
- In the PR description, write what you verified and how: tests run, manual playthrough, browsers or devices checked.
