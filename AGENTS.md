# Agent instructions

Rules for any coding agent working in this repo. Keep this file short. Project context lives in the brief.

## Read first
- [`PROJECT_BRIEF.md`](PROJECT_BRIEF.md): what we're building, who owns what, shared interfaces, open decisions.
- [`INSTRUCTIONS.md`](INSTRUCTIONS.md): course requirements and the checkpoint checklist.
- Look at the current code before writing any. The brief describes **planned** work; don't assume something exists because it's in the plan.

## Stack (decided in #9)
- **Next.js 16** (App Router, `src/` directory, Turbopack) + **React 19** + **TypeScript 5.9** (strict, plus `noUncheckedIndexedAccess`).
- **Tailwind CSS 4**, **ESLint 9**, **Vitest**. Hosted on **Vercel** (Node.js runtime; don't add `runtime = 'edge'`). Database: **Neon Postgres**, see `README.md`.
- TypeScript is pinned to 5.9 to match Next 16. `typecheck` runs `next typegen` first, because route types like `LayoutProps` are generated.

## Layout
- `src/game/`: framework-independent game logic (types, guess checking, round state). No React or Next imports here, so it stays unit-testable. Tests sit next to the code as `*.test.ts`.
- `src/components/`: React components (`src/components/game/` for game UI). Mark files that use state or events with `"use client"`.
- `src/images/`: cutting puzzle images into one image per zoom level (`sharp`, #57). Scripts only: never import it from app code. The app serves already-cut levels from `/img/<id>.webp`.
- `public/`: static files. Only the practice pack's images go here; daily and Stanford images never do (the repo is public).
- **Tests:** logic tests run in Node. Component tests start with `// @vitest-environment jsdom` and use React Testing Library, with jest-dom matchers from `src/test/setup.ts`. Query by role and label, like a user would.
- **End-to-end tests:** Playwright specs in `e2e/` play the real app in headless Chromium, on a desktop and a phone viewport (`playwright.config.ts`). Take answers and points from the puzzle data and `SCORING_CONFIG`, not hard-coded values. Don't run `playwright install` in the course container.
- Import from `src` with the `@/` alias (`@/game/guess`).
- **User-test notes** go in `user-tests/`, one file per feature, with no tester names (#98).

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
- Run lint, typecheck and tests before opening a PR.

## Issues, PRs and tests (TA feedback, Checkpoint 1)
- **Every issue** has at least one **assignee** (a specific person, tagged by GitHub handle) and exactly one **`priority: high|medium|low`** label.
- **Tests are the spec.** New logic ships with tests that describe what it should do. A PR that changes behavior updates or adds tests.

## Code review
- Review only when requested or assigned. One reviewer owns approval.
- Review with `/review-pr <PR number> [last reviewed SHA]`; don't review by hand-written prompt.
- Read existing reviews and threads; don't repeat resolved points.
- Do one full review, then review only changes since the last reviewed SHA.
- Reply in existing threads; post at most one summary per round.
- Label findings blocking or nit. Nits never block approval or trigger re-review.
- Approve once blockers are resolved and CI passes. Keep re-approvals brief.
- Don't merge `main` into a branch unless GitHub reports a conflict (`mergeStateStatus` is `DIRTY`). Every push dismisses the approval, so batch fixes into one push.
- If a third review round seems necessary, stop and ask the people involved.
- To ask for a follow-up review, write "check changes since `<sha>`" with the commit ID of the last review.
- **Who reviews:** the author picks the owner of the area the PR touches (see the brief), or any teammate if that's the author. Shared-interface changes go to that interface's owner.
- **Still reviewed carefully**, line by line and on follow-ups too: security, database/schema and migrations, dependencies, CI/config, and anything that reads or writes user data.
- **Database oversight:** Jacky (`Hombobow`), the database owner, reviews database, migration and user-data PRs (`src/db/`, `drizzle/`, `src/auth/`, `src/crypto/`, database scripts); Joseph reviews Jacky's own. A PR that adds or changes a user field also asks Ethan (`ethanyng`), who owns encryption: the one exception to "one reviewer".
- **Merging:** through the merge queue (**Merge when ready**; `gh pr merge` fails here), which tests each PR against the latest `main`.

## Docs people write (Checkpoint 2)
- **Never create, draft or edit `SECRETS.md`, `ENCRYPTION.md` or `COST-CONTROLS.md`.** The course requires them to be written by a person.

## Shared docs
- **Feature PRs don't edit `TECHNICAL.md` or `README.md`.** Add a "Docs to update" line to the PR description instead (e.g. "TECHNICAL.md → Tools and services: added `sharp` for cutting level images").
- Darian collects them into one docs PR twice a week and before each deadline; it's the only PR that edits `TECHNICAL.md`.
- Exception: a PR that changes setup steps (new env var or command) may update them in `README.md`, so teammates' setups don't break.

## Secrets
- Real values go **only** in `.env.local` (git-ignored). Never put real values in `.env.example`, code, docs or commits.
- After cloning, run `scripts/install-gitleaks.sh` to turn on the secret-scanning hooks. Do this on every computer you commit from.
- Never bypass the hooks with `--no-verify`.
- **Data stays server-side.** Only server code (Route Handlers, Server Actions, Server Components) talks to the database. Never give a database variable a `NEXT_PUBLIC_` prefix, and never send stored data to a client that isn't allowed to see it.
- **The repo is public.** Never commit daily, Stanford or lobby puzzle answers or images; only the practice pack lives in the repo.
- **User data is encrypted at the application level** (see `ENCRYPTION.md`). Any new user field must be encrypted too, and its PR asks Ethan to review.
- **Every request handler that writes to the database or costs us per call is rate-limited** per user (or anonymous owner) and per IP, with counters in Postgres; anything that grows per user is capped (#85).

## Shared interfaces
- Every type in `src/game/types.ts` is shared. Its comments name each type's owner and say whether it's settled or a proposal.
- Don't change one without its owner reviewing the PR. If a change is needed, say so in the PR description.
- Don't treat items under "Open decisions" in the brief as settled. Ask, or keep them configurable.

## Commands
- Install: `npm ci` (Node 24, pinned in `package.json` `engines` so Vercel matches CI).
- Dev server: `npm run dev`. In this course's container, bind IPv4 so the browser can reach it: `npm run dev -- -H 127.0.0.1`.
- Lint: `npm run lint`. Typecheck: `npm run typecheck`. Tests: `npm test` (`npm run test:watch` while working). End-to-end: `npm run test:e2e` (starts the dev server itself; `/play` needs `DATABASE_URL` and a migrated database, see README → Run the app). Build: `npm run build`.
- Test the secret-scanning hooks: `scripts/test-hooks.sh`.
