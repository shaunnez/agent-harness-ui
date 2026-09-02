# Model evaluation suite: implementation plan

## Blocked

**WP0 blocked in the harness on 2026-09-03.** Task creation, triage, scouts,
Grill, specification, and planning all ran for real against a detached,
frozen-SHA worktree using the ChatGPT-authenticated Codex CLI, and both
approval gates worked. The task then failed at the implement stage with:

```
S1 failed: The candidate branch agent-harness/ah-001-s1-a1 already exists.
Remove it manually or start a new task.
```

Root cause: `createTaskRecord` (`server/store.mjs:612`) assigns task IDs
(`AH-001`, `AH-002`, ...) sequentially per task store, with no relationship to
the target repository's actual git history. `GitWorktreeManager.prepare`
(`server/git-worktree.mjs:237-247`) derives the candidate branch name directly
from the task ID and refuses to proceed if that branch ref already exists in
`repositoryRoot`. A `git worktree add --detach` checkout shares one
`refs/heads` namespace with the whole repository it was created from — it is
not an isolated clone — so a fresh store's first task (`AH-001`) collides with
any repository that already has real `agent-harness/ah-001-*` branches, which
this repository does (through `ah-202-*` at spike time). Reproduced twice: once
with a completely fresh JSON store, and again with a fresh store plus
`AGENT_HARNESS_WORKTREE_ROOT` pointed at an unused scratch directory — neither
isolation avoids the collision, because the check runs against the frozen
worktree's own shared ref namespace, not against the store or the worktree
root.

This blocks WP3 in particular: its runner will create many tasks per campaign
against the real target repository, and nothing today gives a generated task ID
any relationship to that repository's actual branch namespace. Per section 8,
a fix for this (verifying/disambiguating the candidate branch name against the
repository before or at creation, rather than only after `git show-ref` fails)
is needed as its own package before WP2 proceeds. No code change was made here;
WP0 is a spike. Full run detail, both attempts, and what worked despite the
block: `docs/eval-spike-2026-09-03.md`.

Status: plan, not implemented. Written 2026-09-03.

This plan is written for implementing agents that have not seen the repository
before. Every work package names the files to touch, the behaviour to add, the
tests that prove it, and what "done" means. Work the packages in order. Do not
start a package until the one it depends on has its tests passing on `npm test`.

## 1. Goal

One command runs a fixed set of task briefs through the whole harness, end to end,
under several model configurations, and produces a report that says which model
should own each agent role. The same command is rerun when a new model ships.

```bash
node scripts/run-eval-suite.mjs --suite evals/suites/core.json --variants evals/variants/role-sweep.json
```

Non-goals for this plan:

- Do not make the orchestrator choose models dynamically per task. The existing
  workflow profiles (`fast`, `standard`, `high-risk`) already carry a per-role model
  table each. The suite's output is a better version of those three tables.
- Do not auto-approve the candidate or merge gates. Only the specification and
  plan gates gain an automatic policy in this plan (see WP1b). Every evaluation task
  still stops at `awaiting-human-approval`.
- Do not merge or open a PR for any evaluation candidate. Every task stops at
  `awaiting-human-approval`, `blocked`, or `failed`.

## 2. Vocabulary

| Term | Meaning | Where it lives today |
| --- | --- | --- |
| Role | One model-driven step. Ten exist: `triage`, `scouts`, `grill`, `specification`, `plan`, `implement`, `repair`, `dev-review`, `test`, `final-review`. | `POLICY_IDS` in `server/model-catalog.mjs` |
| Policy | `{ model, reasoning }` for one role. | `task.agentConfig.stagePolicies[role]` |
| Policy matrix | All ten policies for a task. | `task.agentConfig.stagePolicies` |
| Case | One frozen task brief with acceptance criteria and verification commands. | New: `evals/suites/*.json` |
| Suite | A list of cases plus the frozen base commit they run against. | New: `evals/suites/*.json` |
| Variant | A named policy matrix. | New: `evals/variants/*.json` |
| Run | One case executed under one variant. Becomes one harness task with `task.experiment` set. | Existing: `task.experiment` |
| Campaign | One invocation of the runner: every case x every variant. | New: `.data/evaluations/<campaignId>/` |

Existing evaluation machinery to reuse, not rewrite:

