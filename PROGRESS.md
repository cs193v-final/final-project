# Progress Report: Checkpoint 1

> **Draft.** Facts come from the repo, PRs and issues as of Nov 10, 2026. Every **TODO** must be replaced in each person's own words before the deadline (24 hours before our Week 8 meeting).

**Project:** Zoom Out (working title), a daily image-guessing game. Each image starts zoomed in. Players guess, or zoom out to see more, and every reveal costs points. Full plan: [`PROJECT_BRIEF.md`](PROJECT_BRIEF.md).

## 1. Progress so far

**What works**
- **Repo and safety setup** (merged):
  - PRs only, with 1 approval required on `main`.
  - CI on every PR: secret scan, hook tests, shell lint, lint, typecheck, unit tests and build. All three CI checks are required, and a merge queue is on.
  - gitleaks pre-commit and pre-push hooks block secrets before they leave a laptop.
- **Hosting:** a Vercel project plus three separate Neon Postgres databases (dev / preview / prod). Live site: https://final-project-theta-hazel.vercel.app (currently the placeholder home page).
- **Game logic** (in review: #22, #23):
  - guess checking (ignores case, extra spaces and look-alike characters; supports alternate answers)
  - a round state machine (zoom out, guess, skip, next, end of game) that emits scoring events
  - covered by unit tests
- **Next.js app** (in review: #24).
- **Guessing screen** (draft: #25): a `/play` page where you can play through three rounds of guessing and skipping.

**What's still a placeholder** (labeled on the page)
- the image and zoom-out area
- the three sample answers (no images yet)
- the final score screen

**What we tried / learned**
- Stacked PRs (each PR built on the previous one) let us keep working while reviews were pending. They need to be merged in order, using merge commits (squash breaks the stack).
- A project's first `vercel deploy` goes to **Production**, not Preview. We now always pass `--target=preview`.
- TODO (each person): one thing you learned.

## 2. Changes from the proposal

- TODO (team): compare with the proposal's Week 8 goals.
  - Draft: the planned Week 8 milestone is the three-image practice game (brief, "Week 8 milestone").
  - So far: the setup, game logic and guessing UI are done or in review. The image viewer, puzzle data and scoring aren't started yet.
- Scope: no change to the idea. Live multiplayer stays out of scope (it was already out in the brief).
- TODO (team): any other changes in idea or scope.

## 3. Problems and questions

- **Vercel free tier:** only the project owner (Jacky) can deploy. Every deploy goes through one person.
- **Repo admin settings:** our coding agents' GitHub tokens can't change repo rules (by design). Ruleset changes are done by hand on GitHub.
- **Open gameplay decisions (#21):** scoring values, wrong-guess rules, number of reveal steps, typo tolerance. We plan to decide after a first playtest.
- TODO (team): where we'd like help from staff.

## 4. Team contributions and next steps

### Technical work so far

| Person | Work (with links) |
|---|---|
| **Jacky** (`Hombobow`) | Repo, Vercel and Neon setup (#3); gitleaks hooks (#5); CI (#7); course requirements summary (#1); guess checking (#22, closes #12); round logic (#23, closes #13); Next.js scaffold (#24, closes #9); guessing UI (#25, closes #14). Created the Week 8 issues (#9–#21). |
| **Darian** (`darian07-o`) | Project brief and shared interfaces (#8); `AGENTS.md` rules for coding agents; reviewed every PR so far (#1, #3, #5, #7) with change requests that we fixed. TODO (Darian): add or correct. |
| **Joseph** (`Joseph-G-McD`) | TODO (Joseph). Assigned: puzzle data (#17), start screen (#18). |
| **Ethan** (`ethanyng`) | TODO (Ethan). Assigned: scoring (#15), score screens (#16). |

### Week 9 priorities (TODO, team: confirm owners and order)

| Priority | Work | Owner | How we'll check it's done |
|---|---|---|---|
| High | Merge the in-review PRs in order: #22 → #24 → #23 → #25 | Jacky (author), Darian (review) | All four merged; CI green on `main` |
| High | Image viewer with initial crop (#10) and zoom out (#11) | Darian | Component tests; manual check on desktop and phone |
| High | Puzzle data and three real puzzles with licensed images (#17) | Joseph | Loader tests; image credits recorded |
| High | Scoring rules (#15) | Ethan | Unit tests for every scoring event |
| Medium | Live score and final score screen (#16) | Ethan | Component tests; full playthrough |
| Medium | Start screen (#18) | Joseph | Manual check; links into `/play` |
| High | Put it all together and deploy from `main` (#19) | Everyone (Jacky deploys) | Live URL plays all three images end to end |
| Medium | Settle the open gameplay decisions after a playtest (#21) | Everyone | Decisions recorded in `PROJECT_BRIEF.md` |
