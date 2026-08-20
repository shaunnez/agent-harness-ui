# Harness V2: the cognitive layer

Status: proposed, not started.
Owner: Shaun.
Scope rule: **do not touch** the candidate / worktree / gate / repair-authority / PR-authority
architecture. That machinery is the moat. Everything below sits *above* it.

## Thesis

The execution layer is done. Two things are missing:

1. **No agent owns "what do I believe is happening".** `server/scouts.mjs` produces facts,
   which are then deterministically concatenated into a scout report. Nothing turns facts
   into ranked hypotheses with confidence and unknowns.
2. **Retry means "run the coder again".** `server/orchestrator-gate-evaluation.mjs` resolves an
   accepted candidate defect to `repair-required`, and `server/orchestrator-repair-execution.mjs`
   hands a write-enabled agent the candidate. The policy docs describe backjumping to
   plan/spec/environment; the runtime does not do it.

And a third, meta problem: we cannot tell whether fixing 1 and 2 helps, because
`server/evaluation.mjs` can compare *models and policies* but not *topologies*.

So: measurement first, contracts second, cognition third, backjumping fourth.

## Decisions taken (change these before starting if you disagree)

| Decision | Choice | Rationale |
|---|---|---|
| Failure taxonomy | All 8: `IMPLEMENTATION_DEFECT`, `PLAN_DEFECT`, `SPECIFICATION_GAP`, `INVESTIGATION_GAP`, `VERIFICATION_GAP`, `ENVIRONMENT_FAILURE`, `INTEGRATION_FAILURE`, `TARGET_DRIFT` | Each maps to a distinct rewind target. Collapsing any two loses a routing edge. |
| Topology identity | `topology-<shape>-v<N>` e.g. `topology-bug-localisation-v1` | Named by shape so experiments are readable; versioned so changes are comparable. |
| Contract mechanism | Reuse the existing labelled-XML-block + `parseLabelledJson` idiom in `server/structured-output.mjs` | Matches the harness's own convention. No new protocol, no new failure modes. |
| Opposition / challenger | Deferred to after Phase 6 | Only pays on high-uncertainty runs; needs eval data to justify. |
| Safety-vs-topology split | Deferred to after Phase 6 | `server/workflow-profiles.mjs` stays as-is until topologies exist to separate from. |
| UI surface | No new rooms. New stages render as sub-steps inside the existing Investigation and Planning rooms. | Ten rooms is the product. |

## Phases

Each phase is independently mergeable and must leave `npm run lint`, `npm run typecheck`,
and `npm test` green. No phase is "done" without tests.

---

### Phase 0 — Baseline (30 min)

Record the current state so later phases have something to regress against.

- Capture `npm run lint`, `npm run typecheck`, `npm test` output to
  `docs/harness-v2/baseline.txt`.
- Count replayable historical tasks in the running app's SQLite store
  (`scripts/export-task-store-json.mjs`). Record the number.
- **Done when:** baseline file exists and the task count is written into this plan below.

> Replayable task count: _TBD in Phase 0_

If that count is under ~20, Phases 1–5 still ship, but the eval lab stays cold — the
comparison in Phase 6 will be anecdotal, not statistical. Say so out loud rather than
over-claiming.

---

### Phase 1 — Topology telemetry (half day)

Make topology an experimental variable.

Files: `server/evaluation.mjs`, `server/task-projections.mjs`, `tests/evaluation.test.mjs`.

- Add to the experiment snapshot alongside `policyMatrix`: `topologyId`, `topologyVersion`.
- Add to per-task metrics (`experimentTaskMetrics`): `nodesExecuted`, `nodesSkipped`,
  `edgesTaken`, `routingDecisions`, `challengeCount`, `backjumpCount`,
  `failureClassifications`.
- Aggregate those in `controlledSummary` the same way `repairCount` / `retryCount` are.
- Everything defaults to empty/zero so existing tasks and existing experiments keep working.
  This phase must be strictly additive.
- **Done when:** an experiment with `topologyId: "topology-baseline-v1"` round-trips through
  `buildEvaluationSummary` and appears as a distinct variant, with a test proving that two
  variants differing only in topology are reported separately.

---

### Phase 2 — Typed cross-stage contracts (1–2 days)

Reduce entropy before adding agents. Markdown becomes a rendering, not a protocol.

Files: `server/structured-output.mjs`, `server/prompts.mjs`, plus one new
`server/contract-rendering.mjs` for the Markdown views, and tests per parser.

New parsers, each following the existing `parseWorkPackages` / `parseGateEvidence` shape
(fail-closed, bounded lengths, bounded array sizes):

- `parseInvestigationResult` — hypotheses[{id, claim, confidence, supportingEvidence[],
  contradictingEvidence[], unknowns[]}], recommendedDiagnosis, remainingUncertainty,
  additionalEvidenceNeeded[].
- `parsePlanCritique` — verdict PASS | REVISE, blocking[{dimension, claim, evidence[]}],
  advisory[].
- `parseFailureDiagnosis` — classification (one of the 8), rewindTo (stage id), rationale,
  evidence[], confidence.

Then: for each new contract, a `render*Markdown` function so the UI and Shaun read prose
while downstream agents receive the object.

- **Done when:** each parser has a test for the happy path, a malformed-JSON rejection, a
  missing-block rejection, and an out-of-bounds rejection; and each renderer has a snapshot
  test. No orchestrator wiring yet.

---

### Phase 3 — Investigation synthesis (1 day)

The biggest missing cognitive step.

