# Progress Report: Checkpoint 1

> Facts come from the repo, PRs and issues as of Nov 10, 2026.

**Project:** Zoom Out (working title), a daily image-guessing game. Each image starts zoomed in. Players guess, or zoom out to see more, and every reveal costs points. Full plan: [`PROJECT_BRIEF.md`](PROJECT_BRIEF.md).

## 1. Progress so far

**What works**
- **Repo and safety setup** (merged):
  - PRs only, with 1 approval required on `main`.
  - CI on every PR: secret scan, hook tests, shell lint, lint, typecheck, unit tests and build. All three CI checks are required, and a merge queue is on.
  - gitleaks pre-commit and pre-push hooks block secrets before they leave a laptop.
- **Hosting:** a Vercel project plus three separate Neon Postgres databases (dev / preview / prod). Live site: https://final-project-theta-hazel.vercel.app (currently the placeholder home page).
- **Game logic** (merged: #22, #23, #27):
  - guess checking (ignores case, extra spaces and look-alike characters; supports alternate answers)
  - a round state machine (zoom out, guess, skip, next, end of game) that emits scoring events
  - scoring: points per image with a breakdown, and a running total (values are placeholders for playtesting)
  - covered by unit tests
- **Next.js app** (merged: #24).
- **Puzzle data** (merged: #32): three sample puzzles with licensed photos and a loader that checks the data.
- **Image viewer and Zoom out button** (merged: #30, #31).
- **Start screen** with how-to-play steps (merged: #33).
- **Guessing screen** (in review: #25): a `/play` page where you can play through three rounds of guessing and skipping. #35 (in review, stacked on #25) puts the viewer and the real puzzles into it.

**What's still a placeholder** (labeled on the page)
- the image area and the three answers on `/play` (no images yet), until #25 and #35 merge
- the final score screen (built and in review: #37)

**What we tried / learned**
- Stacked PRs (each PR built on the previous one) let us keep working while reviews were pending. They need to be merged in order, using merge commits (squash breaks the stack).
- A project's first `vercel deploy` goes to **Production**, not Preview. We now always pass `--target=preview`.
- **Darian:** I learned that Next.js has an image tag that saves loading time by sending a small copy of the image that is just big enough to fit the box on the page. This is fine for a full image, but it caused problems when zooming in: a small corner of the already small copy would be blown up, and there wouldn't be enough pixels to fill the box sharply, so the zoomed-in image looked pixelated. To fix this, the viewer uses a different tag (`<img>`), which loads the full-size image and then zooms in from there. The tradeoff is that bigger files load slower.
- **Ethan:** a fine-grained GitHub token's resource owner has to be the organization itself. My first token was owned by my personal account, so it could read our repo but not push to it.
- **Joseph:** I learned that picking images for puzzles is all about the texture. A good one looks like an abstract pattern up close (think giraffes or strawberries) but is obvious once you zoom out. The only way to tell was to render all the zoom levels and look at it myself.
- **Jacky:** I learned that there is so much that goes into setting up a proper codebase, such as setting up the repo, getting access tokens for everyone, setting up the repo with gitleaks, CI and merge queues, and also setting up the database with Neon and Vercel. I also learned that the initial commits take a while, especially when you need approval for everything.

## 2. Changes from the proposal

**Week 8 goal in the proposal:** "a three-image prototype with working guesses, zoom-out controls, and scoring", to test whether the core game is fun before adding daily challenges, saved progress and result sharing.

- **Where we are against that goal:**
  - Merged on `main`: guess checking (#22), round logic (#23), the Next.js app (#24), scoring rules (#27), the image viewer (#30), the zoom-out button (#31), puzzle data with three sample puzzles (#32) and the start screen (#33).
  - Still open: the guessing screen that ties the pieces together on `/play` (#25), and the live score and final score screen (#16; built and in review as #37, stacked on #25 and #35).
  - So all the parts exist and are tested, but the full playable flow isn't on `main` yet. Integrating it and deploying it (#19) is our first Week 9 priority.
- **Division of work:** unchanged from the proposal (Darian: viewer and zoom-out; Jacky: guessing and rounds; Ethan: scoring and the score screen; Joseph: puzzle data and the start screen). On top of that, Jacky set up the infrastructure (hosting, database, CI, secret scanning, the app scaffold) and Darian wrote the project brief and shared interfaces.
- **Idea and scope:** no change. Still a daily five-image game with a practice mode, spoiler-free sharing and a content editor; live multiplayer stays out of scope. The brief adds details the proposal didn't spell out: alternate accepted answers, typo handling, streaks and a score breakdown.
- **Name:** the proposal's working title was "Crumbscope". The app currently says "Zoom Out", also a working title. We haven't picked a final name.

## 3. Problems and questions

- **Vercel free tier:** only the project owner (Jacky) can deploy. Every deploy goes through one person.
- **Repo admin settings:** our coding agents' GitHub tokens can't change repo rules (by design). Ruleset changes are done by hand on GitHub.
- **Open gameplay decisions (#21):** scoring values, wrong-guess rules, number of reveal steps, typo tolerance. We plan to decide after a first playtest.
- **Where we'd like help from staff:**
  - Advice on next steps, and ideas for improving our CI/CD process.
  - Where we went wrong in setting up the codebase.
  - How to keep the codebase easy to update and easy for four people to work on at the same time. Stacked PRs and merge conflicts (e.g. #25 vs #33 in `page.tsx`) slowed us down.
  - How to make the game more interesting and grow its scope beyond the basic daily puzzle.

## 4. Team contributions and next steps

### Technical work so far

| Person | Work (with links) |
|---|---|
| **Jacky** (`Hombobow`) | Repo, Vercel and Neon setup (#3); gitleaks hooks (#5); CI (#7); course requirements summary (#1); guess checking (#22, closes #12); round logic (#23, closes #13); Next.js scaffold (#24, closes #9); guessing UI (#25, closes #14). Created the Week 8 issues (#9–#21). |
| **Darian** (`darian07-o`) | Project brief and shared interfaces (#8), updated as code lands (#28); `AGENTS.md` rules for coding agents; agreed the `RevealLevel` interface (#22); image viewer with the initial crop (#30, closes #10); Zoom out button (#31, closes #11); reviewed every PR so far (#1, #3, #5, #7 with change requests that we fixed; #22–#25). |
| **Joseph** (`Joseph-G-McD`) | Puzzle data and loader (#32, closes #17): finalized the `Puzzle` format, three sample puzzles with CC BY-SA photos from Wikimedia Commons (credits recorded in the data), a loader that names the bad field when data is wrong, and 42 tests. Start screen with how-to-play steps (#33, closes #18). Reviewed and approved #30 and #31 after merging them with #32 and checking every zoom level in Chrome. |
| **Ethan** (`ethanyng`) | Scoring rules (#27, closes #15): `ScoringConfig` with placeholder values in one file, per-image scoring with a breakdown, a running total for the live score, and 20 unit tests (including a full game through the round logic). Reviewed and approved #22. I noticed punctuation in guesses isn't normalized (e.g. curly apostrophes), thought through the trade-offs, and postponed the fix to #29 so we could keep progress smooth and focus on the main features. Live score and final score screen (#37, closes #16, in review): the running total and what each image is worth while playing, and a final screen with each image's points math. Also reviewed #25, #28, #30, #31, #33 and #35, and opened #36 after spotting that puzzle filenames give away the answers. |

### Week 9 priorities

Owners match the GitHub issue assignees. In priority order:

| Priority | Work | Owner | How we'll check it's done |
|---|---|---|---|
| High | Merge the guessing screen (#25), then the integration PR that adds the viewer and real puzzles to `/play` (#35, part of #19) | Jacky (#25), Darian (#35) | Both merged; CI green on `main`; `/play` shows real images |
| High | Live score and final score screen (#16, in review: #37) | Ethan | Component tests; full playthrough |
| High | Deploy the playable game from `main` (#19) | Jacky (deploy owner) | Live URL plays all three images end to end |
| Medium | Puzzle follow-ups: neutral image file names (#36), start more zoomed in (#34), visible image credits before the deploy | Joseph | Loader tests; credits shown on the live site |
| Medium | Normalize punctuation in guesses (#29) | Jacky | Unit tests for curly apostrophes, hyphens and periods |
| Medium | Playtest, then settle the open gameplay decisions (#21) | Everyone | Decisions recorded in `PROJECT_BRIEF.md` and `ScoringConfig` |
