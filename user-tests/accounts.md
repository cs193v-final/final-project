# User tests: Sign up, log in and log out (#93)

**What the feature is for:** making an account, seeing that you're logged in, and logging out again.

## The task

Given to the tester word for word, and nothing else:

> "Create an account, check that you're logged in, then log out."

## Setup (before the tester arrives)

- [x] Device and browser ready: Ethan's laptop
- [x] Build: a branch running locally (`feat/encryption-84` @ `cd8803b`, which includes #103's accounts as of `f2bbcab`; #103's later review fixes in `a84d3ad` don't change sign-up or login), against Ethan's own Neon dev database
- [x] Start state: signed out, on the home screen
- [x] A test account: none needed; the tester made their own
- [x] This file open for notes

## Test 1

- **Tester:** Tester A (not in our group; no name or personal details)
- **Date:** 2026-11-16 · **Device and browser:** Ethan's laptop · **Run by:** Ethan
- **Build:** `feat/encryption-84` @ `cd8803b` (#103 as of `f2bbcab`), running locally

**Finished the task?** yes

**Path they took:**
1. Went to sign up and typed their full name, with a space, as the username. It was refused.
2. Typed the same name without the space. The account was created and they were logged in.
3. Refreshed the page, then went to the home screen. The header still showed them as logged in.
4. Logged out and logged back in without trouble.

**Paused, clicked the wrong thing or backed up:**
- Backed up once: the first username had a space in it and was refused. They fixed it straight away.
- Paused after signing up and after logging in: they were surprised to land on the account page (`/account`) rather than the home screen, which is where they expected to go.

**Moments I wanted to explain** (each one is a usability bug):
- That usernames can't contain spaces. The hint under the field says "3–20 letters, numbers, _ or -. Not an email address.", which rules out spaces without saying so, and the error says "Usernames can use letters, numbers, _ and - only."
- Why logging in shows the account page instead of taking you back to the game.

**Exit interview:**
- Logging in and out felt smooth, and it was clear they stayed logged in after a refresh and on the home screen.
- Surprised that logging in went to the account page: most sites send you back to the home page.

## Issues filed

- #132: After logging in or signing up, go to the home screen, not the account page (from Test 1; priority: medium)
- #133: Say "no spaces" up front for usernames, and in the error (from Test 1; priority: low)

## Changes made

- Sign-up and login now go to the home screen instead of the account page; the header shows the username, so it's still clear you're logged in (#132, PR #134, in review).
- The sign-up hint now says "with no spaces", and a username with a space gets an error that names the space as the problem (#133, PR #135, in review; the exact wording is still changing in review).
