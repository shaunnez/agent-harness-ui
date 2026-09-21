# EXPERIMENT-REGISTER.md — model policy evaluation

One entry per experiment. An entry is written **before** anything runs and is not
edited once an outcome is known; a new dated block is appended instead. An
experiment with no preregistered decision rule produces an anecdote, not a
result.

Statuses: `PROPOSED` (nothing run) · `RUNNING` · `COMPLETE` · `REFUTED` (ran, did
not hold — refutations are results) · `ABANDONED` (say what blocked it).

**Every entry must carry before it leaves `RUNNING`:** the manifest path plus
its SHA-256; the preregistered prediction and decision rule; what would refute
it; and realised cost as an API-rate estimate, with the provider call count.

## Standing measurement rules

These apply to every entry below.

1. **Primary outcome is deterministic delivery**, not gate pass rate. A sample
   counts as delivered only when a `full-manifest` verification run whose
   `headRevision` equals the final candidate's head reports `passed` with every
   declared command executed. `unknown` samples are excluded from the
   denominator and reported as coverage. Both manifests declare
   `decisionMetric: "deterministic-delivery-rate"` explicitly, so the metric is
   inside the hash recorded below rather than inherited from a default that
   could later change.
2. **Gate pass rate is not a quality metric.** `dev-review`, `test` and
   `final-review` are themselves model runs, so a laxer reviewer policy scores
   more passes. Gate columns are diagnostic only and may never be used to
   declare an arm better.
3. **A variant labelled `mixed-identity` is not a comparison** and its number
   is not reported as a result.
4. **A variant containing a policy divergence is contaminated** — a run executed
   a policy other than the one selected — and is excluded until re-run.
5. **Cost is reported alongside every outcome.** An arm that delivers the same
   and costs more is a worse arm.
6. **No dollars are billed and no API key is used.** Both providers run the
   operator's local CLI session — Codex against `CODEX_HOME`, Claude against the
   OAuth profile under `CLAUDE_CONFIG_DIR` — and `server/claude-runtime.mjs`
   denylists `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_BASE_URL`
   while `server/codex-runtime.mjs` builds its child env from an allowlist that
   omits `OPENAI_API_KEY`. Every dollar figure below is therefore the
   **API-rate estimate** from `server/model-catalog.mjs` (`PRICING_VERSION`
   2026-08-02), used as a comparable unit of work across arms. The real
   exhaustible resource is plan quota and rate limits, so a ceiling breach means
   stop and re-plan, not an unexpected charge.

---

## EXP-001 — Baseline run-to-run variance (Phase 0)

| | |
|---|---|
| Status | **REFUTED**, 21 Sep 2026. Ran as AH-007..012; all six samples `unknown`, primary metric unusable for this run |
| Manifest | `docs/experiments/model-baseline-2026-09-phase0.json` · sha256 `e7e29f890134b39056d804d85c3e6041d733419619df136217fb2fa72d128652` |
| Runner | `scripts/experiment-run.mjs` · sha256 `4b4734ee258cfa9d67ff6ef8b4d93c354df796172c5ee7869bbaaff94ea5844c` |
| Group id | `model-baseline-2026-09-phase0` |
| Design | Baseline arm `B0-baseline` only. 2 cases × 3 repetitions = **6 tasks**. `C1-narrow` (AH-082 replay, `standard`), `C4-backend` (AH-058 replay, `high-risk`) |
| Bases | `C1-narrow` f18c5673… · `C4-backend` 21b63f5c… Both pinned in dedicated eval worktrees under `/Users/shaun/projects/.worktrees/eval-baseline-2026-09-*` |
| Cost ceiling (API-rate estimate, see rule 6 — not billed) | **$60.** Historical cost per task in this store: median $1.40, p75 $4.13, p90 $7.20, max $25.65 across 77 tasks with a recorded estimate. 6 × p90 ≈ $43 |
| Abort rule | Stop and re-plan if the realised estimate passes $60, or if any single task passes $15 |

