# Harness V2 progress ledger

Single source of truth for the autonomous loop. Update this file at the END of every phase,
before starting the next. If context resets, read this file first.

Plan: `docs/harness-v2-cognitive-layer-plan.md`

## State

Current phase: **5 — plan critic + bounded revise loop**
Last updated: 2026-08-20
Blocked on: nothing

## Phase log

| Phase | Status | Commit | Notes |
|---|---|---|---|
| 0 Baseline | **done** | (this commit) | lint/typecheck/test all green, 429 tests. Corpus: 29 terminal tasks, 0 experiments, 0 evaluations. |
| 1 Topology telemetry | **done** | (this commit) | Additive. 436 tests green (was 429). Topology is now a group key in `controlledSummary`. |
| 2 Typed contracts | **done** | (this commit) | 3 parsers + 3 renderers, 20 new tests. 456 total green. No orchestrator wiring yet, by design. |
| 3 Investigation synthesis | **done** | (this commit) | First real orchestrator change. 465 tests green (was 456). Unit-tested only; not yet observed on a live run. |
| 4 Failure diagnosis + backjump | **done** | (this commit) | 22 new tests, 487 total green. Decision logic fully covered; full-pipeline chain not yet exercised — see F6. |
| 5 Plan critic | not started | — | — |
| 6 Verify S/M/L | not started | — | — |

## Open questions for Shaun

### Q1 (Phase 3) — the plan's "no new rooms" UI decision was based on a wrong picture

The plan said synthesis would render as a sub-step inside an Investigation room. There is no
such room: `src/domain.ts` `workflowStages` is one room per stage, so triage / scouts / grill are
already separate rooms and there was no container to nest inside.

What I did instead, and why:

- **Synthesis is a real stage** in `stageIds`, `workflowStages`, and the runtime workspace, with
  its own label, agent name, and stage summary. Hiding it inside the scouts room would have
  required labelling its artifact `stage: "scouts"`, which would corrupt exactly the telemetry
  Phase 1 just built.
- **Synthesis is deliberately NOT a room on the Atlas floor plan.** Three concrete reasons: the
  top row has no free 142px slot (rooms sit at x=18/176/334/492/650 and `test` starts at 820, a
  28px gap), reflowing five hand-placed rooms is a design change I should not make blind, and
  `final-review` is *already* named "Synthesis Room" — a second synthesis would read as a bug.
  A new `AtlasStageId = Exclude<StageId, "synthesis">` keeps the floor plan at ten rooms with no
  runtime change.

**If you want synthesis on the Atlas, that is a layout decision to make deliberately** — say so
and I will reflow the top row. Otherwise the current split is the honest one: full telemetry,
unchanged map.

## Findings

_Anything measured or learned that changes the plan. Append-only._

### F1 (Phase 0) — the eval lab has never been used

29 tasks in the store, all terminal, spanning 2026-08-06 to 2026-08-14. Every single one has
`experiment: null` and `evaluation: null`. Every one has `workflowProfile.selected = "standard"`
with `source: "migration"` — meaning no task has ever been routed by the profile selector
either; they were all backfilled to standard.

Consequences for the plan:

1. **Phase 6 cannot be a replay of history.** There is no experiment metadata on any historical
   task to re-run against. Phase 6's small/medium/large runs are fresh baselines, not
   comparisons. The plan's Phase 6 wording stands, but nobody should read its output as
   "topology X beat topology Y" — it is "topology X was observed to execute".
2. **The instrument is untested, not just uninstrumented.** `normalizeExperimentInput` and
   `controlledSummary` in `server/evaluation.mjs` have unit tests but have never processed a
   real run. Phase 1 must not assume they work in anger.
3. **Real comparison needs ~20+ paired runs that do not exist yet.** Accumulating them is the
   long pole of this whole effort, and it starts only after Phase 1. Everything before that
   is scaffolding.

This does not change the phase order — measurement still comes first, because without Phase 1
the runs we start accumulating are unmeasurable. It does lower the confidence attached to any
Phase 6 conclusion.

### F2 (Phase 0) — field name for Phase 1

The profile lives at `workflowProfile.selected`, not `workflowProfile.id`. Phase 1's topology
snapshot should sit alongside it as `workflowProfile.topologyId` / `.topologyVersion`, or in the
experiment record — decide when implementing, but do not invent `.id`.

### F3 (Phase 1) — what was added, and the one judgement call

