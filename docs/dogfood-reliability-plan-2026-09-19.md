# Dogfood reliability plan — 2026-09-19

**Goal:** 9 tasks (3 repos x small/medium/large) each reach a raised GitHub PR, with at
most 2 human touches per task, and every harness defect found on the way captured and
fixed. Task quality is not the metric. *Harness* reliability is.

Scope note: model/reasoning selection per workflow step is a separate workstream. This
plan tags its tasks with experiment IDs so that data is usable there, but it does not
choose or compare models.

## Success metric

One number, measured per wave:

> **PR-reach rate** = tasks that raised a PR / tasks launched.

Baseline from the live store (last 50 tasks, `.data/tasks.sqlite3`):

| | count |
|---|---|
| Tasks launched | 50 |
| Reached `approval` + `completed` | 7 |
| Raised a PR | 9 (all time, all on `agent-harness-ui`) |
| PRs on `eversor-plancheck` | 0 |
| PRs on `eversor-mystrataassist` | 0 |

**Baseline PR-reach rate: 14% overall, 0% on the two Eversor repos.**

Where the other 43 died (`current_stage` at archive/cancel):

| stage | dead tasks |
|---|---|
| plan | 7 |
| specification | 6 |
| implement | 8 |
| dev-review | 5 |
| triage | 5 |
| grill | 3 |
| test | 2 |
| final-review | 1 |

Targets: wave 1 >= 50%, wave 2 >= 75%, wave 3 >= 90% with the same task ladder.

## Wave 0 — pre-flight (do this before spending any agent hours)

Five blockers are already identified from code and live data. Four are cheap. Fix them
first; every one of them would otherwise burn a whole task run before revealing itself.

### 0.1 Specification and Plan gates cannot auto-advance — **the main cause of death**

`server/gate-policies.mjs:8` — `GATE_STAGES` is only `dev-review`, `test`,
`final-review`. `grillPolicy` is separately auto (settings confirm
`"grillPolicy":"auto-accept-recommendations"` and all three gate policies auto), but
`awaiting-spec-approval` and `awaiting-plan-approval` have no policy at all. A task
parks there until a human clicks. 13 of the last 50 tasks died exactly there.

