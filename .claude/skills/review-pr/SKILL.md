---
name: review-pr
description: Review a pull request in this repo by the rules in AGENTS.md → Code review. One reviewer; one full review, then only changes since the last reviewed SHA; blocking vs nit; replies in existing threads; at most one summary per round; stop before a third round. Use whenever someone asks to review, re-review or approve a PR here, or says "check changes since <sha>".
argument-hint: <PR number> [last reviewed SHA]
---

# Review a pull request

Arguments: `$ARGUMENTS`. The first is the PR number `<n>`. The second, if given, is the last reviewed SHA `<sha>`. The repo is `cs193v-final/final-project`, and the rules are in `AGENTS.md` → Code review; this is how to apply them. Never push to the PR's branch, merge it, or change repo settings from here.

## 1. Read what's already there
Before looking at the code:
- `gh pr view <n> --json number,title,body,author,isDraft,headRefOid,files,reviews,reviewRequests,reviewDecision,mergeStateStatus`
- `gh pr view <n> --comments` for the conversation.
- Review threads, with their resolved state and comment ids:
  ```
  gh api graphql -F n=<n> -f query='query($n:Int!){repository(owner:"cs193v-final",name:"final-project"){pullRequest(number:$n){reviewThreads(first:100){nodes{id isResolved isOutdated path line comments(first:50){nodes{databaseId author{login} body createdAt}}}}}}}'
  ```
- `gh api user --jq .login` is you. Several sessions can post from one account, so every earlier review from it is yours.

Then settle these, and tell the person what you found:
- **Are you the reviewer?** The PR names one: its `Reviewer (one):` line, or the requested reviewer. You can't approve your own PR. If you aren't the reviewer, say so and stop, unless the person says they're taking over or wants an opinion only (then post it as a comment, never an approval or a change request).
- **Database or user data?** If the PR touches `src/db/`, `drizzle/`, `src/auth/`, `src/crypto/`, a script that writes to the database, or what's stored about users, its reviewer is Jacky (`Hombobow`), or Joseph (`Joseph-G-McD`) for Jacky's own PRs. If that isn't you, say so to the person and at the top of your summary, and leave the approval to that owner unless the person says otherwise. If the PR adds or changes a user field, Ethan (`ethanyng`) reviews it too.
- **Full or follow-up?** No `<sha>` and no earlier review from you: full review. No `<sha>` but you've reviewed before: take the SHA from your latest `Reviewed up to` line (or that review's `commit.oid`), say so, and do a follow-up, not a second full review.
- **Which round?** A round is one of your earlier reviews of this PR that listed blocking findings; one-line re-approvals don't count. After two rounds, this is the third: check whether the earlier blockers are fixed, still read the new changes (security, database and user data line by line), and skip nits.
  - All fixed, nothing new blocking, CI passes: approve in one line.
  - A blocker still open, or a new one: don't post it as a review. Stop and tell the person. After their OK, post one plain PR comment (`gh pr comment <n>`, not a review) that tags the author and the reviewer, states each problem in a line or two, and asks them to settle it together. Never drop a real problem to avoid a round, and don't approve while one is open.

## 2. Get the changes
Don't check out the branch; the working tree may hold someone's work. Fetch the PR's commits, then use the `headRefOid` SHA from step 1 as `<head>` (shell variables don't carry over between commands):
```
git fetch origin pull/<n>/head
```
- **Full review:** `gh pr diff <n>`, everything the PR changes against `main`.
- **Follow-up after a rebase or force-push** (`git merge-base --is-ancestor <sha> <head>` fails): compare the old and new versions of the branch's commits:
  ```
  git fetch origin main <full sha>   # the old commits; the full SHA is in the review's commit.oid
  git range-diff origin/main <sha> <head>
  ```
  Review the commits marked `!` (changed) and `>` (new); `=` means unchanged. If the old commits can't be fetched, or the range-diff is too tangled to follow, do a full review instead. Either way, say which you used, in your summary too.
