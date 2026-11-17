# User tests: Playing a game (#91)

**What the feature is for:** playing a practice game: guessing each image, zooming out when stuck, skipping, seeing the final score and playing again.

## The task

Give the tester exactly this, word for word, and nothing else:

> "Play a full game and try to get as many points as you can. When you've finished, start another game."

If they ask what to do, or how something works: "Do whatever you'd try if I weren't here."

## Setup (before the tester arrives)

- [x] Device and browser ready: MacBook Pro, Brave
- [ ] Build: server-side games, `feat/server-games-54 @ 8a67086` (PR #77) running locally on port 3001, against the dev database
- [ ] Start state: a **private/incognito window** (so there's no old game cookie) open on `http://localhost:3001/play`, a fresh game on image 1
- [ ] A test account: not needed (practice is played without logging in)
- [ ] This file open for notes

## Test 1

- **Tester:** Tester A (not in our group; no name or personal details)
- **Date:** 2026-11-17 · **Device and browser:** MacBook Pro, Brave · **Run by:** Jacky
- **Build:** `feat/server-games-54 @ 8a67086`

**Finished the task?** Yes. They finished a game and started a second one.

**Path they took:**
1. Played through the images, typing guesses (Return submits a guess, the same as clicking Guess).
2. Never zoomed out: guessed every image from the first view.
3. Got one image marked wrong because of a typo in an otherwise correct answer.
4. Finished the first game with 290 points (one wrong guess, the typo).
5. Started a second game and scored 300 (every image right on the first guess).

**Paused, clicked the wrong thing or backed up:**
- No wrong clicks.
- Paused after the typo was marked wrong, although they knew the answer.

**Moments I wanted to explain** (each one is a usability bug):
- None. They never needed an explanation.

**What worked:** the UI was relatively intuitive; Return works the same as clicking Guess. They navigated the game confidently.

**Exit interview:**
- **The first view is too zoomed out:** it's easy to tell what the image is right away.
- **Each zoom-out gives away too much.** (They didn't zoom out during the task, so this came from the exit interview.)
- **The images are a little too simple** (easy subjects).
- **Overall, the game felt "not complicated enough".**

<!-- For the next tester, copy the whole "Test 1" section and number it. -->

## Issues filed

<!-- One issue per problem, labeled `user-test`, with an assignee and a priority. -->

- #112: the first view is too zoomed out, so images are easy to identify (Test 1)
- #113: each zoom-out reveals too much (Test 1)
- #114: the practice images are too simple (Test 1)
- #115: a correct answer with a typo was marked wrong (Test 1)

## Changes made

- What changed (#issue, PR #n)