Files: `server/orchestrator-investigation.mjs`, `server/prompts.mjs`,
`server/orchestrator-task-helpers.mjs` (stage map), `src/` Investigation room.

- New stage `synthesis`, between `scouts` and `grill`, fresh context, read-only.
- Input: the scout reports plus repository access. **Not** scout internal transcripts.
- Output: an `InvestigationResult` (Phase 2 contract).
- Downstream (`grill`, `specification`) receives the contract + selective source evidence,
  not the concatenated report.
- Skipped entirely on the `fast` profile — a padding bug does not need a hypothesis ledger.
- UI: renders inside the existing Investigation room as `Synthesis ✓ H1 82%`.
- **Done when:** an orchestrator test drives triage → scouts → synthesis → grill and asserts
  the grill prompt received the typed contract; and `fast` profile skips it, recording the
  skip in `nodesSkipped` from Phase 1.

---

### Phase 4 — Failure diagnosis + backjump router (2–3 days)

The biggest lifecycle win. Turns retry into rewind.

Files: `server/orchestrator-gate-evaluation.mjs`, `server/orchestrator-repair-execution.mjs`,
`server/orchestrator-repair-authority.mjs`, new `server/failure-routing.mjs`.

- Insert a **read-only** `failure-diagnosis` step between an accepted defect and repair
  dispatch. It classifies; it does not fix.
- `server/failure-routing.mjs` maps classification → rewind target → invalidation set,
  deterministically (a pure function, fully unit-testable, no model call):
  - `IMPLEMENTATION_DEFECT` → repair candidate (today's behaviour)
  - `PLAN_DEFECT` → invalidate plan, candidate, dev-review, test → re-plan
  - `SPECIFICATION_GAP` → invalidate spec onward → re-grill/re-spec
  - `INVESTIGATION_GAP` → targeted re-scout → re-synthesis
  - `VERIFICATION_GAP` → revise verification commands, no code change
  - `ENVIRONMENT_FAILURE` → environment remediation, no rewind
  - `INTEGRATION_FAILURE` → re-derive integration slice
  - `TARGET_DRIFT` → refresh base, re-qualify candidate
- Existing bounded-retry, repair-authority, and candidate-freshness rules are **unchanged
  and still authoritative**. Backjumping must consume the same budget, not escape it.
- Every routing decision is recorded into the Phase 1 `routingDecisions` / `backjumpCount`.
- **Done when:** `failure-routing.mjs` has full-table unit coverage; an orchestrator test
  proves a `PLAN_DEFECT` invalidates the candidate and returns to planning without burning
  an implementation retry; and a test proves retry budget still caps total attempts.

---

### Phase 5 — Plan critic + bounded revise loop (1–2 days)

Stop bad implementations before token spend.

Files: `server/orchestrator-specification-planning.mjs`, `server/prompts.mjs`.

- New `plan-review` stage after `plan`, fresh context, read-only, different model from the
  planner by default (planner = default policy, critic = cross-model) so the comparison in
  Phase 6 can test same-model vs cross-model opposition.
- Checks only: acceptance coverage, missing affected surfaces, incorrect assumptions,
  package boundaries, dependency ordering, owned-path completeness, verification adequacy,
  migration/data risk, rollback strategy, unnecessary scope.
- Hard constraint in the prompt: **a blocking finding must name a concrete flaw against the
  specification or the evidence.** Taste is advisory, never blocking.
- REVISE → planner v2 → critic again. Bounded at 2 revisions, then escalate to human.
- Mandatory on `high-risk`, on by default on `standard`, off on `fast`.
- UI: renders in the existing Planning room as `Plan r1 → Critic 2 blocking → Plan r2 → PASS`.
- **Done when:** a test proves a taste-only critique cannot block; a test proves the revise
  loop terminates at 2 and escalates; and `fast` skips it.

---

### Phase 6 — Verify against small / medium / large (1 day + run time)

Not "does it compile" — does the topology actually behave differently per task size.

Run three real tasks against this repo, through the harness, recording topology telemetry:

| Size | Profile | Expected topology | Expected node count |
|---|---|---|---|
| Small | `fast` | triage → 0-1 scout → implement → review | synthesis, plan-review skipped |
| Medium | `standard` | triage → scouts → synthesis → grill → spec → plan → plan-review → implement → review → test | full path, ≤1 critic revision |
| Large | `high-risk` | as medium, plus mandatory critic and human gates | full path, backjump exercised at least once |

- **Done when** all three complete and `buildEvaluationSummary` shows three distinct
  topology variants with non-empty `nodesExecuted` / `nodesSkipped`, and at least one run
  recorded a `failureClassification` other than `IMPLEMENTATION_DEFECT`.
- If the large task never fails, **do not fake a failure**. Note that the backjump path is
  unit-tested but not yet observed end-to-end, and say so.

---

## Deferred (only after Phase 6 has data)

1. Conditional opposition / challenger stage, gated on `remainingUncertainty`.
2. Split safety envelope from execution topology in `server/workflow-profiles.mjs`.
3. Learn routing thresholds from the eval corpus.

## Honest limits

- The research cited (MASAI, SWE-Debate, UA-ChatDev, AgentConductor, SWE-Cycle) supports the
  *shape* — specialists, typed artifacts, hypothesis diversity before convergence, topology
  adapted to difficulty. It does not prescribe this exact sequence. Phase 1 exists precisely
  so we stop guessing.
- Requirements-engineering and design phases are the least-benchmarked part of the SDLC.
  Confidence in Phases 4–5 should be lower than in Phases 1–3 until measured.