- **Follow-up otherwise:**
  ```
  git log -p --first-parent --diff-merges=remerge <sha>..<head>
  ```
  This shows the branch's own commits. For a merge of `main` it shows only how conflicts were resolved, and nothing for a clean merge, so you don't re-review teammates' code that came from `main`. `git diff <sha> <head> -- <file>` gives the net change to one file.
  If that's only clean merges or docs-only conflict resolutions and no blocker is open, re-approve in one line (step 4).

## 3. Review
Each finding is **blocking** or **nit**:
- **Blocking:** a bug, a failing check, missing tests for new logic, a security or data-protection problem, or a broken `AGENTS.md` rule: secrets and the public repo, data server-side, encrypted user fields, rate limits, a shared interface changed without its owner, a feature PR editing `TECHNICAL.md` or `README.md` beyond setup steps (ask for a "Docs to update" line instead).
- **Nit:** everything else (naming, wording, style, optional refactors). Nits are optional, never block approval, and never trigger another round.

Review only the diff in front of you. A problem in unchanged code is an issue to file, not a blocker. Don't flag what lint or typecheck already enforce. For each finding give the file and line, what goes wrong (a concrete case) and a fix. Be brief and plain.

Read these line by line, follow-ups included:
- **Database and migrations:** the migration matches `src/db/schema.ts` and works on tables that already have rows; queries are parameterized; only server code touches the database.
- **User data:** a new user field is encrypted (see `ENCRYPTION.md`); nothing reaches a client that shouldn't see it; no user data or secrets in logs or error messages.
- **Dependencies:** each new package is needed and maintained, and `package-lock.json` matches `package.json`.
- **CI and config** (`.github/`, `vercel.json`, `next.config.*`, `.gitleaks.toml`, `.githooks/`): nothing weakens the secret scan, the hooks, the required checks or token permissions.
- **Security:** auth and session checks, rate limits on new handlers that write to the database or cost money, input limits.
- `SECRETS.md`, `ENCRYPTION.md` and `COST-CONTROLS.md` are written by people: point out errors, but never suggest wording.

## 4. Write it up
- **A point that already has a thread:** reply there; don't open a new thread or repeat it in the summary. Reply to the thread's first comment:
  `gh api repos/cs193v-final/final-project/pulls/<n>/comments/<databaseId>/replies -f body='...'`
  When a blocker you raised is fixed, reply "Fixed in `<short sha>`" and resolve the thread:
  `gh api graphql -f id=<thread id> -f query='mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}'`
  Leave threads other people opened for them to resolve.
- **At most one summary review per round.** Post each new blocker as an inline comment in it. Put nits in the body instead, marked optional, each with its file and line: `main` won't merge while any review thread is unresolved, so an inline nit would block the merge until someone resolves it. End the body with `Reviewed up to <short sha>`. Write the JSON to a temporary file (`mktemp`) and post it with `gh api repos/cs193v-final/final-project/pulls/<n>/reviews --input <file>`:
  `{"commit_id": "<head>", "event": "REQUEST_CHANGES", "body": "...\n\nNits (optional):\n- src/...:12: ...\n\nReviewed up to <short sha>", "comments": [{"path": "src/...", "line": 42, "side": "RIGHT", "body": "**blocking:** ..."}]}`
- **Re-approvals are one line:** `gh pr review <n> --approve -b 'Changes since abc1234 fix the blocker. Reviewed up to def5678.'`

## 5. Verdict
- `gh pr checks <n>`: every check has to pass. If one is still running, wait (`gh pr checks <n> --watch`) or tell the person.
- No blockers and CI passes: `APPROVE`, with any nits in the body, marked optional, and no inline comments. Blockers: `REQUEST_CHANGES`. Not the reviewer: `COMMENT`.
- **Show the person the draft first** (thread replies, summary and verdict) and post only after they OK it.
- Afterwards, report what `gh pr view <n> --json reviewDecision,mergeStateStatus` says; don't predict whether the PR can merge. Once approved, the author adds it to the merge queue. Nobody merges `main` into it unless it says `DIRTY`.
