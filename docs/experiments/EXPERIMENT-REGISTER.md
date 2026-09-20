# EXPERIMENT-REGISTER.md — model policy evaluation

One entry per experiment. An entry is written **before** any spend and is not
edited once an outcome is known; a new dated block is appended instead. An
experiment with no preregistered decision rule produces an anecdote, not a
result.

Statuses: `PROPOSED` (no spend) · `RUNNING` · `COMPLETE` · `REFUTED` (ran, did
not hold — refutations are results) · `ABANDONED` (say what blocked it).

**Every entry must carry before it leaves `RUNNING`:** the manifest path plus
its SHA-256; the preregistered prediction and decision rule; what would refute
it; and actual spend in dollars and provider calls.

## Standing measurement rules

These apply to every entry below.

1. **Primary outcome is deterministic delivery**, not gate pass rate. A sample
   counts as delivered only when a `full-manifest` verification run whose
   `headRevision` equals the final candidate's head reports `passed` with every
   declared command executed. `unknown` samples are excluded from the
   denominator and reported as coverage.
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

---

## EXP-001 — Baseline run-to-run variance (Phase 0)

| | |
|---|---|
| Status | **PROPOSED**, 20 Sep 2026. No task created, no spend |
| Manifest | `docs/experiments/model-baseline-2026-09-phase0.json` · sha256 `555fa4b532aa97c51f34675ece7e0ab5f64a5d84ec9cb0a6b5081970540f6e70` |
| Runner | `scripts/experiment-run.mjs` · sha256 `829fac7e67a74f7a82bb6f6190566919c57769c00ec7eff082bd45a99503c4c8` |
| Group id | `model-baseline-2026-09-phase0` |
| Design | Baseline arm `B0-baseline` only. 2 cases × 3 repetitions = **6 tasks**. `C1-narrow` (AH-082 replay, `standard`), `C4-backend` (AH-058 replay, `high-risk`) |
| Bases | `C1-narrow` f18c5673… · `C4-backend` 21b63f5c… Both pinned in dedicated eval worktrees under `/Users/shaun/projects/.worktrees/eval-baseline-2026-09-*` |
| Spend ceiling | **$60.** Historical cost per task in this store: median $1.40, p75 $4.13, p90 $7.20, max $25.65 across 77 tasks with a recorded estimate. 6 × p90 ≈ $43 |
| Abort rule | Stop and re-plan if realised spend passes $60, or if any single task passes $15 |

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

### Result

*Not yet run.*

---

## EXP-002 — Which role bundle actually pays for a better model (Phase A)

| | |
|---|---|
| Status | **PROPOSED**, 20 Sep 2026. Blocked on EXP-001 |
| Manifest | `docs/experiments/model-baseline-2026-09.json` · sha256 `d3d44670498ef53198fa41d7c1e6552e631ad5a7f8a35a0cdc1443d51d1aca81` |
| Group id | `model-baseline-2026-09` |
| Design | 6 cases × 4 arms = **24 tasks**, 1 repetition, subject to EXP-001's decision rule |
| Arms | `B0-baseline` (shipped Codex matrix) · `A1-build` (build bundle → Sonnet 5 xhigh) · `A2-decide` (decide bundle → Opus 5 xhigh) · `A3-understand-cheap` (understand bundle xhigh → high) |
| Spend ceiling | **$400.** 24 × p90 ≈ $173 at historical rates; `A2-decide` runs Opus on three roles, so the ceiling carries roughly a 2× margin |
| Abort rule | Stop after any 8 consecutive tasks if realised spend projects past $400, or if more than 2 tasks report `unknown` delivery |

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
**≤ 70%** of baseline dollar cost.

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