### What this measures

Whether the same policy matrix, on the same brief, at the same commit, delivers
the same outcome twice. Nothing about model choice is learned here. This exists
because the 24-run comparison in EXP-002 assumes one sample per arm-case
resolves a difference, and that assumption is false if the baseline disagrees
with itself.

### Prediction, preregistered

Baseline deterministic delivery will be **unanimous within each case** — 3/3 or
0/3 — for at least one of the two cases. `C1-narrow` is the more likely to be
unanimous; `C4-backend` is `high-risk` with seven verification commands and a
real migration constraint, so it is the more likely to split.

### Decision rule, preregistered

| Phase 0 outcome | What EXP-002 does |
|---|---|
| Both cases unanimous | Run EXP-002 as designed: 6 cases × 4 arms, 1 repetition, 24 tasks |
| One case splits (e.g. 2/3) | Raise that case's repetitions to 3 in EXP-002 and drop the weakest case, holding the run count near 24 |
| Both cases split | **Binary delivery cannot resolve an arm difference at this sample size.** Do not run EXP-002. Either add a graded rubric outcome via `scripts/record-evaluation.mjs` and re-derive the power, or raise repetitions to 3 across the board (72 tasks) and re-cost it first |

### What would refute the design

- Any of the 6 samples reporting `unknown` deterministic delivery — the
  verification evidence the primary metric depends on is not being produced at
  the final candidate revision, and the metric is unusable until that is fixed.
- Any variant labelled `mixed-identity` — 3 repetitions of one case under one
  arm must share a brief hash, base, policy matrix and both definitions. A
  label here means the creation path is not producing identical variants and
  the tooling is wrong.
- Any policy divergence — a pinned role escalated anyway, which would mean
  `task-override` pinning does not hold and every arm in EXP-002 is
  unenforceable.
- Wall time or cost varying by more than 3× between repetitions of one case,
  which would make the cost comparison in EXP-002 meaningless.

### Deviation from design, recorded 21 Sep 2026 before any result

All 6 tasks were dispatched **concurrently** rather than serially, at the
operator's decision, to get the delivery signal in one pass instead of over
several hours.

The consequence is recorded here rather than discovered later: six CLI sessions
competing for CPU and provider rate limits inflate wall time unevenly, so the
timing-spread refutation condition above **cannot be evaluated for this run**.
A >3× spread between repetitions must be read as evidence about contention, not
about the harness, and may not be used to refute the design.

Deterministic delivery, `mixed-identity` and policy divergence are unaffected —
none of them depends on timing — so the primary outcome and the other three
refutation conditions stand. If EXP-002's cost comparison needs a clean
per-task baseline, it has to come from a serial re-run, not from this one.

### Result

**Recorded 21 Sep 2026.** Tasks AH-007 through AH-012 in the isolated store at
`.claude/worktrees/frontier-3d-minimap-zoom-8efd8c/.data/tasks.sqlite3`. The
earlier attempt, AH-001..006, stalled at manual gates, delivered nothing and is
not a sample here; it is retained in the store and discussed under *Tooling
defects* below.

Run under all seven gate policies and `grillPolicy` set to
`auto-accept-recommendations`, which held — **no task parked at a gate**, and no
grill question or specification was answered by hand. The failure mode that
ended the first attempt did not recur.

#### Deterministic delivery per case

Computed with `buildEvaluationSummary` (`server/evaluation.mjs`) over AH-007..012
only.

| Case | r1 | r2 | r3 | Unanimous? | Delivery rate |
|---|---|---|---|---|---|
| `C1-narrow` | `unknown` | `unknown` | `unknown` | yes, 3/3 `unknown` | `null` — no evidence samples |
| `C4-backend` | `unknown` | `unknown` | `unknown` | yes, 3/3 `unknown` | `null` — no evidence samples |