- `server/evaluation.mjs`: `hashTaskBrief`, `normalizeExperimentInput`,
  `normalizeEvaluationInput`, `buildEvaluationSummary`.
- `server/campaign-export.mjs`: `exportCandidatePatch`, `assertPatchApplies`,
  `markCampaignReady`.
- `GET /api/evaluations/summary` and `src/components/EvaluationScorecard.tsx`.
- `POST /api/tasks/:id/evaluation` with `kind: "blind" | "human"`, score 1 to 5.
- `docs/dogfood-campaign-2026-08-03/` shows the manifest shape a previous manual
  campaign produced. Keep that shape compatible where practical.

## 3. Design decisions already made

Do not reopen these. They are recorded so an implementing agent does not
re-derive them.

1. **Gates auto-approve on clean evidence; the runner is the fallback operator.**
   Tasks are created with `grillPolicy: "auto-accept-recommendations"` and
   `gatePolicy: { specification: "auto-on-clean", plan: "auto-on-clean" }` (WP1b).
   Approval records made by policy carry `actor: "policy"` so a human approval keeps
   its meaning. If a gate still parks because the evidence is not clean, the runner
   calls the same API the UI calls, with the note `eval-runner:<campaignId>`, and
   records in the manifest that it did so. Candidate and merge gates stay manual.
2. **Per-task policy matrix at creation.** Today `POST /api/tasks` accepts one
   `model` and `reasoning` and applies it to every role. The runner needs to send a
   full matrix. This is work package 1.
3. **Frozen base per run.** Every task runs from its own detached Git worktree
   checked out at the suite's `frozenBaseSha`. The create route already refuses a
   repository whose `HEAD` is not the frozen SHA. `server/git-worktree.mjs` already
   treats a detached base as `baseBranch: "detached"`.
4. **Swap one role at a time.** A variant file normally holds a baseline matrix plus
   a list of single-role overrides. Full factorial across ten roles is not affordable.
5. **Blind judge before human score.** A fixed strong model scores each finished
   candidate against the case's acceptance criteria without seeing the variant. The
   human score stays optional and separate.
6. **Completion rate is the first metric.** The 3 August campaign blocked 9 of 9
   tasks before any gate ran. A variant that cannot finish the baseline cases is a
   harness bug to fix, not a model result to interpret.

## 4. File formats

### 4.1 Suite: `evals/suites/<name>.json`

```json
{
  "schemaVersion": 1,
  "suiteId": "core",
  "repositoryPath": "/absolute/path/to/target/repo",
  "frozenBaseSha": "<40 hex>",
  "verificationCommands": ["npm run lint", "npm run typecheck", "npm test"],
  "cases": [
    {
      "caseId": "copy-fix-readme",
      "shape": "single-package",
      "title": "Fix the README quick-start wording",
      "description": "…full brief as the operator would type it…",
      "workflow": "implement",
      "workflowProfile": "auto",
      "attachments": [],
      "acceptanceCriteria": ["README quick-start names the real dev command", "No other files change"],
      "verificationCommands": null
    }
  ]
}
```

Rules:

- `shape` is `single-package` or `multi-package`. It is a label for reporting.
  The runner records the actual work-package count from the task.
- A case-level `verificationCommands` of `null` inherits the suite's list.
- `workflow` must be one of the values in `VALID_WORKFLOWS` in `server/api.mjs`
  (currently `investigate` and `implement`). Check the current set before writing cases.
- `attachments` entries are `{ "path": "evals/fixtures/<file>" }` and the runner
  base64-encodes them into the create payload. The create route allows six files of
  the types listed in `validateAttachments` in `server/api.mjs`.

### 4.2 Variants: `evals/variants/<name>.json`

