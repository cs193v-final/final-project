# CS193V Final Project — Instructions & Summary

> **Current focus (as of Nov 6, 2026): Checkpoint 1** (Week 8 check-in)
> The miniproject requirements also apply, because they set up the codebase.

## Source links

| Page | Link |
|---|---|
| Final Project Logistics | https://web.stanford.edu/class/archive/cs/cs193v/cs193v.1272/project/ |
| Miniproject | https://web.stanford.edu/class/archive/cs/cs193v/cs193v.1272/project/miniproject/ |
| Checkpoint 1 | https://web.stanford.edu/class/archive/cs/cs193v/cs193v.1272/project/checkpoint-1/ |

Related pages (not summarized here): [Project Proposal](https://web.stanford.edu/class/archive/cs/cs193v/cs193v.1272/project/project-proposal/) · [Dev Environment](https://web.stanford.edu/class/archive/cs/cs193v/cs193v.1272/cs193v-dev/)

---

## 1. Final Project Logistics (the big picture)

- **Team of 4**, **4 weeks**, about 100 hours in total (4 people × 6 hrs/week × 4 weeks). Any stack or medium is allowed.
- Aim for **medium scale, done well**. Something you could build in an evening is too small.
- **Everyone must be a technical contributor.** The GitHub history (issues, PRs, commits) must show each member regularly taking on nontrivial technical work.

### Timeline
| When | Deliverable |
|---|---|
| Thu Wk 6, 1PM | Team roster |
| Thu Wk 7, 1PM | Miniproject + Project Proposal |
| Wk 8 (W/Th/F) | **Check-in 1**: deliverables due 24 hrs before the meeting |
| Wk 9 (W/Th/F) | Check-in 2: deliverables due 24 hrs before the meeting |
| Wk 10 (W/Th/F) | Final project due 24 hrs before the final presentation (public) |

All members attend both check-ins and the final presentation **in person**.

### Grading
| Component | Weight |
|---|---|
| Individual technical contributions | 30% |
| Engineering practices (secrets, testing, user interviews, …) | 25% |
| Functionality | 20% |
| Creativity | 10% |
| Scale | 10% |
| Proposal + miniproject + check-ins (each graded 0/1) | 5% |

---

## 2. Miniproject (codebase foundations, still relevant)

A collaboration "dry run" whose requirements make a good baseline for the real project:

- [ ] Web app, **deployed live to the web**
- [ ] Connects to a **backend database**
- [ ] **Encrypt sensitive user data** in the DB
- [ ] Passwords **hashed and salted**
- [ ] **Extensive tests**, added incrementally with each feature or bug fix
- [ ] Each member files at least one GitHub issue **assigned to a different teammate**
- [ ] Each member gets at least **2 approved PRs**, each **closing a linked issue**
- [ ] `main` holds the final code, and `README.md` includes the **live URL**

### Deployment gotcha (Vercel free tier)
- Free tier doesn't support team collaboration. You can't `vercel link` a project you don't own.
- `vercel deploy` hangs at "Building…" if your email doesn't match the author of the latest commit.
- Options: (1) **one person owns all deploys**, and pushes a no-op commit to `main` first; (2) use **Cloudflare Workers** (free collaboration); (3) wait for Stanford Vercel accounts; (4) pay for Vercel.

---

## 3. Checkpoint 1 (CURRENT)

**Due 24 hours before the Week 8 meeting with our staff contact.** Everyone attends in person.

### Step 1: Repo setup
- [ ] One member creates the GitHub repo (per the course "Repo Setup" instructions)
- [ ] **Every** member creates a GitHub personal access token for their coding agent
- [ ] One member submits the repo URL via the course form

### Step 2: Prototype (doesn't need to be finished)
- [ ] An **early prototype**, e.g. clickable main screens or one feature partly or fully working
- [ ] **Clearly mark placeholders vs. working features** (sample data vs. live data)
- [ ] A clear **division of technical work** and a realistic plan for what's next

**Engineering practices:**
- [ ] Tests, written and used appropriately
- [ ] GitHub Issues for work, bugs, and priorities
- [ ] **Never commit directly to `main`**. Use PRs.
- [ ] Encrypt database contents
- [ ] Secure secrets and credentials (never commit them)
- [ ] *Consider:* style guide + linter, CI + merge queue, gitleaks, required PR approvals

### Step 3: Required files (on `main`)
- [ ] **`PROGRESS.md`**
  - Progress so far (built, tried, works, learned)
  - Changes from the proposal (vs. Week 8 goals, scope changes)
  - Problems and blockers (what was tried, where help is needed)
  - Team contributions and next steps (each person's technical work, Week 9 priorities with owners, how each will be verified)
- [ ] **`TECHNICAL.md`**
  - Main components and what each does
  - Tools and services (frameworks, APIs, DBs) and why
  - What data is stored and where
  - Secrets and user info, and how they're protected (**no real secrets in the file**)
  - Open questions and how we'll investigate them
- [ ] **`README.md`**
  - Link to the live site (or a demo video)
  - Steps to run your own copy (service accounts, env vars, etc.)

Keep these brief and bulleted, in our own words. AI polishing is OK.

### Step 4: Before the check-in
- [ ] All three `.md` files and all code are on `main`
- [ ] Course staff can access every linked resource
- [ ] Issue tracker is up to date