All six tasks reached terminal status `failed` with **zero candidates**, so no
`full-manifest` verification ran at any final candidate revision and
`deterministicEvidenceSamples` is 0 for every variant. Under standing rule 1 all
six are excluded from the denominator; coverage is **0/6**.

The unanimity is real but it is unanimity of *absent evidence*, not of a delivery
outcome, and it does not satisfy the "both cases unanimous" row of the decision
table below.

#### Mixed-identity and policy divergence

Neither condition fired.

- **No `mixed-identity` label.** Every variant reports
  `comparability.status = "comparable"`. Each case's three repetitions share one
  brief hash (`C1` `bf7211612ebb…`, `C4` `c63d45c45992…`), one base, one policy
  matrix, one acceptance definition and one verification definition.
- **No policy divergence.** `policyDivergences` is empty for all six; no pinned
  role escalated.
- **No decision-metric drift.** All six carry
  `decisionMetric: "deterministic-delivery-rate"`, `decisionMetricDrift: false`.

So the creation path and `task-override` pinning both hold. The failure is not in
the experiment tooling's identity or policy handling.

#### Why every sample is `unknown`

**Root cause: the frozen eval worktrees have no dependencies installed.** None of
the three `eval-baseline-2026-09-*` worktrees contains `node_modules`. Every
verification command the experiment declares was run against an unprovisioned
checkout.

This was established after two earlier misdiagnoses, both recorded here because
the sequence matters: the failure was first read as a genuine defect at the base
(three identical reproductions), then as contention from concurrent dispatch (a
serial run came back green). Both were wrong, and the second was wrong in a way
that would have wasted a re-run — dispatching serially into the same
unprovisioned worktrees reproduces the failure exactly.

**`C1-narrow` ×3 — missing dependencies, reported as a baseline defect.** All
three parked on blocker `repository-baseline-verification`: *"Repository baseline
verification failed for test at f18c567374e9. The same command fails before S1's
changes."* All three recorded the identical signature,
`tests=308 pass=304 fail=4`.

The revision is sound. From a fresh clone at f18c5673 **with** `node_modules`
present, `npm test` gives `524 tests / 524 pass / exit 0`, confirmed twice.
Deleting `node_modules` from that same clone reproduces the harness result
exactly:

```
not ok 2  - tests/api.test.mjs
not ok 12 - tests/operator-prototype.test.mjs
not ok 13 - tests/operator-runtime-view.test.mjs
not ok 18 - tests/runtime.test.mjs
# tests 308 / pass 304 / fail 4
Cannot find package 'react'
```

The four failures are not assertions — they are four whole test *files* failing to
import. The 308-vs-524 gap is exactly those files' tests never registering, not
tests abandoned under load. The harness then correctly applied its rule (do not
repair a candidate for an unchanged baseline failure) to a premise that was true
of the environment and false of the revision, and failed all three tasks.

The pinned worktree was never touched and remains clean at f18c5673; all
reproduction ran in a scratch clone.

**`C4-backend` ×3 — run timeouts, cause not established.** All three failed with
`S<n>: Codex run exceeded 900 seconds` on their first work package (AH-011 on two
packages), with every later package still `planned`. No candidate was ever
assembled.

`eversor-plancheck` is also unprovisioned, and its seven declared commands need
`frontend/node_modules` and a Python virtualenv at `backend/.venv`
(`test:backend` invokes `backend/.venv/bin/python -m pytest`). An implement run
against a tree where nothing executes is a plausible way to burn 900 seconds, but
**this is not confirmed** — no run records survive on these tasks, and CPU
contention from six concurrent sessions remains an untested alternative. C4 stays
unexplained until a provisioned serial run either clears it or reproduces it.

#### What the concurrency deviation does and does not explain

The deviation note above states that concurrent dispatch affects wall time only,
and that deterministic delivery is unaffected because it does not depend on
timing.

For `C1` that claim **holds** — those three failures are fully explained by
missing dependencies and would have occurred identically under serial dispatch.
An earlier version of this entry concluded the note was refuted; that conclusion
was based on the contention misdiagnosis and is withdrawn.

