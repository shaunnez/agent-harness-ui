# WP0 spike: detached worktree end to end

Date run: 2026-09-03. Result: **blocked** at the implement stage. Task never
reached `awaiting-human-approval`. Every step up to and including the plan gate
completed for real, against a real detached, frozen-SHA worktree, using the
real ChatGPT-authenticated Codex CLI. No application code was changed to run
this spike.

## What was run

1. `git worktree add --detach /tmp/eval-spike 401bf4904253ed50bad6c7d61d7ce612c3458bd2`
   (`401bf49...` is the repository's `main` head at spike time). The worktree
   stayed clean and detached at that SHA for the whole spike.
2. Started the companion with `npm run dev:api`, with `AGENT_HARNESS_PORT`,
   `AGENT_HARNESS_DATA`, `AGENT_HARNESS_STORE=json`, and (on the second attempt)
   `AGENT_HARNESS_WORKTREE_ROOT` overridden to a scratch location, so the spike
   would not share a task store or task IDs with the developer's own
   long-running instance already bound to the default port 4310 (see "Note on
   environment" below). `GET /api/runtime/status` returned 200 with a
   `csrfToken`, `authenticated: true`, `authMethod: "ChatGPT"`.
3. `POST /api/tasks` with `repositoryPath: "/tmp/eval-spike"` and an
   `experiment` block whose `frozenBaseSha` matched the worktree's checked-out
   commit, header `x-agent-harness-csrf`, `content-type: application/json`.
   First attempt returned `400 Experiment acceptance criteria must be a list of
   at most 30 items.` — the plan's own example payload in section 4.1 omits
   `acceptanceCriteria`/`verificationCommands` from the experiment block, but
   `normalizeExperimentInput` (`server/evaluation.mjs`) requires both to be
   non-empty. Added both fields and creation succeeded (`201`, task `AH-001`,
   `status: "queued"`).
4. The plan's step 4 says to poll until `awaiting-spec-approval`. A created task
   stays `queued` indefinitely; polling for 10+ minutes showed no transition and
   the server log recorded no further activity after the `201`. Task creation
   does not start orchestration. The action that starts it is
   `POST /api/tasks/:id/run` (`server/action-policy.mjs`, `RUN_ACTIONS.run`:
   `kind: "investigation"`, valid from status `queued`). This call is not
   mentioned anywhere in WP0's steps. After calling it, the task moved to
   `running` and then to `awaiting-spec-approval` in under a minute (triage,
   scouts, and Grill all completed automatically).
5. `POST /api/tasks/:id/approve-spec` with `{"note": "spike"}` returned
   `202 {"started":true,"completed":false}` and planning began. The task
   reached `awaiting-plan-approval`.
6. `POST /api/tasks/:id/approve-plan` with `{"note": "spike"}` returned
   `200 {"approved":true}` — but the task then sits at
   `ready-for-implementation`, not `awaiting-human-approval` or any other
   terminal/gate state, and stays there. Plan step 4 does not mention this
   either. Implementation must be started explicitly with
   `POST /api/tasks/:id/implement` (`RUN_ACTIONS.implement`). After calling it,
   the task moved to `implement` and immediately **failed**.

## The blocking error

Both attempts failed identically, within seconds of starting the implement
stage, with the task's stage-failure event:

```
S1 failed: The candidate branch agent-harness/ah-001-s1-a1 already exists.
Remove it manually or start a new task.
```

Terminal task status: `failed`. Final stage: `implement`. Attempts by stage:
`{"triage":1,"scouts":1,"grill":1,"specification":1,"plan":1,"implement":1}`.

### Root cause

`createTaskRecord` (`server/store.mjs:612`) assigns task IDs sequentially and
locally to the task store: `` `AH-${String(state.nextId).padStart(3, "0")}` ``.
A brand-new, empty JSON store therefore always hands out `AH-001` to its first
task, `AH-002` to its second, and so on, with no awareness of any other store
or of the target repository's history.

`GitWorktreeManager.prepare` (`server/git-worktree.mjs:237-247`) derives the
candidate branch name straight from that task ID —
`` `agent-harness/${task.id.toLowerCase()}-${candidateId}` `` — and refuses to
proceed if `git show-ref --verify refs/heads/<branch>` already resolves in
`repositoryRoot`.

`repositoryRoot` here is `/tmp/eval-spike`, a **linked worktree of this same
repository** (`git worktree add` shares one object database and one
`refs/heads` namespace across every worktree — it does not create an isolated
clone). This repository already has extensive real branch history from actual
harness usage on this machine: `agent-harness/ah-001-s1-a1` through
`ah-010-*`, `ah-025-*`, `ah-030-*` .. `ah-037-*`, `ah-100-*`, `ah-200-*`
through `ah-202-*` all exist as real branches today (`git branch -a`). A fresh
task store's first task collides with `ah-001-s1-a1` unconditionally; its next
several tasks would keep colliding through most of the low IDs.

I re-ran the whole spike a second time with a completely fresh JSON store *and*
`AGENT_HARNESS_WORKTREE_ROOT` pointed at an unused scratch directory, to rule
out a stale worktree directory as the cause. Task creation again produced
`AH-001`, and implementation failed on the exact same branch name and error.
Isolating the store and the worktree root does not help, because neither
changes which repository `git show-ref` is checked against — that is fixed by
`repositoryPath`/`repositoryRoot`, i.e. the frozen worktree itself, which is
necessarily part of the one shared repository being evaluated.

### Why this matters beyond this one run

This is exactly the situation WP3's runner will be in: it creates a fresh
detached worktree per case × variant pair against the real target repository,
very likely from task stores that do not share history with whatever else has
run against that repository before (a previous campaign, a developer's own
tasks, another agent's session). Nothing in the current design gives a task ID
generated by `createTaskRecord` any relationship to the actual branch
namespace of the repository it will create branches in. On a repository with
any prior harness usage — which describes this repository today, and will
describe it more after every future campaign — the first several (and
potentially many) tasks in any new campaign will collide and fail at the
implement stage with no retry path other than an operator manually deleting
branches or picking a store whose counter happens to already be past the
collision range.

## What worked

- Creating a task against a `repositoryPath` pointing at a `git worktree add
  --detach` checkout, with a matching `experiment.frozenBaseSha`, works exactly
  as decision 3 describes: the create route reads the worktree's real `HEAD`
  and refuses a mismatch; `task.experiment.frozenBaseSha` and
  `task.experiment.policyMatrix` were recorded correctly.
- Triage, scouts, Grill (auto-completing with no material questions),
  specification, and planning all ran for real against that frozen worktree
  using the ChatGPT-authenticated Codex CLI (`gpt-5.6-luna` / `gpt-5.6-sol` per
  the default stage policies), produced real artifacts, and reported real
  token usage and cost (run total: 200,905 tokens, $0.105 API-rate estimate,
  pricing version `2026-08-02`).
- The specification and plan gates behaved correctly under manual approval
  (`actor` defaults to human; WP1b's `auto-on-clean` policy does not exist yet,
  so both gates parked for the explicit `approve-spec`/`approve-plan` calls,
  as expected on unmodified `main`).
- The detached-worktree checkout itself was never the problem; the problem is
  entirely in git ref allocation, one layer below the worktree.

## Gaps found in WP0's own steps (plan section 5, WP0)

1. `POST /api/tasks`'s `experiment` block needs `acceptanceCriteria` and
   `verificationCommands`; the plan's example in section 4.1 doesn't show this
   for the WP0 payload and the WP0 steps don't mention it.
2. A created task does not auto-start. `POST /api/tasks/:id/run` must be called
   to leave `queued`.
3. `approve-plan` does not auto-start implementation. The task lands on
   `ready-for-implementation` and needs an explicit
   `POST /api/tasks/:id/implement` call. (By extension, real end-to-end runs
   also need explicit `review`, `test`, and `final-review` calls at their
   respective `ready-for-*` states — this spike did not get far enough to
   exercise those, but the same pattern applies per `RUN_ACTIONS` in
   `server/action-policy.mjs`.)

None of these three required an application code change to work around; they
just needed the corresponding existing route to be called. They are recorded
here because WP3's runner must call all of them (`run`, `implement`, `review`,
`test`, `final-review`) in addition to the two approvals the plan calls out,
and because an implementing agent following WP0's steps literally, as written,
will stall exactly as this spike initially did.

## Conclusion / recommendation

Per plan section 8 guardrails: this defect blocked WP0 in the harness. Per the
plan's own "Done when" clause for WP0 ("If it blocked in the harness, fix that
defect as its own package before WP2"), a decision is needed before WP2 starts:
task IDs (or at least candidate branch names) need to be verified unique
against the target repository's actual `refs/heads` namespace before or at
branch-creation time — for example, by having `GitWorktreeManager.prepare`
retry with a disambiguated candidate/branch suffix instead of failing outright,
or by having task creation itself derive IDs that are checked against
`repositoryPath`'s branches, not just the local store's counter. No such change
was made here — WP0 is a spike, not a code change, and this write-up is the
deliverable for that discovery. See the "Blocked" note added to the top of
`docs/model-evaluation-plan.md`.
