# Security audit (Checkpoint 2, #95)

An LLM security audit of the code, as the Checkpoint 2 backend requirements ask. Claude (Claude Code) wrote this file; the course allows AI writing for it. Each finding is filed as a `security` issue with an owner and a priority, linked below.

**Date:** 2026-11-16 (PST). **Audited** (read-only, at these commits):

| Code | Commit | Status at the time |
|---|---|---|
| `main` (including #99, #102) | `04c845e` | merged |
| Server-side games, PR #77 | `8a67086` | approved, not merged |
| Per-level images, PR #83 | `aefd106` | in review |
| Accounts, PR #103 | `c6c8991` | in review |
| Daily challenge part 1, PR #100 | `167bec1` | in review |

**Method.** Four independent reviews, one per area: accounts; server-side games; per-level images; `main` with the daily intro, secrets, CI and dependencies. Each read the changed code in full and probed it in a throwaway copy: a production build (`next build` and `next start`) against a local Postgres or PGlite with the real migrations, Server Actions called over raw HTTP like an attacker's script, gitleaks run on fake secrets, and `npm audit`. **Verified** means confirmed in the code or by a probe; **suspected** means it depends on something we couldn't check offline (mostly Vercel's edge). The main findings were then re-checked in the code.

**Re-check after merging.** PRs #77, #83 and #103 may still change before they merge. When they do, re-check only what changed (the PR diffs since the commits above) and update this file.

## Summary

No critical or high findings. Answers don't reach the browser while a round is playing, a player can't reach anyone else's game, passwords and session tokens are handled well, there's no SQL injection, no secret was ever committed, and production dependencies have no known vulnerabilities.

The real gaps are **cost and abuse controls** (nothing is rate-limited or capped yet, #85), **app-level encryption of user data** (#84), **security headers**, and a few smaller hardening items.

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 10 |
| Low | 14 |
| Info | 4 |

## Medium

### M1. Anyone can lock any account out, even from an IP that is already blocked
- **Where:** `src/auth/accounts.ts:116-119` (#103). **Verified** (probe).
- **What happens:** login bumps the per-username counter before the per-IP check, and both block before the password is checked. Eleven bad logins on a username in 15 minutes make the owner's *correct* password return "rate-limited", and the attacker's own IP being over its limit doesn't stop it. Usernames will be public on leaderboards.
- **Fix:** check the IP limit first and return before touching the username counter; count only failed attempts per username; consider a delay rather than a hard block.
- **Owner:** Ethan. **Issue:** posted on #103; filed if still open after it merges

### M2. Login rate-limit rows grow without limit, and a very long username causes a 500
- **Where:** `src/auth/accounts.ts:100,116`, `src/db/accounts.ts:75-98`, `drizzle/0001_rate_limits.sql` (#103). **Verified** (probe).
- **What happens:** login never length-checks the username and stores it in a `rate_limits` key, even when the IP is blocked. Nothing calls `deleteExpiredRateLimits` or `deleteExpiredSessions`. One client can insert endless ~2.5 KB rows toward Neon's free 0.5 GB. A 4,000-character username exceeds the btree index limit and throws an unhandled error.
- **Fix:** reject usernames that fail the username rules before any database call; run both sweepers on a schedule (e.g. a Vercel cron).
- **Owner:** Ethan. **Issue:** posted on #103; filed if still open after it merges (related: #85)

### M3. What people type as a login username is stored in plain text, including emails and passwords
- **Where:** `src/auth/accounts.ts:52` (#103). **Verified** (probe: the table held `login:user:alice@stanford.edu` and `login:user:mysecretpassw0rd!`).
- **What happens:** people often type an email, or their password, into the username box. Those values stay in `rate_limits` indefinitely (see M2). That contradicts TECHNICAL.md's "no email is stored" and the course rule that user data is stored encrypted.
- **Fix:** key the row on an HMAC or SHA-256 of the normalized username, as IPs already are; reject invalid usernames before storing anything.
- **Owner:** Ethan. **Issue:** posted on #103; filed if still open after it merges (related: #84, #60)

### M4. Game state and game creation are unbounded
- **Where:** `src/game/server-game.ts:347`, `src/game/round.ts:131-136`, `src/server/games.ts:58-66` (#77). **Verified** (probe).
- **What happens:** every wrong guess appends an event, and every save rewrites and re-scores the whole state, so a script spamming wrong guesses makes the row and the work per request grow without limit (1,000 guesses: 52 KB of state, 11 s). Separately, `startGameAction` without a cookie creates a new owner and a new `games` row on every call (300 calls: 310 rows). Once a round's points reach the minimum, extra wrong guesses cost nothing, which for daily packs becomes a free answer-guessing loop.
- **Fix:** cap wrong guesses per round (or events per game); limit game starts per owner and per IP.
- **Owner:** Jacky. **Issue:** #85 (add these specifics there)

### M5. Image URLs with a query string skip the cache and read the full image from the database every time
- **Where:** `src/app/img/[file]/route.ts:5-8`, `src/server/images.ts:29-47` (#83). **Verified** in code; the CDN behavior is **suspected** (from Vercel's docs).
- **What happens:** the handler ignores the request URL, so `/img/<id>.webp?n=1`, `?n=2`, … are all valid. If the CDN keys on the query string, each request runs the function and reads 100–250 KB from Neon, with no rate limit, which would use up Neon's free monthly transfer after roughly 10–20 thousand requests. Misses on random valid-looking ids also hit the database every time.
- **Fix:** return 404 without a database read when the URL has a query string; put `/img` under #85's rate limits and in #86's cost doc.
- **Owner:** Darian. **Status:** fixed in #83 (`1bc32f0`): any query string is a 404 without a database read. (related: #85, #86)

### M6. The CDN may not cache images at all
- **Where:** `src/server/images.ts:39` (#83). **Suspected.**
- **What happens:** the route sends `Cache-Control: public, max-age=31536000, immutable` with no `s-maxage` or `CDN-Cache-Control`. As far as we know from Vercel's docs, its CDN only caches on those, so every new browser would hit the function and Neon, and TECHNICAL.md's "most loads never reach the database" would be false.
- **Fix:** add `CDN-Cache-Control: max-age=31536000` (or `s-maxage`), then check for `x-vercel-cache: HIT` on a preview deploy.
- **Owner:** Darian. **Status:** fixed in #83 (`1bc32f0`): `CDN-Cache-Control` added. Still to confirm on a preview deploy.

### M7. No security headers
- **Where:** `next.config.ts` (`main`): no `headers()`, no `proxy.ts`; `vercel.json` only sets the framework. **Verified** (`curl -I` on a production build).
- **What happens:** any site can frame the app (clickjacking), which matters once the login and sign-up forms land (#103). With no Content-Security-Policy, any future XSS runs unrestricted. `X-Powered-By: Next.js` is sent.
- **Fix:** add `headers()` in `next.config.ts` with a CSP (at least `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` and HSTS; set `poweredByHeader: false`.
- **Owner:** Ethan. **Issue:** #105 (related: #60)

### M8. `/daily` runs three uncached database queries on every request
- **Where:** `src/app/daily/page.tsx:30`, `src/db/daily.ts:31-32` (#100). **Verified.**
- **What happens:** the intro is the same for everyone until the next reset, but every anonymous request runs the schedule, pack and puzzle-order queries. A script loading `/daily` in a loop runs up Neon compute and Vercel invocations.
- **Fix:** cache the intro per date (e.g. `"use cache"` with a lifetime that ends at the reset), and rate-limit.
- **Owner:** Joseph. **Issue:** posted on #100; filed if still open after it merges (related: #85, #86)

### M9. User data isn't encrypted beyond Neon's at-rest encryption
- **Where:** `TECHNICAL.md:157` says so on purpose; `users.username` and `games.state` (which holds players' guesses) are plain columns in `src/db/schema.ts`. **Verified.**
- **What happens:** this misses the Checkpoint 2 requirement that information from users is stored encrypted, beyond Neon's built-in encryption. M3 adds to what needs covering.
- **Fix:** decide on per-field (or per-user) encryption, e.g. AES-GCM with a key per environment held in Vercel, then document it in `ENCRYPTION.md` (written by a person).
- **Owner:** Ethan. **Issue:** #84

### M10. gitleaks misses a bare Neon password
- **Where:** `.gitleaks.toml:7-25` (`main`). **Verified** (gitleaks 8.30.1 on fake values).
- **What happens:** the rules catch a full connection URL and `PGPASSWORD`, but not a Neon password (`npg_…`) on its own, e.g. a JSON `"password"` field, a `const pw = "npg_…"` or a URL with the password outside it. The hooks and the CI scan would both let it into the public repo.
- **Fix:** add a rule like `\bnpg_[A-Za-z0-9]{8,}\b` (keyword `npg_`) and a fake-value case in `scripts/test-hooks.sh`.
- **Owner:** Jacky. **Issue:** #106 (related: #87, #88)

## Low

| # | Finding | Where | Verified? | Owner | Issue |
|---|---|---|---|---|---|
| L1 | Per-IP login and sign-up limits treat every IPv6 address separately, so rotating within a /64 gets around them | `src/auth/accounts.ts:51`, `src/auth/session.ts:88-92` (#103) | verified in code | Ethan | on #103 |
| L2 | `x-forwarded-for` is trusted as-is. Safe behind Vercel's edge; spoofable on any other host. Prefer `x-vercel-forwarded-for` | `src/auth/session.ts:88-92` (#103) | suspected | Ethan | on #103 |
| L3 | Database errors log query parameters, including a username and password hash on a failed `insertUser` | `src/auth/session.ts:43`, account actions (#103) | verified (probe) | Ethan | on #103 |
| L4 | Logging in while logged in leaves the old session valid for 30 days; no limit on sessions per user | `src/auth/accounts.ts:127-128`, `src/app/account/actions.ts:16` (#103) | verified in code | Ethan | on #103 |
| L5 | An action from a stale tab is applied to a round that tab never saw; `conflict` only fires on overlapping requests. Send the revision with each action | `src/app/play/actions.ts:23`, `src/game/server-game.ts:326-352` (#77) | verified in code | Jacky | #107 |
| L6 | The owner cookie's `Secure` flag follows the request's `X-Forwarded-Proto`, so any unknown value means no Secure. Force Secure on Vercel; consider a `__Host-` name | `src/server/owner.ts:48-51,84-85` (#77) | verified | Jacky | #108 |
| L7 | Image height isn't capped: a 1200×12000 original gave a 9.3 MB level, likely over Vercel's 4.5 MB response limit. Cap pixels and add a size CHECK | `src/game/levels.ts:69-74`, `drizzle/0002_image_files.sql` (#83) | verified (probe) | Darian | fixed in #83 (`1bc32f0`) |
| L8 | The preview script writes inside the repo when the folder name starts with `..` (same bug fixed in the seed script) | `scripts/preview-levels.ts:58-59` (#83) | verified (probe) | Darian | fixed in #83 (`1bc32f0`) |
| L9 | `cutLevels` accepts any format sharp reads (SVG too) and decodes the original once per level at the same time. Allow only JPEG/PNG/WebP/HEIF, set `limitInputPixels`, cut levels one at a time | `src/images/cut.ts:34-61` (#83) | verified | Darian | fixed in #83 (`1bc32f0`) |
| L10 | gitleaks hooks are opt-in per checkout; a fresh clone or a GitHub web edit commits unscanned, with CI as the only backstop | `scripts/install-gitleaks.sh:89` (`main`) | verified | everyone | #88 |
| L11 | The answer-leak check misses plurals of short answers and initials: "Cat" in `cats.jpg`, "Fox" in `foxes-01.jpg`, "Mouse" in `mice.jpg`, "Golden Gate Bridge" in `GGB.jpg` | `src/game/packs.ts:181-198` (`main`) | verified (probe) | Joseph | #109 |
| L12 | When a query fails, the seed script prints drizzle's full error, including every parameter, so private daily answers can end up pasted into a public issue | `scripts/seed.ts:139-145` (`main`) | verified | Joseph | #110 |
| L13 | CI actions are pinned to tags, not commit SHAs, and `checkout` keeps its token while `npm ci` runs install scripts (the token is read-only and no secrets are used) | `.github/workflows/ci.yml` (`main`) | verified | Jacky | #111 |
| L14 | TECHNICAL.md is out of date in places: §3 says nothing is stored yet, §5 says the reset time is undecided, and the TLS line overstates what the seed script checks | `TECHNICAL.md` (`main`, #100) | verified | Jacky (with Joseph) | #60 |

## Info (no issue needed, or already planned)

- **I1.** While a round is playing, the browser still gets the full image (`imageSrc: puzzle.imageUrl`), so the reveal levels can be bypassed. Fine for practice; must be fixed before daily, Stanford or lobby packs. That's the #57 follow-up (Darian).
- **I2.** Old image ids keep working for up to a year after a re-cut, because they're cached as `immutable`. The only way to take an image back is a Vercel cache purge; document it.
- **I3.** Daily content at about 1.7 MB a day fills Neon's free 0.5 GB in about 10 months. Belongs in `COST-CONTROLS.md` (#86).
- **I4.** Failed queries log their parameters on the server (an owner hash, a player's last guess, an image id). No answers, tokens or connection strings. Note under #60.

## Checked and found sound

- **Answers stay on the server** (#77): no answer or accepted answer in any Server Action response, the page HTML, the RSC payload or the JavaScript bundle while a round is playing. Accepted alternates are never sent. `/play` is `private, no-store`.
- **Access control** (#77): someone else's game, no cookie, or a malformed id all look like "not found". The owner only ever comes from the cookie. Game ids are random UUIDs.
- **Input validation** (#77): `parseGameAction` rejects non-objects, a non-string guess and guesses over 200 characters, drops unknown fields, and isn't fooled by `__proto__` payloads. Scores are recomputed on the server; no action takes a score.
- **Concurrency** (#77): 20 simultaneous actions gave 1 success and 19 conflicts, with nothing applied twice.
- **CSRF:** Server Actions reject a cross-origin `Origin`; cookies are `SameSite=Lax`; logout is a POST form.
- **Passwords and sessions** (#103): argon2id with a random salt and timing-safe comparison; an unknown username still runs a hash, so timing doesn't reveal accounts; 32-byte session tokens stored only as SHA-256; `HttpOnly`, `Secure`, `SameSite=Lax` cookies; a new token on every login; logout deletes the session on the server; huge passwords are capped.
- **Usernames** (#103): 3–20 ASCII letters, digits, `_` and `-` after NFKC, so they can't be emails or lookalike characters; unique regardless of case.
- **SQL:** every value is a bound parameter. The only `sql.raw` (`src/db/content.ts:56-59`) takes schema column names, not input.
- **TLS** (`main`, #77): every connection requires TLS except loopback. Fuzzed with about 20 tricky URLs (`host=` overrides, encoded hosts, multiple hosts); no remote host was ever exempted.
- **Images** (#83): the file name is strictly validated (path traversal and odd names get a 404 without a database read); ids are 128 random bits; no listing endpoint; 404s aren't cached; `nosniff` is set; EXIF, GPS, XMP and ICC metadata are stripped from every level (tested with a planted answer); `sharp` never reaches the app.
- **Daily intro** (#100): sends only the date, title, theme and image count; the full pack stays on the server.
- **Secrets and history:** gitleaks over all 114 commits found nothing; no `.env` or `content/` file was ever committed; the committed practice images have no GPS; `.env*` and `content/` are ignored by git and Vercel; CI uses read-only permissions, `pull_request` (not `pull_request_target`) and no secrets.
- **Dependencies:** `npm audit --omit=dev` found 0 vulnerabilities; the full audit found 11 moderate, all in dev dependencies, and none high or critical.

## Course requirements this audit touches

- **Encryption** of user data beyond Neon at rest: not done yet (M9, M3; #84). `ENCRYPTION.md` is written by a person.
- **Cost controls:** no rate limits or caps yet (M2, M4, M5, M6, M8; #85). `COST-CONTROLS.md` is written by a person (#86).
- **Secret stewardship:** hooks and CI scanning work, with two gaps (M10, L10; #87, #88). `SECRETS.md` is written by a person (#87).
- **Encryption in transit:** TLS to the database is enforced. Nothing is sent between users yet (lobbies, #67). HSTS isn't set by the app (M7).