For `C4` the claim is **untested**. A 900-second wall-clock run ceiling is by
construction sensitive to contention, so concurrency cannot be ruled out as a
contributing cause there. Whether it is the cause, or whether S1 simply exceeds
900s against an unrunnable tree, is the open question a provisioned serial re-run
has to answer.

Recorded timing, for completeness: `C1` 581,743–1,141,054 ms (1.96×), `C4`
1,491,570–1,669,198 ms (1.12×). Both within 3×, but per the deviation note these
spreads remain unevaluable as a refutation condition.

#### Realised cost

**API-rate estimate, $2.85 total** — nothing was billed. Per standing rule 6 both
providers ran the operator's local CLI session with no API key, so this is the
`server/model-catalog.mjs` estimate (`PRICING_VERSION` 2026-08-02) used as a
comparable unit of work.

| Task | Variant | API-rate est. | Wall time | Cause |
|---|---|---|---|---|
| AH-007 | `C1-narrow` r1 | $0.460 | 755,627 ms | false baseline defect |
| AH-008 | `C1-narrow` r2 | $0.398 | 1,141,054 ms | false baseline defect |
| AH-009 | `C1-narrow` r3 | $0.272 | 581,743 ms | false baseline defect |
| AH-010 | `C4-backend` r1 | $0.597 | 1,631,340 ms | S1 >900s |
| AH-011 | `C4-backend` r2 | $0.600 | 1,669,198 ms | S1, S2 >900s |
| AH-012 | `C4-backend` r3 | $0.525 | 1,491,570 ms | S1 >900s |

Against the $60 ceiling and the $15 single-task abort rule, neither was
approached — the run died on correctness, not cost. Every task failed early, so
these figures are **not** a usable per-task cost baseline for EXP-002.

Provider call count: the six tasks recorded stage runs through triage, scouts,
grill, specification and plan before failing in implement; no run reached
dev-review, test or final-review, so all gate columns are 0 and are diagnostic
only under standing rule 2.

#### Refutation conditions: which fired

| Condition | Fired? |
|---|---|
| Any sample `unknown` | **Yes — all six.** |
| Any variant `mixed-identity` | No |
| Any policy divergence | No |
| Wall time or cost varying >3× between repetitions | Unevaluable (see deviation note) |

The first condition is preregistered as: *"the verification evidence the primary
metric depends on is not being produced at the final candidate revision, and the
metric is unusable until that is fixed."* It fired on 6 of 6 samples. **This entry
is refuted.** The baseline variance question EXP-001 exists to answer is not
answered — not answered either way.

#### Defects found

Four. None changes the result above; all should be fixed before a re-run.

1. **The eval bases were never provisioned, and nothing checks.** This is the
   defect that cost the run. All three `eval-baseline-2026-09-*` worktrees lack
   `node_modules`; `eversor-plancheck` additionally needs `backend/.venv` for
   four of its seven declared commands. The experiment design assumed the frozen
   bases satisfy their own verification manifests and never verified it — there is
   no precondition anywhere in `scripts/experiment-run.mjs` or the manifest that
   requires a base to be green before cases are created from it.
2. **Baseline verification cannot distinguish a broken revision from a broken
   environment.** It ran the repository's `test` command in an unprovisioned
   worktree and reported *"the same command fails before S1's changes"* — literally
   true, and materially misleading. The verdict names a revision (`f18c567374e9`)
   for a failure that has nothing to do with that revision. A check whose purpose
   is to exonerate the candidate should separate "this revision is broken" from
   "this checkout cannot run".
3. **Retained verification output is truncated past the diagnosis.** Only a
   4001-character tail of command output is kept, which cut off every `not ok`
   line and the `Cannot find package 'react'` error. With those retained the root
   cause would have been visible immediately instead of taking two wrong
   diagnoses to reach.