`docs/auto-approve-gates-proposal.md` is the design; AH-081 and AH-084 ("Gate auto-run
more options in settings") were both raised for this and both abandoned.

**Done 2026-09-19.** `Specification`, `Plan` and `Implement` joined the existing
`gatePolicies` map and the Gate auto-run settings card. `manual` remains the default for
every stage, so nothing changes until the operator opts a stage in.

Implement was the third missing link, and it was not in the original diagnosis:
`approvePlan` parks on `ready-for-implementation` without starting a run, so even with
both approval gates automatic the task would still have waited for a human to press
Implement. AH-072 is sitting in exactly that state in the live store.

Turning all six on takes a task from Triage to Human Approval with no clicks except Grill
answers. The trust model is preserved rather than waived:

- automatic approvals go through the same `approveSpecification` / `approvePlan` path a
  person uses, so a stale plan, an unexecutable plan and the fast profile's
  single-package rule still refuse and leave the task parked with the reason recorded —
  the gate fails closed, never open;
- every approval now carries `automatic`, so an automatic approval is never counted as
  evidence a person read the artifact;
- Candidate and Merge stay manual and are not settable.

One consequence to know before opting in: for an `investigate` workflow, the approved
specification *is* the deliverable, so automatic specification approval completes the
task outright.

### 0.2 `eversor-plancheck` has no `origin` remote

```
evesor-plancheck  https://github.com/EversorAI/eversor-plancheck
```

The remote name is misspelled and `origin` does not exist. `GitHubPullRequestManager`
tolerates this on publish (`#deliveryRemote` enumerates remotes), but
`fetchTarget(candidate, { remoteName = "origin" })`
(`server/github-pull-request.mjs:124`) and the candidate-refresh caller
(`server/orchestrator-candidate-operations.mjs:164`, `?? "origin"`) both default to
`origin`. Any plancheck candidate that hits target-divergence — already the top PR
failure in the data (AH-048) — will fail its refresh.

Fix both ends:

```bash
git -C /Users/shaun/projects/eversor-plancheck remote add origin https://github.com/EversorAI/eversor-plancheck
```

and make the refresh path carry the resolved delivery remote instead of defaulting to
the literal `"origin"`.

**Done 2026-09-19.** `origin` added and `refs/heads/main` resolves to `d2dacb61`. Adding
it surfaced three more plancheck pre-flight problems:

- The checkout sits on `feature/clone-account-make-target`, **3 ahead / 6 behind**
  `origin/main`. Tasks created against this path will base off the feature branch, and
  PR targets will diverge. Park plancheck on an up-to-date `main` before wave 1.
- The working tree is **dirty** (6 modified files under `backend/variation_costs/`,
  `tests/integration/`, `.gitignore`). Human Approval requires a clean worktree.
- `origin` is HTTPS and the only credential helper is `osxkeychain`; `gh` is configured
  for SSH. Switch the remote to `git@github.com:EversorAI/eversor-plancheck.git` so it
  matches `eversor-mystrataassist` and uses the working key, rather than relying on a
  keychain token.

### 0.3 Verify push rights to `EversorAI` before launching

`gh` is authenticated as `shaunnesbitteversor` with `repo` scope. Confirm a real branch
push and PR create/close round-trip on both Eversor repos, by hand, once. A harness that
gets to Human Approval and then fails on a 403 has wasted the whole run.

### 0.4 Prove each repo's verification manifest runs inside a harness worktree

`eversor-mystrataassist/.agent-harness/verification.json` includes `make e2e-native`
(real-backend Playwright) and `backend/.venv/bin/python -m pytest`. Harness worktrees do
provision `node_modules` / `.venv` by APFS clone (`server/git-worktree.mjs:53`), which is
good — but Playwright e2e also needs ports and a database, and two concurrent worktrees
will contend for both.

Run the full manifest once in a throwaway harness-style worktree of each repo. If
`e2e-native` cannot run concurrently, define a reduced dogfood manifest for MSA rather
than discovering it as a "harness bug" three tasks in.

### 0.5 Disk headroom

111 GiB free at 88% used; the repos are 13 GB (plancheck), 21 GB (MSA), 15 GB
(agent-harness-ui). Clones are copy-on-write so the first worktree is cheap, but
`claude-exec-budget` will refuse new worktrees when headroom runs out, and that refusal
reads like a harness failure. **Cap concurrency at 3 active tasks**, and prune
`.data/worktrees` between waves.

## The task ladder

Three sizes, three repos, nine tasks. Same brief text reused across waves so wave-over-wave
PR-reach is comparable. Sizes are defined by what they force the harness to do, not by
how hard the coding is:

| Size | Exercises | Shape of brief |
|---|---|---|
| **S** | triage -> implement -> gates -> PR, one package, no grill | One file, one obvious change, acceptance criteria stated in the brief. Should qualify for the `fast` profile and skip grill/spec/plan. |
| **M** | full 10 stages, one package, one likely repair | A change spanning 2-4 files with a real test to update. Forces spec + plan + a dev-review finding. |
| **L** | multi-package plan, dependency batching, concurrent worktrees, candidate assembly | A change touching frontend and backend, stated as 2-3 separable pieces. Forces the work-package path and ordered candidate assembly. |

Nine briefs to write (one per cell). Each brief must carry, verbatim:

- explicit acceptance criteria (required for the experiment record),
- the manifest command IDs that must pass,
- the frozen base SHA of that repo,
- "do not merge; stop at PR raised".

Tag every task with `experiment: { groupId: "dogfood-reliability-2026-09", variantId: "<wave>-<repo>-<size>" }`
(`server/evaluation.mjs:70`). That satisfies the experiment contract and keeps these
tasks separable from the model-evaluation workstream's tasks in the same store.

## Run protocol

1. **Freeze a base SHA per repo** and record it. Do not rebase repos mid-wave.
2. **Launch a wave of 3** (one repo, S+M+L) via `POST /api/tasks` on `127.0.0.1:4310`.
   Never 9 at once — disk, and a single harness bug would take out the whole wave.
3. **Do not touch the harness while a wave runs.** See the restart rule below.
4. **When the wave settles**, record for each task: terminal stage, status, blocker code,
   PR URL, repairs, retries, wall time. Then fix, restart, relaunch.

### Restart rule — this is the one that bites

The companion holds an exclusive runtime lock on `.data/tasks.sqlite3`
(`server/runtime-lock.mjs`) and, on startup, `recoverInterrupted()` marks in-flight runs
*interrupted* — it does not resume the agent subprocess
(`server/store.mjs:334`, `server/index.mjs:26`). **Restarting the companion kills every
running task's current stage.**

So:

- Develop harness fixes in a **git worktree** of `agent-harness-ui`, against its own
  checkout. Editing files does not affect the running companion.
- **Batch fixes.** Never restart for one fix.
- Restart only at a **quiescent point**: no task in `running`, `generating-designs`, or
  `merging`. Check before restarting:

```bash
sqlite3 /Users/shaun/projects/agent-harness-ui/.data/tasks.sqlite3 "SELECT id,status,current_stage FROM tasks WHERE status IN ('running','generating-designs','merging');"
```

  Empty result = safe to restart. Anything else = wait, or you will be manually
  recovering packages.
- Back up `.data/tasks.sqlite3` before any restart that carries a schema or store change.

## Bug capture loop

Every wave produces a defect list. For each failure, classify before fixing:

1. **Harness defect** — the harness did the wrong thing given correct inputs. Fix it.
2. **Environment** — missing remote, missing deps, ports, auth, disk. Fix the
   environment *and* make the harness report it as an environment problem rather than a
   stage failure.
3. **Task failure** — the agent wrote bad code and the gates correctly caught it. This is
   the harness **working**. Record it, do not fix it, relaunch the same brief.

Category 3 is the one to be disciplined about: a task that fails dev-review and gets
repaired is a success for this plan.

File each category-1 and category-2 finding as its own harness task so the harness fixes
itself — that is the real dogfood, and it also grows the S/M ladder for
`agent-harness-ui` naturally.

## Exit criteria

Done when, in a single wave with no human intervention beyond answering grill and the
final PR approval:

- 8 of 9 tasks raise a PR,
- no task dies at `specification` or `plan` for want of a click,
- both Eversor repos have raised at least one PR each,
- every category-1 defect from waves 1-2 is closed.
