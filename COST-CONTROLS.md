1. Services the app uses
We do not use an LLM, email, or other paid APIs yet.
Nothing in our source code calls an outside service.
We currently only use Vercel (hobby plan) and Neon Postgres (free plan)

2. Cost and Limits
Vercel 
- We use this to host our server files, run our functions, and run our daily cron jobs
- Hobby plan costs nothing and never bills you
- The limits that matter for us is 1M function invocations a month, 4 hours of active 
CPU a month, and a limited fast data transfer (100 GB). 
However, if you go pass a limit it turns off that feature until the 30 day window resets 

Neon Postgres
- Neon is a hosted postgres database where the app stores everything that has to last
between requests. Vercel doesn't store anything after a request ends so we need Neon to
store anything that has to be remembered 
- We use neon to store users, games, packs and puzzles, rate-limit counters, and the
puzzle images
- The free plan never bills you
- The limits that that matter for us is 100 CU-hours, 1 GB of storage, and 5 GB a month
of data that is sent out of Neon (network transfer, also called egress)
- When compute hours or transfer is used up neon suspends the projects database until next
month and when the 1 GB of storage is used up reads still work, but inserts, updates, and 
deletes all fail and only the affected project goes down e.g. if production runs out, dev
and preview keep working. 

3. How we limited use
We created login and sign up limits logins tries per username (10 per 15 minutes), login 
tries per IP address (30 per 15 mins), sign ups per IP address (5 per hour).

New games per player (30 per hour), new games per IP address (300 per hour), moves per player 
(120 per minute), moves per IP address (600 per minute), unfinished games per pack per player 
(10 at anytime). All counters are stored in postgres.

At most 10 sessions per users on the game (with each lasting 30 days and logging in deletes 
the extra and expired ones), sweep runs once a day 4:17 UTC. It deletes expired session and 
rate limit rows, whose windows started more than 1 hour ago.

Images are cached for 1 year, and requests with a query string are refused.

4. Known gaps
- Invocation quota: one IP address can still use up Vercel's 1M invocations, because a refused
request still runs a function.
- Neon compute: a slow, steady trickle of requests keeps the database awake and uses up its
compute hours, and every refused request still runs one database query.
- IPv6 addresses can be rotated to get around the IP limits.
- Unfinished-game cap: the cap isn't atomic, so a burst of requests can go slightly over 10.