`server/evaluation.mjs` now exports `FAILURE_CLASSIFICATIONS` (all 8), `TOPOLOGY_EDGE_KINDS`
(`advance` / `backjump` / `revise` / `challenge`), `normalizeTopologyIdentity`,
`normalizeTopologyTrace`, and `emptyTopologyTrace`. Phase 4's `failure-routing.mjs` must import
the classification list from here rather than restating it.

The trace shape written by the orchestrator, persisted as `task.topologyTrace`:

    { nodesExecuted: ["triage", ...],
      nodesSkipped: [{node, reason}],
      edgesTaken:   [{from, to, kind}],
      routingDecisions: [{at, classification, rewindTo, rationale}] }

**Judgement call:** topology is part of the experiment group key
(`groupId|variantId|topologyId@version`), so two runs sharing a variant label but walking
different graphs are reported as separate rows rather than averaged together. Averaging them
would silently produce a meaningless middle number, which is worse than an extra row. Runs
without a topology all collapse to `topology-unspecified`, so existing grouping is unchanged.

**Deliberate asymmetry:** `normalizeTopologyTrace` is fail-closed at the write site (a bad edge
kind throws) but fail-soft at the read site (`buildEvaluationSummary` degrades a bad trace to
zeros and increments `invalidTopologyTraces`). Reporting must not be crashable by one bad row.

`server/store.mjs` gained `topologyTrace: null` in both the create shape and the migration
fallback list, so existing tasks migrate cleanly and later phases have somewhere to write.
Nothing in the orchestrator writes a trace yet — that starts in Phase 3.

### F4 (Phase 2) — the constraints are structural, not prompt-only

Three parsers in `server/structured-output.mjs`, three renderers in the new
`server/contract-rendering.mjs`, 20 tests in `tests/cognitive-contracts.test.mjs`
(registered in the `npm test` list). No orchestrator wiring — that is Phase 3 onward.

Where a rule could be enforced by shape instead of by prompt, it was:

- **A hypothesis must cite at least one piece of supporting evidence.** An unevidenced guess
  cannot enter the record dressed as a hypothesis.
- **A blocking plan critique finding must cite evidence and name one of ten closed
  dimensions.** This is the plan's "the critic cannot redesign for taste" rule made
  mechanical: an aesthetic objection fits no dimension and carries no evidence, so it can only
  ever land as advisory. Prompt wording is now a backup, not the enforcement.
- **Verdict and findings must agree both ways.** `REVISE` with no blocking findings and `PASS`
  with blocking findings are both refused.
- **Coherence cross-checks on uncertainty**, in the spirit of the existing focused-test
  status/rows check: claiming zero remaining uncertainty while listing unknowns is refused,
  and so is reporting uncertainty without naming what is unknown.

**Judgement call — `rewindTo` is a proposal, not a decision.** `parseFailureDiagnosis` returns
`proposedRewindTo`, deliberately renamed from the agent's `rewindTo`. Phase 4's routing table
is authoritative and may overrule it; the field is kept so model-vs-router disagreement is
measurable rather than invisible, and `renderFailureDiagnosisMarkdown` says plainly when the
router overruled the agent. The naming makes it impossible for a later phase to mistake the
proposal for the decision.

**Scope decision — four contracts deliberately not built.** The original sketch listed seven
typed contracts (adding `SpecContract`, `PlanContract`, `RepairRequest`, `FinalAssessment`).
Only the three that Phases 3-5 actually consume were built. The other four have no consumer
yet, and `parseWorkPackages` / the fast change contract already cover part of that ground.
Speculative contracts rot; build them when a stage needs one.

`COGNITIVE_STAGE_IDS` includes `synthesis` and `plan-review` ahead of Phases 3 and 5, so a
`rewindTo` naming a stage that does not exist yet is still caught at the contract boundary.

### F5 (Phase 3) — what changed, and what the typechecker caught

`synthesis` now runs between scouts and grill on the standard and high-risk paths, and is
skipped with a recorded reason on the fast path. New: `server/topology-trace.mjs` (the only
writers for `task.topologyTrace`), `_runSynthesis` in `server/orchestrator-investigation.mjs`,
`STAGE_PROMPTS.synthesis` and its `<investigation-result>` contract instruction.

**Downstream context actually changed.** `stageArtifactEntries` now hands grill and
specification the synthesis conclusion *in place of* `repository-scout.md`, falling back to the
scout aggregate whenever synthesis did not run. That fallback is what keeps fast-profile runs
and every pre-existing task behaving exactly as before.

