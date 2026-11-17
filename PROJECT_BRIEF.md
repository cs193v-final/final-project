# Zoom Out: Project Brief

> **Zoom Out** is a working title. Picking the name and look is #51.
> This brief is for every teammate and every teammate's coding agent. Read it before you start work.
> Last updated: Nov 16, 2026 (Checkpoint 2 issues #84–#97).

## Status at a glance

As of 10 pm PST Mon Nov 16, 2026.

| Area | Status |
|---|---|
| Three-image practice game | **Live.** Start screen, `/play` with the viewer, Zoom out, guessing, live score and final score screen. Since #77 the game runs on the server, so the answers never reach the browser. Merged since Week 8: a back link on `/play` (#43, closes #42), Playwright e2e tests in CI (#45, closes #44), and punctuation-tolerant guesses (#72, closes #29). In review: practice puzzles that start on a less obvious detail, with smaller zoom steps (#117, for #112 and #113). |
| Home screen and navigation | **Merged** (#71, closes #50): a mode picker, and a site header with a way home from every screen. |
| Week 9 plan | **Done** (#69, closes #46): issues #47–#68, milestones, and the shared-type proposals. |
| Checkpoint 2 requirements | **Due 9 am PST Tue Nov 17.** Issues #84–#97, tracked in the checklist #97. The requirements are in `INSTRUCTIONS.md` §4 (#96). |
| Database schema | **Merged** (#74, closes #47), with database checks for zoom levels (#82). |
| Packs and seed script | **Merged** (#79, closes #52 and #36). |
| Server-side games | **Merged** (#77, closes #54): `/play` runs on the server with an anonymous owner cookie. |
| Per-level images | **Partly merged** (#83, part of #57): cutting each image into zoom levels, image storage and the `/img` route. The game doesn't use them yet. |
| Answer feedback (game feel) | **Approved, not merged yet** (#70, #48). |
| Data protection | **Partly merged** (#75, part of #60): TLS on every database connection, a check that no database variable is `NEXT_PUBLIC_`, and the stored-data inventory. Per-user access checks wait for accounts (#53). |
| Configurable scoring | **In review** (#76, #64). |
| Accounts | **In review, changes requested** (#103, #53): username and password, sessions and rate-limited login. |
| Daily streaks | **Logic merged** (#73, #81; part of #63). The query and the display wait for #53 and #58. |
| Daily themes | **In PR** (part of #58): today's pack and the intro screen (#100, approved), and playing today's daily, one game per player per day (#119, in review). Content not started: #55 and #59. |
| Accessibility, full-flow e2e tests | **Not started:** #49, #61. |
| Checkpoint 2 backend | **Started.** Game-server rate limits are in a draft PR (#104, for #85; it waits on #103). Security audit (#95): run, with its findings filed as #105–#111, and its findings on #83 fixed before #83 merged; `SECURITY-AUDIT.md` isn't written yet. Not started: encryption (#84), `COST-CONTROLS.md` (#86), secrets and `SECRETS.md` (#87), gitleaks on every checkout (#88). |
| Checkpoint 2 frontend | **Started.** Merged: shared controls for consistent buttons, links and headings (#102, part of #89), and the user-test notes folder (#99, closes #98). In review: notes from the playing-a-game user test (#116, part of #91), whose findings are #112–#115. Not started: the other user tests (#90, #92, #93), deciding which features ship (#94). |
| Leaderboard, Stanford mode, Beat the AI, name | **Not started** (Final presentation): #62, #65, #56 + #66, #51. Whether any move into Checkpoint 2 is #94. |
| Custom lobbies (stretch) | **Not started.** #67, #68 |
| Framework / language | **Chosen (#9):** Next.js 16 + React 19 + TypeScript, Tailwind CSS, Vitest. See `AGENTS.md` → Stack. |
| Hosting + database | **Set up.** Vercel + Neon Postgres (dev / preview / prod), from #3. The schema and migrations are merged (#74); the app has queried it since server-side games (#77). TLS is required on every connection (#75). See `README.md`. |
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
- **Daily themes** (Checkpoint 2): every day, 5 images from one theme (fruits, animals, landmarks, ...), the same for everyone. The theme is shown at the start ("Today: Landmarks"). It resets at a fixed time, and progress survives a refresh (#58, #55, #59).
- **Accounts** (Checkpoint 2): username and password. Passwords hashed with argon2 or bcrypt, sessions in Neon with `httpOnly`, `Secure`, `SameSite` cookies, rate-limited login, no emails as usernames, no password reset for now (#53).
- **Practice mode:** the three sample puzzles, kept in the repo.
- **Leaderboard:** a daily leaderboard per mode (and per lobby). Top 10 plus your own rank. Only server-calculated scores count (#62).
- **Streaks:** days played in a row (#63).
- **Stanford mode:** campus spots, flags, mascots. Our own photos where possible; logos and mascots only with a license that allows it (#65).
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
- **Daily, Stanford and lobby answers and images are never committed.** A seed/admin script loads them into the database from content kept outside the repo (#52). Where that content lives is an open decision (below).

## Week 8 milestone: three-image practice game (done)

All six items are done and live: tight initial crop, step-by-step Zoom out, guessing with alternate answers, live score, moving to the next image, and a final score screen (#22–#25, #27, #30–#33, #35, #37). Checkpoint 1 docs are on `main`.

---

## Division of work

Balanced by effort, not issue count. Ownership areas aren't fences: **everyone** writes code, opens PRs, reviews a teammate's work, and plays the full flow.

| Owner | Before Checkpoint 2 | After Checkpoint 2 | Stretch | Owns interface |
|---|---|---|---|---|
| **Darian** (`darian07-o`) | Week 9 plan (#46), per-level images (#57), game feel (#48), home and navigation (#50), daily content days 5–7 (#59). Checkpoint 2: deciding which features ship (#94), the checklist (#97), recording the requirements (#96), consistent controls (#89), user test of home and navigation (#90), security audit (#95), user-test notes folder (#98), the "Home" link (#80), gitleaks check (#88) | Beat the AI script (#56) and badge (#66) | Create-a-round screen (#68) | `RevealLevel`, image fields of `PublicRound`, image endpoint |
| **Jacky** (`Hombobow`) | Schema with Joseph (#47), server-side games (#54), data protection (#60). Checkpoint 2: game-server rate limits (#85), `COST-CONTROLS.md` (#86), secrets and `SECRETS.md` (#87), user test of playing a game (#91), gitleaks check (#88) | Streaks (#63), configurable scoring (#64), punctuation in guesses (#29) | Lobbies backend (#67) | `GuessOutcome`, `RoundState`, `ScoringEvent` (emits), `GameAction`, `PublicRound`, `GameView`, game server functions, `getScoringConfig` |
| **Ethan** (`ethanyng`) | Accounts (#53), accessibility (#49), full-flow e2e tests (#61); back link (#43) and Playwright (#45), both merged. Checkpoint 2: encryption and `ENCRYPTION.md` (#84), user test of signing up and logging in (#93), gitleaks check (#88) | Leaderboard (#62) | none | `ScoringConfig`, `RoundResult`, `PublicUser`, `LeaderboardEntry`, account functions |
| **Joseph** (`Joseph-G-McD`) | Schema with Jacky (#47), packs and seed script (#52), daily challenge (#58), daily content days 1–4 (#55). Checkpoint 2: user test of the daily challenge (#92), gitleaks check (#88) | Stanford mode (#65), name and identity (#51), start more zoomed in (#34) | none | `Puzzle`, `Pack`, `PackKind`, `DailyEntry`, database schema (with Jacky) |

Everyone: playtest, then settle the open gameplay decisions (#21).

**Critical path for Checkpoint 2:** schema (#47) → packs (#52) → server-side games (#54) → per-level images (#57), daily (#58), data protection (#60), e2e (#61). Land #47 first.

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
| `PackKind`, `Pack`, `DailyEntry` | Joseph | Settled (#52), checked by `parseContent` in `src/game/packs.ts`. The daily reset time zone is still open (#58). | #52, #58 |
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

Normalization for the prototype (#22): Unicode NFKC, trim, collapse inner whitespace, lowercase. Accents are kept, so "café" ≠ "cafe". Typo tolerance is an open decision (#21); `checkGuess` takes a pluggable `matcher` so it can be added without changing callers.

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
| Image storage | Postgres. Each zoom level is cut ahead of time into its own WebP in `image_files`, served at `/img/<random id>.webp`; the server only sends the current level's URL. Not Vercel Blob, whose store and token only the Vercel owner could manage (#57; details in `TECHNICAL.md`) |

### Still open (NOT settled)

Don't treat these as decided. Ask the owner, or keep them configurable.

| Decision | Notes | Issue |
|---|---|---|
| Daily reset time | Default proposal: midnight `America/Los_Angeles` | #58 |
| Theme shown or hidden | Shown before play, or hidden for a bonus? | #58 |
| Anonymous play | Default proposal: anyone can play daily; only logged-in players get leaderboard entries and streaks | #54, #62 |
| Where non-public puzzle content lives | **Proposal (#52):** each of us keeps it in the git-ignored `content/` folder, and the seed script refuses committable content. Still to decide: how we share the files with each other (e.g. a private repo or a shared drive). | #52 |
| Scoring values and wrong-guess rules | Placeholders in `src/game/scoring-config.ts`; flat or increasing penalties; a guess limit? | #21, #64 |
| Number of reveal steps; typo tolerance | Fixed or per puzzle; edit distance or none | #21 |
| Stanford mode | A fixed pack, or its own daily rotation | #65 |
| Name and look | "Crumbscope" (proposal), "Zoom Out" (app), or other | #51 |
| Image sourcing | Which licenses we accept; our own photos for Stanford | #55, #65 |

---

## Checklist for coding agents

1. **Read this brief and the repo's instructions first:** `README.md`, `AGENTS.md` and `INSTRUCTIONS.md`.
2. **Look at the current code** before writing any. Don't assume something exists because this brief plans it.
3. **Keep changes focused:** one issue per branch and PR. Never commit directly to `main` (it requires a PR and 1 approval).
4. **Coordinate before changing a shared interface** (every type in `src/game/types.ts`). Tag its owner in the PR.
5. **Never commit secrets.** Real values go in `.env.local`.
6. **The repo is public.** Never commit daily, Stanford or lobby puzzle answers or images.
7. **Document verification** in the PR: what you ran (tests, manual playthrough, devices) and what you saw.