4. **The scorecard pools abandoned tasks.** `/api/evaluations/summary` groups by
   `variantId`, so AH-007 is pooled with AH-001 from the abandoned first attempt
   (`sampleCount: 2`, `unknown: 2`) despite AH-001 being a different run under a
   different gate configuration. The table above was computed over AH-007..012
   explicitly to avoid this. No task was deleted to make the number look better.

#### Decision: what EXP-002 does

EXP-001's decision table branches on the unanimity of *deterministic delivery*
across repetitions. With `deterministicEvidenceSamples = 0` for both cases there
is no delivery rate to be unanimous about, so **none of the three rows applies**
and the table cannot be entered. The refutation clause governs instead.

**EXP-002 does not run.** Not because an arm lost, and not because the sample
size is too small — because this run produced no measurement at all. Running a
24-task comparison on an apparatus that yielded 0/6 evidence samples would spend
roughly an order of magnitude more quota to produce the same nothing.

Phase 0 must be re-run, and the re-run must, in order:

1. **Provision every eval base.** Install `node_modules` in each
   `eval-baseline-2026-09-*` worktree, plus `frontend/node_modules` and
   `backend/.venv` for `eversor-plancheck`. `node_modules` is gitignored in all
   three, so the pins survive: HEAD unchanged, `dirty=0`.
2. **Verify each base is green against its own declared manifest before creating
   any task.** This should become a hard precondition of the runner, not a manual
   step — a case whose base cannot pass its own verification commands is not a
   case, and creating tasks from it can only produce `unknown`.
3. **Dispatch serially.** Not as the fix for `C1` — provisioning is that fix, and
   serial dispatch alone would have reproduced the `C1` failure exactly. Serial is
   required for two other reasons: it removes contention as a variable so `C4`'s
   900-second timeout can be attributed, and it produces the clean per-task cost
   and timing baseline EXP-002's cost comparison needs and this run could not
   supply. It also restores the >3× timing refutation condition, which a
   concurrent run cannot evaluate.
4. **Resolve `C4-backend`'s 900s ceiling if it survives provisioning.** If S1
   still exceeds 900s when it is the only thing running against a working tree,
   the case is too large for the ceiling and either the ceiling or the case must
   change — and changing the case is a preregistered-design change, so it needs
   its own register entry and a recomputed manifest hash.

Only once a Phase 0 re-run yields six samples with admissible evidence does the
decision table become answerable, and only then can EXP-002 be scheduled.

---

## EXP-001 — run 2 and run 3, appended 21 Sep 2026

EXP-001's first result block above stands as written. This block appends what two
further executions of the same preregistered design found, after the causes
recorded there were fixed. The manifest, cases, arms and decision metric are
unchanged; their SHA-256s are unchanged.

### Run 2 — AH-013..018, bases provisioned