**The typechecker earned its keep.** Adding one stage id surfaced eight distinct places that
declare per-stage data — atlas icons, atlas labels, atlas room geometry, runtime skills, runtime
agent names, hosted preview names, and an exhaustive `switch` in `getRuntimeStageSummary` that
would otherwise have silently returned `undefined` and crashed the workspace header. None of
these were findable by grep alone.

**Two behaviour decisions worth knowing:**

1. **Synthesis gets the planning-tier model** (Sol / Opus rather than Luna / Sonnet). It is the
   one investigation stage doing reasoning rather than retrieval. This is a real per-run cost
   increase on standard and high-risk, and is exactly the kind of thing Phase 6 should measure.
2. **A continuation no longer claims synthesis it never ran.** `createTaskRecord` previously
   marked a static list of investigation stages complete on any continued task. Adding synthesis
   to that list unconditionally would have let a continuation skip forming a hypothesis it never
   formed, so synthesis is included only when the continuation actually carries a synthesis
   artifact.

**Nine existing tests failed and all nine were legitimate.** Six were expectation updates
(completed stages, artifact counts, token totals — the pipeline really is one stage longer) and
three were test stubs that had to answer the new contract. None were weakened to pass.

**Not yet verified end to end.** Every claim above is unit- and orchestrator-test level. No live
run has executed a synthesis stage against a real model. That is Phase 6.

### F6 (Phase 4) — retry now means rewind, and the loop is bounded

New: `server/failure-routing.mjs` (a pure table, 12 tests), `server/orchestrator-failure-diagnosis.mjs`
(the read-only step, 10 tests), and `buildFailureDiagnosisRequest` in `server/prompts.mjs`.
Wired at composition in `server/orchestrator-core.mjs` so **every** repair dispatch passes
through attribution first — both the run coordinator and the fast-path auto-repair in
`_runReviewWithFastRepair` share one `diagnoseThenRepair` entry point.

**The safety property that made this design necessary.** A rewind does not run a repair agent,
so it cannot consume the automatic candidate-repair cycle. Without a second budget, a model that
always answered `PLAN_DEFECT` would bounce between planning and review forever while never
spending the counter that stops repair loops. So backjumps have their own limit
(`BACKJUMP_LIMIT = 2`), counted **from the recorded topology trace rather than a new field**, so
the budget and the telemetry can never disagree about what happened. Exhausting it blocks the
task for a human; it does not fall back to repairing.

**What deliberately costs nothing.** `ENVIRONMENT_FAILURE` blocks for a human without spending
budget — nothing in the reasoning graph is wrong, and charging the task for a machine problem
would be punitive. `TARGET_DRIFT` rebases and re-qualifies without spending budget for the same
reason: the work was never wrong, the branch moved. `IMPLEMENTATION_DEFECT` routes to the
pre-existing repair path byte for byte and is the only classification that touches the repair
budget.

**The rewind reuses an existing precedent, it does not invent one.** `_applyRewind` mirrors the
target-refresh rebuild already in `server/orchestrator-candidate-operations.mjs`: supersede the
candidate, return work packages to `planned`, grant the rewind target stage-run headroom, drop
invalidated completed stages, and let `refreshGateFreshness` recompute what evidence still
counts. It reaches into no gate or repair-authority rule; it restates the task at an earlier
point using primitives the harness already had. Rewind statuses are all statuses that already
existed.

**Fast profile is untouched.** It buys one bounded automatic repair and cannot rewind at all, so
paying for a model call to attribute a failure it may not act on would double its cost for
nothing. The skip is recorded in `nodesSkipped` rather than being silent.

**A test invariant worth keeping:** `invalidation always reaches every stage downstream of the
rewind target`. A rewind that left stale downstream evidence behind would let a later gate pass
on evidence produced against assumptions that have since been discarded. There is also a
superset check — a specification rewind must invalidate everything a plan rewind does, and an
investigation rewind everything a specification rewind does.

**Honest coverage limit.** The 22 tests cover the routing table exhaustively and every decision
branch and state mutation of the diagnosis step, driven through a fake store. What is **not**
covered is the full pipeline chain: a standard-profile task running a real gate to
`repair-required`, calling a real model for attribution, and re-planning from the rewind. A probe
during this phase confirmed the two existing repair tests reach `_diagnoseFailure` but both are
fast-profile early returns, so **no existing test exercises the standard-profile diagnosis path
end to end.** That gap is Phase 6's job, and it is the single most important thing for Phase 6 to
actually observe.
