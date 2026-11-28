# Zoom Out: Project Brief

> **Zoom Out** is a working title. The team picks the name by Nov 30 (#51), and the final UI pass applies it (#183).
> This brief is for every teammate and every teammate's coding agent. Read it before you start work.
> Last updated: Nov 24, 2026 (final push plan, #178).

## Status at a glance

As of Tue Nov 24, 2026. **The final project is due 1 pm PT Wed Dec 3**, 24 hours before our presentation on Thu Dec 4. Feature PRs are open by end of Mon Dec 1 and merged by end of Tue Dec 2; Darian's batched docs PR merges last, by the morning of Dec 3. Everything left is in the **Final presentation** milestone.

| Area | Status |
|---|---|
| Practice game | **Live.** Server-side games, so answers never reach the browser (#54); one image per zoom level (#57); answer feedback (#48); typo-tolerant guesses (#115); per-pack scoring in the database (#64). Puzzles start at 14× on an ambiguous detail (#117). |
| Home and navigation | **Live** (#50): a mode picker and a way home from every screen. The leaderboard is still "Coming soon" text (#62). Making the daily the most prominent mode is #145, in the UI pass (#183). |
| Accounts | **Live** (#53): sign up, log in, log out, with encrypted usernames (#84). Left: one address can still lock an account out (#151). |
| Daily challenge | **Live, without shared content.** The intro, playing it (one game per player per day) and a result screen with a spoiler-free share, a countdown and per-image stats (#58). Content comes from the image picker (next row); the hand-picked content issues #55 and #59 are closed. User-test notes are in #175; their finding is #185. |
| Image picker | **Not started.** Find and download openly licensed candidates (#179) and the shared CLIP module (#56), in parallel → a local review page and export (#180) → content: days 1–7 and the Stanford pack (#181), days 8–14 (#182). A person approves every image, and nothing it downloads is committed. Jacky loads the content into preview and production. |
| Beat the AI | **Not started.** The `ai_solved_level` column and `PublicRound.aiSolvedLevel` exist, but nothing fills or shows them. Solver: #56. Badge and final summary: #66. |
| Leaderboard | **Not started** (#62). Only the `LeaderboardEntry` proposal and an index on finished games. |
| Streaks | **Logic merged** (#73, #81). The query and the display are #63; played days come from `games.daily_date` (migration `0005`). |
| Stanford mode | **Not started** (#65): "Coming soon" on the home screen. Built against test content now; the real pack comes from #181. |
| Name and look | **Not started.** The team picks the name by Nov 30 (#51). The look and usability fixes are #183, which closes #145, #147 and #51. |
| Accessibility and usability | **Done for Checkpoint 2** (#49, #89): WCAG 2.2 AA checks in the e2e tests, shared controls. The account pages still have their own styles (#183). |
| Tests and CI | Unit, component and Playwright e2e tests (full flow, daily, accessibility, contrast) run in CI. Left: each teammate's playthrough of the final build (#61), a flaky Back/Forward test (#170), and E2E as a required check plus CODEOWNERS (#184). |
| Checkpoint 2 backend | **Done:** encryption and `ENCRYPTION.md` (#84), rate limits and the expired-row sweep (#85, #154), `COST-CONTROLS.md` (#86), `SECRETS.md` (#87, follow-ups open), security audit (#95, `SECURITY-AUDIT.md`). **Audit findings still open:** #151, #167, #152, #109, #110, #88 (Jacky's checkout and a `prepare` script), and the optional #165. |
| Docs | Code-review rules (#176) are in PR #177. The `TECHNICAL.md` trim (#166) goes in Darian's batched docs PR. |
| Custom lobbies (stretch) | **Not started** (#67, #68). The first thing cut. |
| Framework / language | **Chosen (#9):** Next.js 16 + React 19 + TypeScript, Tailwind CSS, Vitest. See `AGENTS.md` → Stack. |
| Hosting + database | **Set up.** Vercel + Neon Postgres (dev / preview / prod), from #3. TLS is required on every connection (#75). See `README.md`. |
| Secret-scanning hooks + CI | **Set up.** gitleaks hooks (#5) and GitHub Actions CI (#7), including the Playwright e2e tests (#45). Run `scripts/install-gitleaks.sh` after cloning. |

Everything under "Project overview" below is **planned** unless the status table says it's done.

---

## Project overview (planned)

A **daily image-guessing game**. Each image starts tightly zoomed in. Players either guess or click **Zoom out** to see more. Every zoom-out and every wrong guess lowers the points available.

**Foundation** (Checkpoint 2):
- **Packs:** one data model for every mode. A pack is a theme, its ordered puzzles, and who can see it (`practice`, `daily`, `stanford` or `lobby`). Daily themes, Stanford mode and custom lobbies all reuse it (#52).
- **Server-side game:** puzzles live in Neon. The browser asks the server for a round and gets **no answers**. Guesses are checked and scores calculated on the server. The answer and image credit are revealed only when the round ends (#54).
- **Images per zoom level:** each level is served separately, so the browser never gets a more zoomed-out image than the player has reached. The full image is sent only at the last level or after the round (#57).

**Modes and features:**
- **Daily themes** (Checkpoint 2): every day, 5 images from one theme (fruits, animals, landmarks, ...), the same for everyone. The theme is shown at the start ("Today: Landmarks"). It resets at a fixed time, and progress survives a refresh (#58; content from the image picker, #181 and #182).
- **Accounts** (Checkpoint 2): username and password. Passwords hashed with argon2 or bcrypt, sessions in Neon with `httpOnly`, `Secure`, `SameSite` cookies, rate-limited login, no emails as usernames, no password reset for now (#53).
- **Practice mode:** the three sample puzzles, kept in the repo.
- **Leaderboard:** a daily leaderboard per mode (and per lobby). Top 10 plus your own rank. Only server-calculated scores count (#62).
- **Streaks:** days played in a row (#63).
- **Stanford mode:** campus spots, flags, mascots. Picker photos of Stanford spots (licensed and credited) or our own photos; logos and mascots only with a license that allows it (#65, #181).
- **Beat the AI:** an offline script runs CLIP (open source, `@huggingface/transformers` in Node) on every zoom level and records the first level where the AI's top guess is the answer. In game: "The AI got this at 5×. Can you beat it?" At the end: "You beat the AI on 3 of 5." No API keys, no cost per player (#56, #66).
- **Custom lobbies (stretch):** a logged-in user uploads 3–5 photos with answers and a focus point and shares a hard-to-guess code. Friends play any time; the lobby has its own leaderboard. Uploads are size- and type-limited and re-encoded to strip metadata (especially GPS); answers stay on the server; delete and report (#67, #68).

**From the Checkpoint 1 feedback** (`PROGRESS.md` §5):
- **Accessibility:** colorblind-safe colors, never right/wrong by color alone, WCAG AA contrast, keyboard-playable (#49).
- **Usability:** home/back on every screen, plus retry (#50, #42).
- **Game feel:** a satisfying moment on a correct guess that respects `prefers-reduced-motion` (#48).
- **Configurable scoring:** values stored per pack in the database, so tuning doesn't need a redeploy (#64).
- **Identity:** a clear name and look (#51).
- **Testing:** e2e tests of the whole flow in CI (#44, #61), and each of us plays the full flow with a test user.
- **Our four features in the user flow:** daily themes, Stanford mode, leaderboard, Beat the AI. Custom lobbies would replace one if we keep them.

**In scope:** daily and solo play, share-a-code lobbies. **Out of scope:** live multiplayer.

### The repo is public

Anything committed, including `public/` and `src/puzzles/`, is visible to everyone.
- Only the **practice pack** lives in the repo.
- **Daily, Stanford and lobby answers and images are never committed.** A seed/admin script loads them into the database from content kept outside the repo (#52), in the private `final-project-content` repo (#196).

## Week 8 milestone: three-image practice game (done)

All six items are done and live: tight initial crop, step-by-step Zoom out, guessing with alternate answers, live score, moving to the next image, and a final score screen (#22–#25, #27, #30–#33, #35, #37). Checkpoint 1 docs are on `main`.

---

## Division of work

Balanced by effort, not issue count (S = 1–2, M = 3, L = 4–5). Ownership areas aren't fences: **everyone** writes code, opens PRs, reviews a teammate's work, and plays the full flow.

**One reviewer per PR:** the owner of the area (#177). Database, migration and user-data work is reviewed by Jacky (Joseph reviews Jacky's own), and also by Ethan if it adds a user field. Darian's docs PRs, including this brief, are reviewed by Joseph.

### Final push (Final presentation milestone)

| Owner | Final push | Reviews | After everything else | Effort |
|---|---|---|---|---|
| **Darian** (`darian07-o`) | Shared CLIP module and Beat the AI solver (#56, L); Beat the AI badge and summary (#66, S); picker content, days 8–14 (#182, M); the batched docs PRs and the `TECHNICAL.md` trim (#166, M) | #179, #180, #181, #183, #185 | Create-a-round screen (#68); re-cut fingerprint (#131) | 11–13 |
| **Joseph** (`Joseph-G-McD`) | Image picker: find and download (#179, M), review page and export (#180, M), content for days 1–7 and the Stanford pack (#181, M); answer-leak check (#109) and seed error output (#110) (S); daily user-test follow-up (#185, S); merge #175 | #56 (module PR), #63, #65, #182, Darian's docs PRs | Practice photos (#114) | 11–13 |
| **Ethan** (`ethanyng`) | Leaderboard (#62, L); final UI pass with the name (#183, L; closes #51, #145, #147); login lockout (#151, S); `/play` prerender warning (#169, S); scoring values (#21: decide by Dec 2, or the "Prototype" label stays) | #109, #152, #167, #184, #88, #87 | Revision in the state key (#165); unreadable-game message (#164); flaky e2e (#170) | 10–13 |
| **Jacky** (`Hombobow`) | Streaks (#63, M); Stanford mode (#65, M); game limits per IPv6 /64 (#167) and the CSP (#152) (S–M); required E2E check and CODEOWNERS (#184, S); gitleaks `prepare` script (#88), `SECRETS.md` follow-ups (#87) and closing #60 (S); loading the picker content into preview and production (#181, #182, S) | #56 (solver PR), #62, #66, #110, #151, #169 | Lobbies backend (#67); per-pack scoring follow-ups (#174) | 11–14 |

**Everyone:** play the full flow on the final build with your own test user, and comment on #61, by end of Tue Dec 2. The daily can use the dev-only days from #181.

**Critical path:** find and download (#179) and the CLIP module (#56), in parallel → the review page (#180), or the `images:preview` fallback if it isn't usable by Nov 30 → content approved and seeded on dev by end of Dec 1 (#181, #182) → the solver writes `aiSolvedLevel` (#56) → Jacky loads preview and production by end of Dec 2. **Over Thanksgiving, #179, #180 and #181 all run through Joseph.** Beat the AI's badge (#66) shows nothing until the solver has run; the leaderboard (#62) takes `beatAiCount` from #66; Stanford mode's real pack (#65) comes from #181.

### Through Checkpoint 2

| Owner | Before Checkpoint 2 | Owns interface |
|---|---|---|
| **Darian** (`darian07-o`) | Week 9 plan (#46), per-level images (#57), game feel (#48), home and navigation (#50). Checkpoint 2: deciding which features ship (#94), the checklist (#97), recording the requirements (#96), consistent controls (#89), user test of home and navigation (#90), security audit (#95), user-test notes folder (#98), the "Home" link (#80), gitleaks check (#88) | `RevealLevel`, image fields of `PublicRound`, image endpoint |
| **Jacky** (`Hombobow`) | Schema with Joseph (#47), server-side games (#54), data protection (#60). Checkpoint 2: game-server rate limits (#85), `COST-CONTROLS.md` (#86), secrets and `SECRETS.md` (#87), user test of playing a game (#91), gitleaks check (#88) | `GuessOutcome`, `RoundState`, `ScoringEvent` (emits), `GameAction`, `PublicRound`, `GameView`, game server functions, `getScoringConfig` |
| **Ethan** (`ethanyng`) | Accounts (#53), accessibility (#49), full-flow e2e tests (#61); back link (#43) and Playwright (#45), both merged. Checkpoint 2: encryption and `ENCRYPTION.md` (#84), user test of signing up and logging in (#93), gitleaks check (#88) | `ScoringConfig`, `RoundResult`, `PublicUser`, `LeaderboardEntry`, account functions |
| **Joseph** (`Joseph-G-McD`) | Schema with Jacky (#47), packs and seed script (#52), daily challenge (#58). Checkpoint 2: user test of the daily challenge (#92), gitleaks check (#88) | `Puzzle`, `Pack`, `PackKind`, `DailyEntry`, database schema (with Jacky) |

---

## Shared interfaces

[`src/game/types.ts`](src/game/types.ts) is the **source of truth**; this section summarizes it. It's framework-independent (no React or Next imports).

The owner of each type makes the final call. Change a type only through a PR its owner reviews. `PROPOSAL` types can still change; settled ones change only by agreement.

| Type | Owner | Status | Issue |
|---|---|---|---|
| `Puzzle` | Joseph | Settled (#32). #52 made `id` opaque and added `aiSolvedLevel: RevealLevel \| null` (filled by #56). How `imageUrl` works per level is still open (with Darian, #57). Server-only data. | #52 |
| `RevealLevel` | Darian | Settled (#22) | |
| `GuessOutcome`, `RoundState` | Jacky | Settled (#22, #23) | |
| `ScoringEvent` | Jacky (emits), Ethan (consumes) | Settled (#22, #27) | |
| `ScoringConfig`, `RoundResult` | Ethan | Settled (#27) | |
| `PackKind`, `Pack`, `DailyEntry` | Joseph | Settled (#52), checked by `parseContent` in `src/game/packs.ts`. `DailyEntry.date` is in the reset time zone, midnight Pacific (#58). | #52, #58 |
| `GameAction` | Jacky | **Proposal**. Moved from `round.ts` (which re-exports it); same shape as before. | #54 |
| `PublicRound` | Jacky (image fields: Darian) | **Proposal** | #54, #57 |
| `GameView` | Jacky | **Proposal** | #54 |
| `PublicUser` | Ethan | **Proposal** | #53 |
| `LeaderboardEntry` | Ethan | **Proposal**. How "your own rank" is returned (e.g. `{ top, you }`) is decided in #62. | #62 |

### Server-side contracts

These are functions, not types in `src/game/`. They run only on the server.

- **Jacky (#54):** `startGame(packId, user | null) → GameView`, `act(gameId, action: GameAction, revision) → GameView`, where `revision` is the `GameView.revision` the player saw; a stale one is a conflict and changes nothing (#107), `getGame(gameId) → GameView` (resume after a refresh).
  - Route Handlers vs Server Actions is Jacky's call; the types are the contract.
  - The server reuses the framework-free logic in `src/game/` (guess checking, the round state machine, scoring).
  - Games belong to the logged-in user, or to an anonymous cookie if we allow anonymous play.
- **Jacky:** `getScoringConfig(packId) → ScoringConfig`, reading the per-pack override from the database (#64; Ethan owns the type and reviews). Streak queries (#63).
- **Ethan (#53):** `getCurrentUser() → PublicUser | null` and `requireUser()`, in a server-only module; register, login and logout. Leaderboard queries (#62).
- **Darian (#57):** an image endpoint or signed URL that returns only the image for the game's current level. Pre-cut images come from a script (e.g. `sharp`). Storage (Vercel Blob or Postgres) is decided with Jacky in #57.
- **Joseph (#52):** a seed/admin script that loads packs, puzzles and the daily schedule into Neon from content kept outside the public repo.
- **Database tables** (users, sessions, packs, puzzles, daily schedule, games/results, later lobbies): decided by Jacky and Joseph together, first, in #47.

### How the pieces connect

```
 Browser                               Server (server-only code)                    Neon / storage
 ───────                               ─────────────────────────                    ──────────────
 Game screen ──GameAction───────────►  startGame · act · getGame (Jacky, #54) ◄──►  games, results,
             ◄──GameView (no answer)─    reuses src/game/: checkGuess, step,        packs, puzzles,
                                         scoreRound + getScoringConfig (#64)        answers, schedule
 <img src=imageSrc> ────────────────►  image endpoint: current level only    ◄──►  per-level images
                                         (Darian, #57)                              (Blob or Postgres)
 Login / register ──────────────────►  getCurrentUser · requireUser (Ethan)  ◄──►  users, sessions
 Leaderboard ───────────────────────►  leaderboard queries (Ethan, #62)      ◄──►  results

 Offline scripts (never run in the browser):
   seed from non-public content (Joseph, #52) ──► packs, puzzles, schedule
   pre-cut images (Darian, #57) · Beat the AI solver (Darian, #56) ──► images, aiSolvedLevel
```

The server owns puzzles, answers, scoring and images. The browser only ever sees `GameView`, `PublicUser` and `LeaderboardEntry`.

**Known limitation:** everyone gets the same daily puzzles, so someone could learn the answers by skipping through on a second account. The leaderboard counts only each account's first game of the day (#62), which limits but doesn't stop it.

The sections below describe the settled types as they work today, in the practice game.

### `Puzzle` (owner: Joseph): finalized in #32, unchanged from the proposal

```ts
type Puzzle = {
  id: string;
  imageUrl: string;            // file in the app's static assets, or a URL
  answer: string;              // canonical answer, shown after the round
  acceptedAnswers: string[];   // alternates, compared after normalization
  reveal: {
    focus: { x: number; y: number }; // crop center, 0–1 fractions of width/height
    zoomLevels: number[];            // e.g. [8, 4, 2, 1]: index 0 = tightest crop, last = full image
  };
  credit: { source: string; license: string; url?: string }; // image source + usage permission
};
```

The three practice puzzles are in `src/puzzles/sample.json`, with images in `public/puzzles/` named by their opaque ids. Import them as `SAMPLE_PUZZLES`, and the practice pack as `PRACTICE_PACK`, from `src/puzzles/index.ts`. They're checked by `parsePuzzles` in `src/game/puzzles.ts` when the module loads, so bad data fails the tests and the build with a `PuzzleDataError` that names the field. Daily and Stanford puzzles go into the database through the seed script (`npm run db:seed`, #52), never into the repo.

### `RevealLevel` (owner: Darian): agreed in #22

- `type RevealLevel = number`: an integer from `0` (tightest crop) to `zoomLevels.length - 1` (full image).
- The viewer takes `puzzle.reveal` plus the current level and renders the crop. The viewer doesn't track score.
- With the round logic (#23): **Zoom out** dispatches `{ type: "reveal" }`, and the viewer renders `game.round.revealLevel`. At `maxRevealLevel` the round rejects a reveal as `fully-revealed`.
- In code: `ImageViewer` (#30) takes `puzzle`, `revealLevel` and `showFull` (show the whole image once the round is over). The crop math is framework-free in `src/game/crop.ts`. `ZoomOutButton` (#31) takes the round and an `onZoomOut` callback. When it can't zoom out, it's `aria-disabled` rather than `disabled`, so keyboard focus stays on it.

### `GuessOutcome` and round states (owner: Jacky): in code since #22 and #23

```ts
type GuessOutcome =
  | { kind: "correct"; matched: string }  // which answer matched, as written in the puzzle
  | { kind: "incorrect"; normalizedGuess: string }
  | { kind: "empty" };                     // blank guess: ignored, not counted as wrong (added in #22)

type RoundState = "playing" | "correct" | "skipped";
// playing → correct | skipped → next puzzle; after the last puzzle → final score screen
```

Normalization for the prototype (#22): Unicode NFKC, trim, collapse inner whitespace, lowercase. Normalization keeps accents, so under `exactMatch` "café" ≠ "cafe". **Typo tolerance:** Ethan (#21's assignee) decided it on #21 after the #115 user test; like the other #21 decisions, it can be revisited after more playtesting. The default matcher, `typoTolerantMatch` in `src/game/guess.ts`, ignores accents (including letters like ø, ł and ß, read as o, l and ss) and applies the rule **word by word**: guess and answer need the same number of words, and each word may have a few typos by its own length (none under 5 letters, 1 from 5, 2 from 9; a typo is an insert, delete, substitute or swap of two neighbouring letters). Each word's first letter (accents ignored) and digits must match, though a first letter swapped with the second ("aPris") counts as one typo, so "Lake Magunita", "Stanford Mall" or "Building 11" aren't accepted for "Lake Lagunita", "Stanford Hall" or "Building 10". A missing, extra or moved space alone is forgiven ("NotreDame", "Hoove rtower"). `checkGuess` runs every answer through the matcher and picks the closest accepted one: exact first, then fewest typos, then the canonical answer. `exactMatch` remains for any mode that wants no tolerance; choosing the matcher per pack can come with a pack setting later.

The round state machine is `step(game, action)` in `src/game/round.ts` (#23). Actions are `reveal`, `guess`, `skip` and `next`. Invalid actions are rejected with a reason instead of throwing.

### `ScoringEvent` (emitted by Jacky, consumed by Ethan): in code since #22, used unchanged by scoring (#27)

```ts
type ScoringEvent =
  | { type: "reveal"; puzzleId: string; revealLevel: number }
  | { type: "wrongGuess"; puzzleId: string }
  | { type: "correct"; puzzleId: string; revealLevel: number }
  | { type: "skip"; puzzleId: string };
```

### `ScoringConfig` and `RoundResult` (owner: Ethan): in code since #27, unchanged from the proposal

```ts
type ScoringConfig = {          // values are placeholders for playtesting, NOT decided
  basePoints: number;
  revealPenalty: number;        // per reveal step
  wrongGuessPenalty: number;    // per wrong guess
  minPoints: number;            // floor for a correct answer
  skipPoints: number;
};

type RoundResult = {
  puzzleId: string;
  outcome: "correct" | "skipped";
  revealLevelReached: number;
  wrongGuesses: number;
  points: number;
  breakdown: { base: number; revealPenalty: number; wrongGuessPenalty: number };
};
```

The values in use are in `src/game/scoring-config.ts`, and that's the only place to change them until per-pack values in the database land (#64). They're placeholders for playtesting (#21): 100 base, −20 per zoom-out, −10 per wrong guess, a floor of 10 for a correct answer, and 0 for a skip. `validateScoringConfig` rejects a floor above the base and a skip worth more than the floor. `scoreRound` and `scoreGame` in `src/game/scoring.ts` turn `ScoringEvent`s into `RoundResult`s and a total. For the live score, use `pointsIfCorrect(game.round.revealLevel, game.round.wrongGuesses)`.

---

## Open decisions

### Settled

| Decision | What we decided |
|---|---|
| Stack | Next.js 16 + React 19 + TypeScript, Tailwind, Vitest, Vercel, Neon (#9) |
| Accounts | Username and password. No password reset for now, so we don't store emails (#53). |
| Custom lobbies | Share a code and play any time, not live multiplayer (#67) |
| Where puzzles and progress live | Puzzles, games, results and sessions in Neon; answers only on the server (#47, #54) |
| Daily reset time | Midnight `America/Los_Angeles` (Joseph, #58). One place to change it: `DEFAULT_DAILY_RESET` in `src/game/daily-date.ts` (#63), dailyDateFor's default; the daily uses it, and streaks and the leaderboard should too. |
| Theme shown or hidden | Shown before the first image, on an intro screen ("Today: Fruit") (Joseph, #58) |
| Anonymous play | Anyone can play the daily without an account; only games started while logged in get leaderboard entries and streaks, and an anonymous game never moves to an account (Joseph, #58; Ethan and Jacky agreed in the reviews of #100 and #119). #62 and #63 filter on `user_id IS NOT NULL`. |
| Daily replays | One daily game per logged-in player per day, enforced by the database (#58, part 2); after it, you see your result. An anonymous player gets one per browser (cookie), which can't be enforced: a private window is a new player. |
| Image sourcing | An automated image picker (#179, #56, #180): openly licensed photos from Openverse, **CC0, public domain, CC BY or CC BY-SA** only (no NC or ND, since cropping is a change), at least ~3,000 px wide, credited and marked as cropped. A person approves every image. The Stanford pack may use picker photos or our own (#181). |
| Beat the AI | CLIP's labels are the day's answers plus a large committed list of generic wrong answers, never a day's real answers. CLIP suggests the top 3 starting points, and a person picks one. The solver runs after the final seed, on the stored level images, and writes `aiSolvedLevel` into the content too, so a re-seed keeps it. The badge says "view N of 5" (#56, #66). |
| Loading content into production | Jacky, who holds the preview and production credentials (#181, #182) |
| Image storage | Postgres. Each zoom level is cut ahead of time into its own WebP in `image_files`, served at `/img/<random id>.webp`; the server only sends the current level's URL. Not Vercel Blob, whose store and token only the Vercel owner could manage (#57; details in `TECHNICAL.md`) |
| Where non-public puzzle content lives | The private repo `cs193v-final/final-project-content`, cloned into each checkout's git-ignored `content/` folder (or symlinked there). All four of us push to its `main`; nothing from it is ever copied into this repo. The seed script still refuses content git would commit (#52, #196). |
| Name and look | **Squint** (Ethan's pick on #51; the team confirms in the PR's review), replacing the "Zoom Out" working title and the proposal's "Crumbscope". One place: `GAME_NAME` in `src/site.ts`. Look: "Picture Island" (#291, #302). |

### Still open (NOT settled)

Don't treat these as decided. Ask the owner, or keep them configurable.

| Decision | Notes | Issue |
|---|---|---|
| Scoring values and wrong-guess rules | Placeholders in `src/game/scoring-config.ts`; flat or increasing penalties; a guess limit? Decide by Dec 2, or the "Prototype" label on the home screen stays. A pack's values can change without a deploy (#64). | #21, #64 |
| Number of reveal steps | Fixed or per puzzle | #21 (typo tolerance: Ethan decided it on #21 after the #115 user test; see "`GuessOutcome` and round states") |
| Stanford mode | A fixed pack (suggested: no schema change), or its own daily rotation | #65 |

---

## Checklist for coding agents

1. **Read this brief and the repo's instructions first:** `README.md`, `AGENTS.md` and `INSTRUCTIONS.md`.
2. **Look at the current code** before writing any. Don't assume something exists because this brief plans it.
3. **Keep changes focused:** one issue per branch and PR. Never commit directly to `main` (it requires a PR and 1 approval).
4. **Coordinate before changing a shared interface** (every type in `src/game/types.ts`). Tag its owner in the PR.
5. **Never commit secrets.** Real values go in `.env.local`.
6. **The repo is public.** Never commit daily, Stanford or lobby puzzle answers or images.
7. **Document verification** in the PR: what you ran (tests, manual playthrough, devices) and what you saw.