```json
{
  "schemaVersion": 1,
  "baselineId": "codex-hybrid",
  "variants": {
    "codex-hybrid": {
      "matrix": {
        "triage": { "model": "gpt-5.6-luna", "reasoning": "xhigh" },
        "scouts": { "model": "gpt-5.6-luna", "reasoning": "xhigh" },
        "grill": { "model": "gpt-5.6-luna", "reasoning": "xhigh" },
        "specification": { "model": "gpt-5.6-luna", "reasoning": "xhigh" },
        "plan": { "model": "gpt-5.6-sol", "reasoning": "high" },
        "implement": { "model": "gpt-5.6-luna", "reasoning": "xhigh" },
        "repair": { "model": "gpt-5.6-sol", "reasoning": "high" },
        "dev-review": { "model": "gpt-5.6-sol", "reasoning": "high" },
        "test": { "model": "gpt-5.6-luna", "reasoning": "xhigh" },
        "final-review": { "model": "gpt-5.6-luna", "reasoning": "medium" }
      }
    },
    "implement-opus": {
      "extends": "codex-hybrid",
      "override": { "implement": { "model": "claude-opus-5", "reasoning": "high" } }
    },
    "plan-sonnet": {
      "extends": "codex-hybrid",
      "override": { "plan": { "model": "claude-sonnet-5", "reasoning": "xhigh" } }
    }
  }
}
```

Rules:

- A variant has either a full `matrix` or `extends` plus `override`. Resolve
  `extends` one level deep only.
- Every model must appear in `settings.allowedModels` and support the reasoning
  level. Validate with the same function the settings route uses
  (`validateStagePolicies` in `server/api.mjs`) before creating any task.
- Roles may mix providers. `resolveAgentPolicy` in `server/model-catalog.mjs`
  already routes each role to the provider that owns its model.

### 4.3 Campaign output: `.data/evaluations/<campaignId>/`

```
manifest.json          every run: caseId, variantId, taskId, terminal status, metrics
variant-map.json       taskId -> variantId (kept out of the blind bundle)
bundle/<label>/        brief.md, acceptance.md, verification.txt, candidate.patch
judge/<label>.json     blind judge output per candidate
report.md              human-readable comparison
READY                  written last, by markCampaignReady
```

`.data/` is already ignored by Git. Do not commit campaign output. A summary can
be copied into `docs/` by hand after review.

## 5. Work packages

Sizes assume one agent working alone. "Tests" means new tests under `tests/`,
added to the `test` script in `package.json`, passing with `npm test`.

### WP0. Spike: detached worktree end to end (half a day)

Goal: prove the harness can run one task from a detached worktree at a frozen SHA
with no code changes. This de-risks decision 3 before anything is built.

Steps:

1. In the target repository run
   `git worktree add --detach /tmp/eval-spike <sha>` where `<sha>` is the current
   `main` head.
2. Start the companion with `npm run dev:api` and read `csrfToken` from
   `GET http://127.0.0.1:4310/api/runtime/status`.
3. `POST /api/tasks` with `repositoryPath: "/tmp/eval-spike"` and an `experiment`
   block whose `frozenBaseSha` is that SHA. Send header
   `x-agent-harness-csrf: <token>` and `content-type: application/json`.
4. Poll `GET /api/tasks/:id` until `status` is `awaiting-spec-approval`, then
   `POST /api/tasks/:id/approve-spec` with `{ "note": "spike" }`. Repeat for
   `approve-plan`. Stop at `awaiting-human-approval`, `blocked`, or `failed`.
5. Write what happened to `docs/eval-spike-<date>.md`: the terminal status, any
   error text, and which stage blocked.

Done when: the note exists and either the task reached `awaiting-human-approval`
or the blocking defect is written up with the exact error. If it blocked in the
harness, fix that defect as its own package before WP2.

### WP1. Per-task policy matrix and grill policy on task creation (2 to 4 hours)

Files: `server/task-creation-routes.mjs`, `server/api.mjs` (export
`validateStagePolicies` if it is not already reachable), `src/api.ts`,
`src/domain/runtime.ts`, new test `tests/api-task-creation-matrix.test.mjs`.

Behaviour:

- `POST /api/tasks` accepts optional `stagePolicies`: an object keyed by every
  role in `POLICY_IDS`. Validate it with `validateStagePolicies` against the
  catalogue and `settings.allowedModels`. A partial matrix is an error.
- When `stagePolicies` is present, use it for `taskPolicies` and for every profile
  in `taskProfilePolicies`, instead of the single `model`/`reasoning` fan-out. When
  both `stagePolicies` and `model` are present, reject with a clear error.
- `POST /api/tasks` accepts optional `grillPolicy`, one of `manual` or
  `auto-accept-recommendations`, and passes it to `store.create` (which already
  reads `input.grillPolicy`).
