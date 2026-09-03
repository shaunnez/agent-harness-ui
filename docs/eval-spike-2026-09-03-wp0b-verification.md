# WP0b verification: rerunning the WP0 spike after the branch-collision fix

Date run: 2026-09-03. Result: **the defect is fixed.** The candidate branch
collision that blocked `docs/eval-spike-2026-09-03.md` no longer occurs. The
task ran a real implementation from a detached, frozen-SHA worktree of this
repository (which still has its real, pre-existing `agent-harness/ah-NNN-*`
branches) and passed all the way through the implement stage into Development
Review with no manual branch deletion and no code change beyond WP0b's fix.

## What was run

This repeated the WP0 spike's steps, corrected for the three gaps the spike
itself documented (`POST /api/tasks/:id/run` to leave `queued`, an explicit
`POST /api/tasks/:id/implement` after `approve-plan` lands on
`ready-for-implementation`, and an `experiment` block that includes
`acceptanceCriteria`/`verificationCommands`):

1. `git worktree add --detach /private/tmp/.../eval-spike-wp0b 401bf4904253ed50bad6c7d61d7ce612c3458bd2`
   — the same `main` head SHA the original spike used, in this same
   repository, so the same real `agent-harness/ah-001-*`/`ah-002-*` branches
   from prior harness usage were present and could collide again.
2. Started the companion with `npm run dev:api`, with `AGENT_HARNESS_PORT`,
   `AGENT_HARNESS_DATA`, `AGENT_HARNESS_STORE=json`, and
   `AGENT_HARNESS_WORKTREE_ROOT` all pointed at a scratch location, isolated
   from any other running instance. `GET /api/runtime/status` returned 200
   with a `csrfToken`, `authenticated: true`, `authMethod: "ChatGPT"`.
3. `POST /api/tasks` with `repositoryPath` set to the detached worktree, an
   `experiment` block with `groupId`, `variantId`, a matching
   `frozenBaseSha`, `acceptanceCriteria`, and `verificationCommands` (the
   plan's own example in section 4.1 still omits the last two fields; this
   run supplied them from the start, per the spike's own gap list). The first
   brief tried ("fix the README quick-start wording") triaged straight to
   `awaiting-already-satisfied` because this repository's README already
   names the real dev command — a legitimate outcome, not a defect, but not
   useful for exercising the implement stage. A second task (`AH-002`) asked
   for a new, unambiguous, one-line README bullet instead.
4. `POST /api/tasks/AH-002/run` moved the task from `queued` to `running` and
   it reached `awaiting-spec-approval` on its own (triage escalated
   automatically from `fast` to `standard`, and Grill completed automatically
   with no material questions).
5. `POST /api/tasks/AH-002/approve-spec` with `{"note": "wp0b spike rerun"}`
   started planning; the task reached `awaiting-plan-approval`.
6. `POST /api/tasks/AH-002/approve-plan` with `{"note": "wp0b spike rerun"}`
   returned `200 {"approved":true}`. As documented, the task then sat at
   `ready-for-implementation` rather than advancing on its own.
7. `POST /api/tasks/AH-002/implement` started the implement stage.

## The collision, and that it no longer blocks

Before this run, the repository already had real branches
`agent-harness/ah-002-c1` and `agent-harness/ah-002-s1-a1` from prior harness
usage — confirmed with `git branch --list "agent-harness/ah-002-*"` both
before and during the run. This is the exact collision shape the original
spike hit on `ah-001-s1-a1`, reproduced here on purpose against `ah-002-*` by
letting the fresh scratch store assign `AH-002` to the second task it created.

`GitWorktreeManager.prepare` (via the new `#allocateBranchName` in
`server/git-worktree.mjs`) allocated `agent-harness/ah-002-s1-a1-2` for the S1
work package and `agent-harness/ah-002-c1-2` for the integration candidate —
the plain names were already taken, so the disambiguated names were used
instead of failing. `git branch --list "agent-harness/ah-002-*"` immediately
after the implement stage confirmed both new branches were real refs:

```
+ agent-harness/ah-002-c1
+ agent-harness/ah-002-c1-2
  agent-harness/ah-002-s1-a1
+ agent-harness/ah-002-s1-a1-2
```

The task's own record confirms the disambiguated names are what every
downstream consumer actually used, not a recomputed plain name:

- Work package `S1`: `status: "integrated"`, `branch: "agent-harness/ah-002-s1-a1-2"`, `error: null`.
- Candidate `C1`: `status: "ready_for_review"`, `branch: "agent-harness/ah-002-c1-2"`, `headRevision: 139c7ec042f3fb5d48c442ff50d4c4f65aca2237`.
- The candidate worktree's actual checked-out branch (`git branch --show-current`
  inside it) was `agent-harness/ah-002-c1-2`, matching the recorded value.
- The candidate's own commit (`139c7ec agent-harness(AH-002): S1 Add README
  verification marker`) contains exactly the requested change: README.md
  gained one new line, `- WP0b verification marker (evaluation spike,
  2026-09-03).`, at the end of the "What works now" list, and no other file
  changed.

Terminal task status at the end of this run: **`ready-for-review`**, current
stage **`dev-review`** — past the implement stage entirely, into Development
Review, with `error: null` throughout. No stage-failure event, and no event
in the task's full activity log mentions a branch or "already exist" at any
point (checked by scanning every event's title/detail text). Per the task's
brief ("reaching or passing the implement stage without the collision error
is sufficient, since later stages are unrelated to this defect"), this is
conclusive: the fix works against this repository's real, pre-existing
branch history, not just in the unit tests added alongside it.

`attemptsByStage` for the run: `{"triage":1,"scouts":1,"grill":1,
"specification":1,"plan":1,"implement":1}` — the implement stage succeeded on
its first attempt, with no repair cycle needed because of the collision (there
was nothing to repair; the fix resolved it transparently before the agent's
implementation attempt even started).

## What this does not re-verify

This rerun exercised triage, scouts, Grill, specification, planning, and
implement/candidate-assembly for real. It stopped once the implement-stage
proof point was reached (per the task's own scope) and did not continue
through Development Review, Test, Final Review, or Human Approval — those
stages are unrelated to the branch-collision defect and are unaffected by
this fix. The task was left there rather than driven further; all scratch
worktrees and the two disambiguated branches created for this verification
(`agent-harness/ah-002-c1-2`, `agent-harness/ah-002-s1-a1-2`) were removed
afterward so this repository's real branch namespace is unchanged by running
this check.

## Conclusion

WP0b's own "Done when" clause is satisfied: `npm run lint`, `npm run
typecheck`, and `npm test` (481/481, including four new tests in
`tests/git-worktree-branch-collision.test.mjs`) all pass, and rerunning the
WP0 spike against this repository — which still has the real colliding
`agent-harness/ah-001-*`/`ah-002-*` branches — now passes the implement stage
without any manual branch deletion. The "Blocked" heading is removed from the
top of `docs/model-evaluation-plan.md` accordingly.
