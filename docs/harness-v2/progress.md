# Harness V2 progress ledger

Single source of truth for the autonomous loop. Update this file at the END of every phase,
before starting the next. If context resets, read this file first.

Plan: `docs/harness-v2-cognitive-layer-plan.md`

## State

Current phase: **3 — investigation synthesis**
Last updated: 2026-08-20
Blocked on: nothing

## Phase log

| Phase | Status | Commit | Notes |
|---|---|---|---|
| 0 Baseline | **done** | (this commit) | lint/typecheck/test all green, 429 tests. Corpus: 29 terminal tasks, 0 experiments, 0 evaluations. |
| 1 Topology telemetry | **done** | (this commit) | Additive. 436 tests green (was 429). Topology is now a group key in `controlledSummary`. |
| 2 Typed contracts | **done** | (this commit) | 3 parsers + 3 renderers, 20 new tests. 456 total green. No orchestrator wiring yet, by design. |
| 3 Investigation synthesis | not started | — | — |
| 4 Failure diagnosis + backjump | not started | — | — |
| 5 Plan critic | not started | — | — |
| 6 Verify S/M/L | not started | — | — |

## Open questions for Shaun

_None yet. Append here rather than blocking, unless proceeding would be unsafe._

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