- `task.experiment.policyMatrix` must equal the matrix that was sent. The existing
  test in `tests/api-task-creation-profile.test.mjs` asserts
  `experiment.policyMatrix` equals `agentConfig.stagePolicies`; keep it green.

Tests:

- A full valid matrix is stored on the task and snapshotted into `experiment`.
- A matrix missing one role returns 400.
- A model outside `allowedModels` returns 400.
- `grillPolicy: "auto-accept-recommendations"` appears on the created task.
- Sending both `model` and `stagePolicies` returns 400.

Done when: tests pass and `npm run lint` and `npm run typecheck` pass.

### WP1b. Per-gate auto-approve for specification and plan (1 day)

Design source: `docs/auto-approve-gates-proposal.md`. Implement its recommendation
with two values only, `manual` and `auto-on-clean`, and for two gates only,
`specification` and `plan`. Candidate and merge are out of scope; leave them
`manual` with no code path that could advance them automatically.

Files: `server/model-catalog.mjs` (`defaultRuntimeSettings`),
`server/runtime-settings-routes.mjs`, `server/store.mjs` (creation input and
settings backfill), `server/task-creation-routes.mjs`,
`server/orchestrator-task-helpers.mjs` (`recordApproval`),
`server/orchestrator-specification-planning.mjs` and
`server/orchestrator-investigation.mjs` (the two places that set
`awaiting-spec-approval` and `awaiting-plan-approval`),
`server/orchestrator-task-control.mjs` (`approveSpecification`, `approvePlan`),
`src/components/SettingsScreen.tsx`, the task inspector approval rendering, new
test `tests/orchestrator-gate-policy.test.mjs`.

Behaviour:

- Settings gain `gatePolicy: { specification: "manual", plan: "manual" }`.
  Existing stores backfill the default through the same
  `state.settings[key] === undefined` path `store.mjs` already uses for other keys.
  `PUT /api/settings` validates each value against `manual` and `auto-on-clean`.
- `POST /api/tasks` accepts optional `gatePolicy` with the same shape and snapshots
  it onto `task.gatePolicy`, defaulting to the settings value. Store backfill sets
  `task.gatePolicy` to all `manual` on tasks that predate the field.
- `recordApproval(task, stage, note, actor = { kind: "human" })` stores
  `actor: { kind: "human" | "policy", policy?: "auto-on-clean" }` on the approval.
  Approvals without `actor` read as `human` everywhere they are displayed.
- When the orchestrator would set `awaiting-spec-approval` and
  `task.gatePolicy.specification === "auto-on-clean"`, it checks the stage is clean
  and, if so, records a policy approval and continues into planning by the same
  code path `approveSpecification` uses. Same for `awaiting-plan-approval` and
  `approvePlan`, including the fast-profile and executable-plan checks that
  `approvePlan` already performs. If any check fails, the task parks exactly as it
  does today and the event log says why the policy did not apply.
- "Clean" for specification: the specification artifact exists, the run that
  produced it succeeded, and no unresolved Grill decisions remain. "Clean" for
  plan: `_assertExecutablePlan` passes and `blockStalePlan` is false. Do not invent
  a third notion of clean; reuse these checks.
- Settings UI: two rows, `manual` default. Task UI: a policy approval renders with
  a visible "approved by policy" label, never as a silent skip.

Tests:

- `manual` at each gate parks as today.
- `auto-on-clean` at specification records `actor.kind === "policy"` and reaches
  planning without an API call.
- `auto-on-clean` at plan with a stale repository authority parks and logs the
  reason.
- A persisted approval with no `actor` is reported as human.
- `POST /api/tasks` with `gatePolicy.candidate` or `gatePolicy.merge` returns 400.

Done when: tests pass and a task created with both gates on `auto-on-clean` runs
from creation to `awaiting-human-approval` with zero approval API calls, observed
in the WP0 spike setup.

### WP2. Suite and variant loaders (2 to 3 hours)

Files: new `evals/lib/suite.mjs`, new `evals/lib/variants.mjs`, new
`evals/suites/core.json`, new `evals/variants/role-sweep.json`, test
`tests/eval-suite-loader.test.mjs`.

Behaviour:

- `loadSuite(path)` reads, validates the shape in 4.1, resolves case-level
  `verificationCommands` inheritance, reads attachment files to base64, and returns
  plain objects ready for the create payload. Unknown keys are an error.
