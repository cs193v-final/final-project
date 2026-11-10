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
- **Game logic** (merged: #22, #23; scoring in review: #27):
  - guess checking (ignores case, extra spaces and look-alike characters; supports alternate answers)
  - a round state machine (zoom out, guess, skip, next, end of game) that emits scoring events
  - scoring: points per image with a breakdown, and a running total (values are placeholders for playtesting)
  - covered by unit tests
- **Next.js app** (merged: #24).
- **Puzzle data** (merged: #32): three sample puzzles with licensed photos and a loader that checks the data.
- **Guessing screen** (in review: #25): a `/play` page where you can play through three rounds of guessing and skipping.

**What's still a placeholder** (labeled on the page)
- the image and zoom-out area
- the three answers on `/play` (no images yet). The real puzzles (#32) and the viewer (#30, #31) get wired in during #19.
- the final score screen

**What we tried / learned**
- Stacked PRs (each PR built on the previous one) let us keep working while reviews were pending. They need to be merged in order, using merge commits (squash breaks the stack).
- A project's first `vercel deploy` goes to **Production**, not Preview. We now always pass `--target=preview`.
- **Darian:** I learned that Next.js has an image tag that saves loading time by sending a small copy of the image that is just big enough to fit the box on the page. This is fine for a full image, but it caused problems when zooming in: a small corner of the already small copy would be blown up, and there wouldn't be enough pixels to fill the box sharply, so the zoomed-in image looked pixelated. To fix this, the viewer uses a different tag (`<img>`), which loads the full-size image and then zooms in from there. The tradeoff is that bigger files load slower.
- **Ethan:** a fine-grained GitHub token's resource owner has to be the organization itself. My first token was owned by my personal account, so it could read our repo but not push to it.
- **Joseph:** I learned that picking images for puzzles is all about the texture. A good one looks like an abstract pattern up close (think giraffes or strawberries) but is obvious once you zoom out. The only way to tell was to render all the zoom levels and look at it myself.
- TODO (Jacky): one thing you learned.

## 2. Changes from the proposal

- TODO (team): compare with the proposal's Week 8 goals.
  - Draft: the planned Week 8 milestone is the three-image practice game (brief, "Week 8 milestone").
  - So far: the setup, game logic and guessing UI are done or in review. Puzzle data (#32) is merged. The image viewer (#30, #31), start screen (#33) and scoring (#27) are in review.
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
| **Darian** (`darian07-o`) | Project brief and shared interfaces (#8), updated as code lands (#28); `AGENTS.md` rules for coding agents; agreed the `RevealLevel` interface (#22); image viewer with the initial crop (#30, closes #10); Zoom out button (#31, closes #11); reviewed every PR so far (#1, #3, #5, #7 with change requests that we fixed; #22–#25). |
| **Joseph** (`Joseph-G-McD`) | Puzzle data and loader (#32, closes #17): finalized the `Puzzle` format, three sample puzzles with CC BY-SA photos from Wikimedia Commons (credits recorded in the data), a loader that names the bad field when data is wrong, and 42 tests. Start screen with how-to-play steps (#33, closes #18). Reviewed and approved #30 and #31 after merging them with #32 and checking every zoom level in Chrome. |
| **Ethan** (`ethanyng`) | Scoring rules (#27, closes #15): `ScoringConfig` with placeholder values in one file, per-image scoring with a breakdown, a running total for the live score, and 19 unit tests (including a full game through the round logic). Reviewed and approved #22. I noticed punctuation in guesses isn't normalized (e.g. curly apostrophes), thought through the trade-offs, and postponed the fix to #29 so we could keep progress smooth and focus on the main features. Next: live score and final score screen (#16). |

### Week 9 priorities (TODO, team: confirm owners and order)

| Priority | Work | Owner | How we'll check it's done |
|---|---|---|---|
| High | Merge the remaining in-review PRs: #25, #27, #30, #31, then #33 (needs `/play` from #25) | Each author; Darian and others review | All merged; CI green on `main` |
| High | Image viewer with initial crop (#10) and zoom out (#11), in review: #30, #31 | Darian | Component tests; manual check on desktop and phone |
| High | Puzzle data and three real puzzles with licensed images (#17), **done: #32**. Follow-ups from review: neutral file names and ids, and visible image credits before the deploy | Joseph | Loader tests; image credits shown on the live site |
| High | Scoring rules (#15, in review: #27) | Ethan | Unit tests for every scoring event |
| Medium | Live score and final score screen (#16) | Ethan | Component tests; full playthrough |
| Medium | Start screen (#18) | Joseph | Manual check; links into `/play` |
| High | Put it all together and deploy from `main` (#19) | Everyone (Jacky deploys) | Live URL plays all three images end to end |
| Medium | Settle the open gameplay decisions after a playtest (#21) | Everyone | Decisions recorded in `PROJECT_BRIEF.md` |
