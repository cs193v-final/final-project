# Zoom Out: Project Brief

> **Zoom Out** is a working title; the repo doesn't have a project name yet.
> This brief is for every teammate and every teammate's coding agent. Read it before you start work.
> Last updated: Nov 10, 2026.

## Status at a glance

| Area | Status |
|---|---|
| Game code (viewer, guessing, scoring, puzzles) | **In progress.** Merged: guess checking (#22) and the round state machine (#23), as framework-free logic in `src/game/`, plus the Next.js scaffold (#24) with a placeholder home page. Guess UI is in review (#25). Viewer (#10, #11), scoring (#15, #16) and puzzle data (#17) are not started. |
| Framework / language | **Chosen (#9):** Next.js 16 + React 19 + TypeScript, Tailwind CSS, Vitest. See `AGENTS.md` → Stack. |
| Hosting + database | **Set up.** Vercel project + Neon Postgres (dev / preview / prod), merged in #3. See `README.md` for local env setup. |
| Secret-scanning hooks + CI | **Set up.** gitleaks hooks (#5) and GitHub Actions CI (#7) are merged. Run `scripts/install-gitleaks.sh` after cloning. |
| Course requirements summary | **Done.** [`INSTRUCTIONS.md`](INSTRUCTIONS.md), merged in #1. |

Everything under "Project overview" below is **planned**, not built. The Week 8 checklist notes what's already in code.

---

## Project overview (planned)

A **daily image-guessing game**. Each image starts tightly zoomed in. Players either submit a guess or click **Zoom out** to reveal more of the image. Each reveal lowers the points available. Wrong guesses also cost points; the exact rules are still to be decided.

**Final version:**
- **Five images per day**, the same for every player
- A **practice mode**
- Saved daily progress
- Alternate accepted answers and basic typo handling
- Score breakdown and streaks
- Spoiler-free result sharing
- A **content editor** for preparing and scheduling challenges

**In scope:** daily and solo play. **Out of scope for now:** live multiplayer.

## Week 8 milestone: three-image practice game

A playable prototype to test the core gameplay before we build the daily-challenge system:

- [ ] An image starts with a tight crop
- [ ] A **Zoom out** button reveals more, step by step
- [ ] Guess submission, with correct answers recognized *(logic merged in #22 and #23; UI in review in #25)*
- [ ] The score updates as you play
- [ ] Moving to the next image after a correct answer or a skip *(logic merged in #23; UI in review in #25)*
- [ ] A final score screen

Checkpoint 1 also requires `PROGRESS.md`, `TECHNICAL.md` and an updated `README.md` on `main` (see `INSTRUCTIONS.md`).

---

## Initial division of work

These are starting ownership areas, not fences. **Everyone** writes code, opens PRs, reviews another teammate's work, and helps test the integrated game.

| Owner | Area | Responsibilities | Owns interface |
|---|---|---|---|
| **Darian** (`darian07-o`) | Image viewer + reveal controls | Image display and initial crop; progressive zoom-out steps and the reveal button; expose the current reveal level for scoring; works on desktop and mobile | `RevealLevel` |
| **Jacky** (`Hombobow`) | Guess validation + round progression | Guess submission and answer checking; normalization (case, whitespace); round states, correct answers, skips, advancing. Coordinates with Joseph (accepted answers) and Ethan (scoring events) | `GuessOutcome`, round states, emits `ScoringEvent` |
| **Ethan** (`ethanyng`)* | Scoring + results | Points earned and deductions for reveals and wrong guesses; per-round and total scores; final score screen; keep scoring rules configurable during playtesting | `ScoringConfig`, `RoundResult` |
| **Joseph** (`Joseph-G-McD`)* | Puzzle data + game entry | Puzzle data format; load the three sample puzzles; accepted answers and crop/reveal settings in the data; start screen and instructions; record image sources and usage permissions | `Puzzle` |

\* Not yet added to the GitHub repo.

---

## Shared interfaces

These types now live in code in [`src/game/types.ts`](src/game/types.ts) (#22). **That file is the source of truth;** this section summarizes it. Each type is marked with its status: **PROPOSAL** until its owner has signed off, otherwise the PR where it was settled.

The interface owner (table above) makes the final call. Change these only through a PR that the affected owners review.

### How the pieces connect

```
Puzzle data (Joseph) ──► Image viewer (Darian) ──RevealLevel──┐
        │                                                     ▼
        └── acceptedAnswers ──► Guess + rounds (Jacky) ──ScoringEvent──► Scoring (Ethan)
                                        │                                    │
                                        └──── round ends ────────────► RoundResult ──► Final score screen
```

### `Puzzle` (owner: Joseph): PROPOSAL, in code unchanged, awaiting Joseph's review

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

The prototype loads three puzzles from a static file (e.g. `puzzles/sample.json`). Where daily puzzles will live is an open decision.

### `RevealLevel` (owner: Darian): agreed in #22

- `type RevealLevel = number`: an integer from `0` (tightest crop) to `zoomLevels.length - 1` (full image).
- The viewer takes `puzzle.reveal` plus the current level and renders the crop. The viewer doesn't track score.
- With the round logic (#23): **Zoom out** dispatches `{ type: "reveal" }`, and the viewer renders `game.round.revealLevel`. Disable the button when `revealLevel === maxRevealLevel` (the round rejects it as `fully-revealed`).

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

### `ScoringEvent` (emitted by Jacky, consumed by Ethan): PROPOSAL, in code unchanged, awaiting Ethan's review

```ts
type ScoringEvent =
  | { type: "reveal"; puzzleId: string; revealLevel: number }
  | { type: "wrongGuess"; puzzleId: string }
  | { type: "correct"; puzzleId: string; revealLevel: number }
  | { type: "skip"; puzzleId: string };
```

### `ScoringConfig` and `RoundResult` (owner: Ethan): PROPOSAL, not in code yet

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

Keep `ScoringConfig` in one place so playtesting tweaks are a one-line change.

---

## Open decisions (NOT settled)

| Decision | Notes |
|---|---|
| Scoring values | Base points, reveal and wrong-guess penalties, the minimum, and what a skip earns. |
| Wrong-guess rules | Flat penalty? Increasing? A guess limit per image? |
| Number of reveal steps | Same for every image, or set per puzzle? |
| Typo tolerance | How far a guess can be off (edit distance? per-answer?), and how it interacts with alternate answers. |
| Daily reset time | Time and time zone, so every player sees the same five images. |
| Persistence approach | Neon Postgres is provisioned (#3), but what gets stored (daily progress, streaks, puzzles) and where (browser vs. database, accounts or not) is open. |
| Puzzle storage + editor | Static files vs. database; how the content editor schedules challenges. |
| Image sourcing | Where images come from and which licenses we accept. |

---

## Checklist for coding agents

1. **Read this brief and the repo's instructions first:** `README.md`, `AGENTS.md` and `INSTRUCTIONS.md`.
2. **Look at the current code** before writing any. Don't assume something exists because this brief plans it.
3. **Keep changes focused:** one issue per branch and PR. Never commit directly to `main` (it requires a PR and 1 approval).
4. **Coordinate before changing a shared interface** (`Puzzle`, `RevealLevel`, `GuessOutcome`, `ScoringEvent`, `ScoringConfig`, `RoundResult`). Tag its owner in the PR.
5. **Never commit secrets.** Real values go in `.env.local`.
6. **Document verification** in the PR: what you ran (tests, manual playthrough, devices) and what you saw.