- `loadVariants(path, { catalog, allowedModels })` reads 4.2, resolves `extends`,
  validates each matrix with `validateStagePolicies`, and returns
  `{ baselineId, variants: Map<variantId, matrix> }`.
- `core.json` holds six cases against this repository. Write briefs as an operator
  would. Suggested spread:
  - two `single-package` copy or styling cases (should select the `fast` profile)
  - two `single-package` logic cases in `server/` with a verification command
  - two `multi-package` cases that touch `server/` and `src/` together
- `role-sweep.json` holds the baseline in 4.2 plus one override per role for the
  candidate model under test. Ten variants plus baseline is the normal size.

Tests: valid files load; a missing role, an unknown model, a two-level `extends`,
and an unknown top-level key each throw with a message naming the field.

Done when: both example files load in tests and the loader modules are under 300
lines each.

### WP3. Runner script (1 to 2 days)

Files: new `scripts/run-eval-suite.mjs`, new `evals/lib/harness-client.mjs`, new
`evals/lib/campaign.mjs`, test `tests/eval-runner.test.mjs` using a fake HTTP
server.

Command line:

```
node scripts/run-eval-suite.mjs
  --suite <path> --variants <path>
  [--only-cases a,b] [--only-variants x,y]
  [--concurrency 1] [--api http://127.0.0.1:4310]
  [--worktree-root .data/evaluations/worktrees]
  [--timeout-minutes 90] [--resume <campaignId>]
```

Behaviour, in order, for each case x variant pair:

1. Create a detached worktree at `frozenBaseSha` under `--worktree-root`, named
   `<campaignId>-<caseId>-<variantId>`. Reuse it when `--resume` is given and it
   exists.
2. `POST /api/tasks` with the case brief, `repositoryPath` set to the worktree,
   `stagePolicies` from the variant, `grillPolicy: "auto-accept-recommendations"`,
   `gatePolicy: { specification: "auto-on-clean", plan: "auto-on-clean" }`, and
   `experiment: { groupId: caseId, variantId, frozenBaseSha, acceptanceCriteria,
   verificationCommands }`.
3. Poll `GET /api/tasks/:id` every 15 seconds. Gates normally clear themselves.
   If a task still parks at `awaiting-spec-approval` call `approve-spec`; at
   `awaiting-plan-approval` call `approve-plan`; at `awaiting-grill` call
   `POST /api/tasks/:id/grill/finish`. Every approval note is
   `eval-runner:<campaignId>`, and the manifest records `runnerApprovals` as the
   list of gates the runner had to clear by hand. A high count is itself a finding.
4. Stop on `awaiting-human-approval`, `blocked`, `failed`, `cancelled`, or when
   `--timeout-minutes` elapses. On timeout call `POST /api/tasks/:id/cancel` and
   record `terminalState: "timeout"`.
5. Record the run into `manifest.json`: caseId, variantId, taskId, terminal status,
   final stage, work-package count, `attemptsByStage`, repair count, gate verdicts
   per stage in order, `usage`, wall time, and the policy matrix the task actually
   stored. Read these from the task object; do not recompute.
6. If the task has a candidate, export `candidate.patch` with
   `exportCandidatePatch` from `server/campaign-export.mjs` into
   `bundle/<label>/` where `label` is a random letter sequence. Write the brief,
   acceptance criteria, and the Test stage's verification output alongside it.
   Append `taskId -> variantId` to `variant-map.json` and nothing else.
7. Never call `approve-merge`, `open-pr`, or `complete-merged`. Assert this in a
   test by checking the fake server's request log.

`--concurrency` above 1 runs pairs in parallel. The API is a single process, so
keep the default at 1 until WP0 has shown the runtime is stable at 3.

Tests, against a fake API that scripts status transitions:

- happy path reaches `awaiting-human-approval` and writes one manifest entry
- approval calls carry the campaign note
- a `blocked` task is recorded and the runner continues to the next pair
- timeout cancels and records `timeout`
- `--resume` skips pairs already present in the manifest
- no forbidden action is ever requested

Done when: `node scripts/run-eval-suite.mjs --suite evals/suites/core.json
--variants evals/variants/role-sweep.json --only-cases <one> --only-variants
<baseline>` completes a real task locally, and the tests above pass.

### WP4. Blind judge (half a day to a day)