`node_modules` was installed in `eval-baseline-2026-09-agent-harness-ui` and
`frontend/node_modules` plus `backend/.venv` in `eval-baseline-2026-09-eversor-plancheck`
(the latter through the repository's own `make backend-venv`). Both bases were then
verified green against their declared manifests before any task was created — C1 5/5
commands, C4 7/7. Both pins stayed clean; `npm install` was reverted in favour of
`npm ci` after it rewrote a tracked lockfile.

Result: **0/6 delivered.** Provisioning fixed C1's failure entirely — all three reps
built candidates for the first time — but exposed the next blocker beneath it.

| Case | Outcome | Cause |
|---|---|---|
| `C1-narrow` ×3 | parked at `ready-for-review` | `mergeState` cannot read a detached base |
| `C4-backend` r1 | failed, implement | S1 >900s on a provisioned tree |
| `C4-backend` r2, r3 | failed, plan | S3 declared test changes with no test path in `ownedPaths` |

**The detached-base defect.** `RepositoryAuthority` records `commit:<sha>` as the target
ref for a checkout with no branch to advance — which is what a frozen experiment base is.
`GitWorktreeManager.mergeState` passed that string to `git rev-parse --verify`, where
`<rev>:<path>` means a file lookup, so it reported "The candidate target ref no longer
exists" for a commit that was present throughout. Every candidate built on a frozen base
parked at dev-review permanently. Fixed in this branch with `parseCommitSentinel`, plus a
regression test confirmed to fail with the exact production error when the fix is reverted.

**The 900s ceiling.** C4's S1 exceeded it on all four attempts made of it across runs 1
and 2 — three under concurrent load, one running effectively alone on a working tree with
the agent observed running real backend tests at the cutoff. Raised to 1_800_000 for
`implement` and `repair`, for every stage and arm equally rather than per task, so
repetitions stay comparable.

### Run 3 — AH-019..024, both fixes applied

Result: **2/6 delivered.** The first deterministic deliveries the campaign has produced.

| Variant | Outcome | Evidence | Repairs | Retries | Wall |
|---|---|---|---|---|---|
| `C1-narrow` r1 (AH-019) | `unknown` | 0 | 1 | 2 | — |
| `C1-narrow` r2 (AH-020) | **`passed`** | 1 | 0 | 0 | 864 s |
| `C1-narrow` r3 (AH-021) | **`passed`** | 1 | 0 | 1 | 1,256 s |
| `C4-backend` r1 (AH-022) | `unknown` | 0 | 0 | 0 | 2,850 s |
| `C4-backend` r2 (AH-023) | `unknown` | 0 | 0 | 0 | 569 s |
| `C4-backend` r3 (AH-024) | `unknown` | 0 | 0 | 0 | 2,460 s |

Both deliveries satisfy every clause of standing rule 1: `executionKind` `full-manifest`,
`headRevision` equal to the final candidate's head, status `passed`, all five declared
commands executed with none skipped. No variant is `mixed-identity`; every one reports
`comparability: comparable`. No policy divergence in any of the six.

Realised cost: **$5.18** API-rate estimate for run 3, **$10.13** across all eighteen tasks
in the three runs, against a $60 ceiling. No task approached the $15 abort rule. Nothing
was billed (standing rule 6).

**The timeout fix is validated and C4 does not need splitting.** Both C4 reps that reached
implement completed S1 — 1,616 s (AH-024) and 1,661 s (AH-022), about 27 minutes each.
Under the old ceiling both would have been killed mid-work for the fourth and fifth time.
S1 is a bounded ~27-minute package, not an unbounded one, so the timeout justification for
reshaping the case is withdrawn. C4's remaining failures are upstream of the ceiling and
splitting the case would not address them.

### What still blocks a clean 6/6

1. **`review-retry-required` is outside the gate-policy surface.** AH-019's candidate was
   rejected at dev-review, auto-repaired under policy, then its second review could not
   accept its own evidence — a reviewer diagnostic command failed — and the task parked at
   `review-retry-required`. That status is not in `GATE_AUTO_ADVANCE` and not one of the
   seven settable `GATE_STAGES`, so no policy value can advance it; `task-attention.mjs`
   groups it with `failed`. This is a coverage gap, not a misconfiguration, and it is not
   possible to run this experiment unattended until it is closed. The task was left parked
   rather than advanced by hand.
2. **The plan validator rejects `C4-backend` at roughly half of attempts.** Three of six
   plan runs across runs 2 and 3 failed with "Package requires test changes but
   `ownedPaths` contains no explicit test file or test directory" — S3, S3, S4. The package
   number varies, so this is not one bad package: the planning model reliably omits a test
   path on this brief. Either the plan prompt must require a test path whenever a package
   declares test work, or the validator is stricter than the plan format guarantees. This
   is the largest single threat to EXP-002, which runs `C4-backend` four times.

Two run-3 failures were neither of the above and are recorded for completeness: AH-024
completed S1 and then failed to write its commit object because the operator's 1Password
agent could not supply the signing key — environmental, outside the harness; and AH-022
completed S1 and failed `backend-quality`, where `ruff format --check` reported 8 files
needing reformatting. The latter is a genuine model output failure and the only one in the
campaign so far attributable to implementation quality rather than to environment or tooling.

### Decision: EXP-002 still does not run

With `C4-backend` at 0/3 and `C1-narrow` at 2/3 with one sample unreachable, neither case
has three admissible samples. Four `unknown` outcomes remain, so the refutation clause in
the first result block continues to govern and the decision table still cannot be entered.

`C1-narrow` is close: two clean deliveries and one sample lost to a park that a gate-policy
fix would prevent. AH-019 is also the first genuine run-to-run variance the campaign has
produced — same brief, same base, same policy matrix, one reviewer rejection where two
identical repetitions passed first time. That is the phenomenon EXP-001 exists to measure,
and it cost $1.607 against $0.687 for a clean delivery, which is worth carrying into
EXP-002's cost model.

Before Phase 0 is run a fourth time, both blockers above should be closed. Re-running
without them spends quota to rediscover them.

---

## EXP-002 — Which role bundle actually pays for a better model (Phase A)

| | |
|---|---|
| Status | **PROPOSED**, 20 Sep 2026. Blocked on EXP-001 |
| Manifest | `docs/experiments/model-baseline-2026-09.json` · sha256 `11b3ea6bf2daeaeb09bbfa20b396262ebf7e2760d2dcdd1e3528d82abf0d93a6` |
| Group id | `model-baseline-2026-09` |
| Design | 6 cases × 4 arms = **24 tasks**, 1 repetition, subject to EXP-001's decision rule |
| Arms | `B0-baseline` (shipped Codex matrix) · `A1-build` (build bundle → Sonnet 5 xhigh) · `A2-decide` (decide bundle → Opus 5 xhigh) · `A3-understand-cheap` (understand bundle xhigh → high) |
| Cost ceiling (API-rate estimate, see rule 6 — not billed) | **$400.** 24 × p90 ≈ $173 at historical rates; `A2-decide` runs Opus on three roles, so the ceiling carries roughly a 2× margin |
| Abort rule | Stop after any 8 consecutive tasks if the realised estimate projects past $400, or if more than 2 tasks report `unknown` delivery |

### Why one bundle at a time

Varying all ten roles at once — the shape of the earlier plan in
`docs/model-policy-evaluation-plan.md` — cannot attribute a difference to
anything. Each arm here changes one bundle and holds the other seven roles at
baseline, at the same total run count.

### Prediction, preregistered

1. `A3-understand-cheap` will match baseline delivery. The understand bundle is
   five of the ten roles and the cheapest place to save; if dropping it from
   xhigh to high costs nothing, that is the single most valuable result here.
2. `A1-build` will beat baseline on `C5-schema` and `C4-backend` and not on
   `C1-narrow`. Narrow UI work is not where implementation strength shows.
3. `A2-decide` will be the most expensive arm and will **not** beat baseline on
   delivery. It should show up in gate columns — a stricter reviewer failing
   more gates — which under rule 2 above is not a quality win.

Prediction 3 is the one most likely to be wrong, and is the reason the decide
bundle is in the campaign at all.

### Decision rule, preregistered

An arm replaces the baseline **only** if both hold:

- its deterministic delivery is **no lower than baseline on every case**, and
  strictly higher on **at least 2 of 6**; and
- no variant in the arm is labelled `mixed-identity` or carries a policy
  divergence.

An arm is adopted **as a cost reduction** if delivery is equal on every case at
**≤ 70%** of the baseline's API-rate estimate.

Anything else is recorded as **no effect detected at this sample size** — which
is a result, and is not to be reported as "the models are equivalent".

### What would refute it

- A baseline case that fails where the original human-delivered task succeeded:
  the replay is not reproducing the task and the case is invalid.
- An arm winning only on gate columns while deterministic delivery is flat —
  measuring reviewer laxity, not delivery.
- Any arm whose `rolePolicySources` show a role as anything other than
  `task-override`: the arm did not run the matrix it claims to have run.

### Result

*Not yet run.*
