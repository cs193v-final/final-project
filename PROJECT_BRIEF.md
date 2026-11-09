# Zoom Out: Project Brief

> **Zoom Out** is a working title; the repo doesn't have a project name yet.
> This brief is for every teammate and every teammate's coding agent. Read it before you start work.
> Last updated: Nov 9, 2026.

## Status at a glance

| Area | Status |
|---|---|
| Game code (viewer, guessing, scoring, puzzles) | **Not started.** There is no app code in the repo yet. |
| Framework / language | **Not chosen.** CI in #7 assumes Node 24 + npm (`lint`, `typecheck`, `test` scripts). |
| Hosting + database | **In review.** Vercel project + Neon Postgres (dev / preview / prod) are set up in PR #3. |
| Secret-scanning hooks + CI | **In review.** gitleaks hooks in PR #5 and GitHub Actions CI in PR #7. |
| Course requirements summary | **In review.** `INSTRUCTIONS.md` in PR #1. |

Everything under "Project overview" and "Week 8 milestone" below is **planned**, not built.

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
- [ ] Guess submission, with correct answers recognized
- [ ] The score updates as you play
- [ ] Moving to the next image after a correct answer or a skip
- [ ] A final score screen

Checkpoint 1 also requires `PROGRESS.md`, `TECHNICAL.md` and an updated `README.md` on `main` (see `INSTRUCTIONS.md`, PR #1).

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

There's no app code yet, so there are no existing conventions. **Everything in this section is a PROPOSAL.** It's a minimal starting point to argue about, not a decision. It's written as TypeScript because CI expects a `typecheck` script; adapt it once we pick a framework.

The interface owner (table above) makes the final call. Change these only through a PR that the affected owners review.

### How the pieces connect

```
Puzzle data (Joseph) ──► Image viewer (Darian) ──RevealLevel──┐
        │                                                     ▼
        └── acceptedAnswers ──► Guess + rounds (Jacky) ──ScoringEvent──► Scoring (Ethan)
                                        │                                    │
                                        └──── round ends ────────────► RoundResult ──► Final score screen
```

### `Puzzle` (owner: Joseph): PROPOSAL

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

### `RevealLevel` (owner: Darian): PROPOSAL

- An integer from `0` (tightest crop) to `zoomLevels.length - 1` (full image).
- The viewer takes `puzzle.reveal` plus the current level and renders the crop. Clicking **Zoom out** asks the round logic to go up one level. The viewer doesn't track score.

### `GuessOutcome` and round states (owner: Jacky): PROPOSAL

```ts
type GuessOutcome =
  | { kind: "correct"; matched: string }  // which accepted answer matched
  | { kind: "incorrect"; normalizedGuess: string };

type RoundState = "playing" | "correct" | "skipped";
// playing → correct | skipped → next puzzle; after the last puzzle → final score screen
```

Normalization for the prototype: trim, collapse inner whitespace, lowercase. Typo tolerance is an open decision.

### `ScoringEvent` (emitted by Jacky, consumed by Ethan): PROPOSAL

```ts
type ScoringEvent =
  | { type: "reveal"; puzzleId: string; revealLevel: number }
  | { type: "wrongGuess"; puzzleId: string }
  | { type: "correct"; puzzleId: string; revealLevel: number }
  | { type: "skip"; puzzleId: string };
```

### `ScoringConfig` and `RoundResult` (owner: Ethan): PROPOSAL

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
| Framework / language | Nothing chosen. CI (#7) and Vercel (#3) assume a Node/npm web app. |
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

1. **Read this brief and the repo's instructions first:** `README.md`, plus `INSTRUCTIONS.md` and `AGENTS.md` if present.
2. **Look at the current code** before writing any. Don't assume something exists because this brief plans it.
3. **Keep changes focused:** one issue per branch and PR. Never commit directly to `main` (it requires a PR and 1 approval).
4. **Coordinate before changing a shared interface** (`Puzzle`, `RevealLevel`, `GuessOutcome`, `ScoringEvent`, `ScoringConfig`, `RoundResult`). Tag its owner in the PR.
5. **Never commit secrets.** Real values go in `.env.local`.
6. **Document verification** in the PR: what you ran (tests, manual playthrough, devices) and what you saw.