Files: new `evals/lib/judge.mjs`, new `scripts/judge-eval-campaign.mjs`, test
`tests/eval-judge.test.mjs`.

Behaviour:

- For each `bundle/<label>/` with a `candidate.patch`, build a prompt from the
  brief, acceptance criteria, verification output, and the patch. The prompt must
  not include the variant, the model names, the task ID, or any path under
  `.data/`.
- Run the judge through the existing execution provider for the configured judge
  model, read-only sandbox, with the worktree at the frozen base as `cwd` so it can
  inspect surrounding code. Use `resolveExecutionProvider` from
  `server/execution-providers.mjs` and the same call shape the orchestrator uses
  for `dev-review`. Look at how `orchestrator-gate-evaluation.mjs` invokes a
  provider and copy that pattern rather than spawning a CLI by hand.
- Require structured output: `{ "score": 1-5, "criteria": [{ "text", "met": true|false, "evidence" }], "defects": [string], "notes": string }`.
  Reuse `server/structured-output.mjs` for parsing and rejection.
- Write the output to `judge/<label>.json` and post it to
  `POST /api/tasks/:id/evaluation` with `kind: "blind"`, `score`, `rubric` built
  from `criteria`, `evaluator: "judge:<model>"`, `suiteId`, and `caseId`. Look up
  the task ID from `variant-map.json` only at posting time and never include it in
  the prompt.
- Judge model is a command-line flag with a default of `claude-opus-5` at `high`.
  Record the judge model in `manifest.json`. Never let the judge model be one of
  the models under test in the same campaign.

Tests: prompt contains no forbidden identifiers; malformed judge output is
rejected and recorded as `judgeStatus: "invalid"`; a valid output is posted with
`kind: "blind"`.

Done when: `node scripts/judge-eval-campaign.mjs --campaign <id>` scores a real
bundle and the score appears in `GET /api/evaluations/summary` under
`experiments.variants`.

### WP5. Report (half a day)

Files: new `evals/lib/report.mjs`, new `scripts/report-eval-campaign.mjs`, test
`tests/eval-report.test.mjs`.

Behaviour: read `manifest.json`, `judge/*.json`, `variant-map.json`, and
`GET /api/evaluations/summary`, then write `report.md` with these sections in this
order:

1. **Completion.** Table: variant x case, cell is the terminal status. A row for
   "reached human approval" count out of total.
2. **Per-role swap versus baseline.** One row per variant that `extends` the
   baseline: the role swapped, the model swapped in, then paired differences
   against the baseline on the same cases: blind score delta, first-pass gate rate
   delta, repair count delta, wall time delta, API estimate delta, output tokens
   delta. Show the number of paired cases. Mark any pair where either side did not
   finish as "not comparable" and exclude it from the deltas.
3. **Per case.** For each case, every variant's status, blind score, repairs, wall
   time, and cost.
4. **Confounds.** List any case where all variants failed, any run marked
   `timeout`, and any run where `task.agentConfig.stagePolicies` differs from the
   variant matrix requested.
5. **Recommendation table.** For each role: current baseline model, best-performing
   swap by the decision rules in section 6, and whether the sample supports acting
   on it.

Also write `report.json` with the same numbers for scripting.

Done when: the report renders from the WP3 fixture manifest in a test, and the
recommendation table follows section 6 exactly.

### WP6. Single entry point and UI hook (2 to 3 hours)

Files: `package.json`, new `scripts/eval.mjs`, `README.md`.

Behaviour: `npm run eval -- --suite <path> --variants <path>` runs WP3, then WP4,
then WP5 in sequence and prints the path to `report.md`. Each step is also runnable
alone by the scripts above. Add a `--skip-judge` flag.

Optional, only if the earlier packages are done and stable: add an **Evaluations**
entry in Settings that lists campaigns under `.data/evaluations/` and links to the
scorecard. Do not add a "start campaign" button in the UI in this plan. Runs take
hours and belong in a terminal.

Update `README.md` with a short "Evaluating models" section: the one command, the
two example files, and a pointer to this document.

## 6. Reading the results and what to change

The report is only trustworthy after these checks pass. Do them in order.

### 6.1 Is the harness healthy?

- Baseline completion must be at least five of six cases reaching
  `awaiting-human-approval`. Below that, stop. Read the blocked tasks' final
  stage and error. Fix the harness, rerun the baseline alone, and only then run
  swaps. Model comparisons over a broken baseline are noise.
