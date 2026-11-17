# User tests: Home and navigation (#90)

**What the feature is for:** finding a way to play from the home screen, and getting back home from the game and the final score (#50).

## The tasks

Given one at a time, word for word, and nothing else:

1. > "Imagine a friend sent you this link. Find a way to play a game."
2. > "Now stop playing and go back to the page you started on."
3. > "Start a game again, play through all the pictures any way you like, and then get back to where you started."

## Setup (before the tester arrived)

- [x] Device and browser ready: Darian's computer, at http://localhost:3000 (browser not recorded)
- [x] Build: `main @ a836b73`, a production build (`next start`) on a local server with a freshly migrated and seeded database, so each zoom level was its own image (#57)
- [x] Start state: signed out, on the home screen, no game in progress
- [x] A test account: none prepared beforehand (the local database started empty)
- [x] Notes taken during the test

## Test 1

- **Tester:** Tester A (not in our group; no name or personal details)
- **Date:** 2026-11-16 · **Device and browser:** not recorded · **Run by:** Darian
- **Build:** `main @ a836b73`

**Finished the tasks?** yes, all three

**Path they took:**
1. Found **Start practice** on the home screen straight away.
2. Played the practice game: got Giraffe and Strawberry right away, and Golden Gate Bridge after one zoom out.
3. Found the way back to the start page easily. (Which control they used, the "← Home" link, the header's name or the browser's Back button, wasn't noted.)
4. Logged in without trouble. That wasn't one of the tasks; they tried it on their own.

**Paused, clicked the wrong thing or backed up:**
- None noted.

**Moments I wanted to explain** (each one is a usability bug):
- None noted.

**Exit interview and comments:**
- Said it's a fun idea.
- It "looks too AI": the look feels generic.
- The points should be explained in "How to play", not shown on every round.
- The screen needs a visual hierarchy: the **daily challenge should be bigger** than the other modes.
- The subtitle under the name, "Guess the picture from a tiny piece of it. The less you need to see, the more you score.", is too wordy. Suggested something simpler, like "Guess the picture. The less you see, the more you score."

## Issues filed

- #144: the home subtitle is too wordy (from Test 1)
- #145: make the daily challenge the most prominent mode (from Test 1)
- #146: explain points once in "How to play", not on every round (from Test 1)
- #147: the site looks generic, "too AI" (from Test 1; part of the identity work in #51)

## Changes made

- The subtitle now reads "Guess the picture. The less you see, the more you score." (#144, PR #148)