- Any case where every variant fails is a bad case, not a model signal. Rewrite the
  brief or its acceptance criteria and drop it from the comparison.

### 6.2 Decision rules per role

Compare each swap to the baseline on paired cases only. A swap is a **candidate
to adopt** when all of these hold:

- at least four comparable pairs
- blind score not lower by more than 0.25 on average
- first-pass gate rate not lower
- repair count not higher
- and at least one of: API estimate at least 20 percent lower, or wall time at
  least 20 percent lower, or blind score at least 0.5 higher

A swap is **rejected** when blind score drops by 0.5 or more, or repair count rises
on more than one case, regardless of cost.

Anything else is **inconclusive**. Run it again with more cases before acting.

Six cases is a small sample. Treat one campaign as a screening pass. A role
change that survives two campaigns on different case sets is safe to adopt.

### 6.3 Where to apply a change

Adopted changes go into the default profile tables, not into settings on one
machine:

- `defaultProfileStagePolicies` in `server/model-catalog.mjs` holds three
  matrices, one per workflow profile. Change the role there.
- Keep the `fast` profile cheaper than `standard`. If a swap only helps on
  `multi-package` cases, change `standard` and `high-risk` and leave `fast` alone.
- Record the change and the campaign ID in `AGENTS.md` under "Durable workflow
  decisions", replacing the current default-model sentence.
- Update `MODEL_PRICING` and `PRICING_VERSION` in `server/model-catalog.mjs` when a
  new model is adopted so cost estimates stay labelled and truthful.

### 6.4 When a new model ships

1. Add the model to the bundled catalogue if it is a Claude model, or confirm it
   appears in the Codex catalogue.
2. Add one override variant per role for the new model to a copy of
   `role-sweep.json`.
3. Run `npm run eval` against the same suite and frozen base as the last campaign
   so results are comparable.
4. Apply section 6.2.

### 6.5 Signs the suite itself needs work

- Blind scores cluster at 4 to 5 for everything: the cases are too easy. Add a
  multi-package case with a real interface change.
- Blind scores disagree with gate verdicts often: read the judge output. If the
  judge is wrong, tighten acceptance criteria. If the gates are wrong, that is a
  finding about the `dev-review` or `test` role, not the suite.
- Wall time varies more than 30 percent between reruns of the same pair: run at
  concurrency 1 and check nothing else is using the machine.

## 7. Dispatch graph for a coordinating agent

A coordinating agent may run these packages through subagents. Packages in the
same row are independent and may run in parallel, each in its own Git worktree.
A row starts only when every package above it is merged and `npm test` passes on
the integration branch.

| Row | Packages | Mode | Why |
| --- | --- | --- | --- |
| 1 | WP0 | alone | Its result decides whether anything else proceeds. |
| 2 | WP1, WP1b, WP2 | parallel | Disjoint files. WP1 and WP1b both touch `task-creation-routes.mjs`; merge WP1 first, then rebase WP1b. |
| 3 | WP3 | alone | Depends on all of row 2. Largest package. |
| 4 | WP4, WP5 | parallel | Both read WP3's manifest format. Disjoint files. |
| 5 | WP6 | alone | Wires the others together. |
| 6 | first real campaign | alone | Baseline variant only, then the role sweep. |

Merge order inside a row is the order listed. After each merge run
`npm run lint`, `npm run typecheck`, and `npm test`. A subagent's branch that
fails these is sent back once with the failing output; a second failure is
escalated to the operator rather than retried again.

## 8. Guardrails for implementing agents

- Never call `approve-merge`, `open-pr`, or `complete-merged` from any evaluation
  code or test. Add an assertion for this in the runner tests.
- Never commit anything under `.data/`. Never commit `variant-map.json` anywhere.
- Keep every new source file under 500 lines. Split by responsibility, not by
  line count.
- Run `npm run lint`, `npm run typecheck`, and `npm test` before declaring a
  package done. Add new test files to the `test` script in `package.json`.
- Do not change the meaning of existing fields on `task.experiment` or the
  evaluation summary. Add fields instead.
- If a package cannot be finished as specified, write what blocked it at the top
  of this document under a "Blocked" heading with the exact error, and stop. Do
  not narrow the package silently.
