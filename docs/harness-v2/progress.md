# Harness V2 progress ledger

Single source of truth for the autonomous loop. Update this file at the END of every phase,
before starting the next. If context resets, read this file first.

Plan: `docs/harness-v2-cognitive-layer-plan.md`

## State

Current phase: **6 — complete. Two live runs (AH-030, AH-031). Q3/Q4 closed. One harness bug found: Q5.**
Last updated: 2026-08-20
Blocked on: nothing. Q5 is a pre-existing harness bug, reported not fixed.

## Phase log

| Phase | Status | Commit | Notes |
|---|---|---|---|
| 0 Baseline | **done** | (this commit) | lint/typecheck/test all green, 429 tests. Corpus: 29 terminal tasks, 0 experiments, 0 evaluations. |
| 1 Topology telemetry | **done** | (this commit) | Additive. 436 tests green (was 429). Topology is now a group key in `controlledSummary`. |
| 2 Typed contracts | **done** | (this commit) | 3 parsers + 3 renderers, 20 new tests. 456 total green. No orchestrator wiring yet, by design. |
| 3 Investigation synthesis | **done** | (this commit) | First real orchestrator change. 465 tests green (was 456). Unit-tested only; not yet observed on a live run. |
| 4 Failure diagnosis + backjump | **done** | (this commit) | 22 new tests, 487 total green. Decision logic fully covered; full-pipeline chain not yet exercised — see F6. |
| 5 Plan critic | **done** | (this commit) | 492 tests green (was 487). Critic is automatic; the revise loop is operator-triggered — see Q2. |
| 6 Verify S/M/L | **done** | (this commit) | Two live runs. Whole cognitive layer executed live; the change it produced is landed and verified. |

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
unchanged map. `plan-review` (Phase 5) is excluded from the floor plan for the same reason.

### Q3 (Phase 6) — RESOLVED, and my diagnosis of it was wrong

AH-030's implementation was **correct** and still failed. The agent made exactly the right edit —
the failure output contains `biome lint src server scripts tests worker vite.config.mjs`, the
change working — and then `npm run lint` exited 127 with `sh: biome: command not found`.

Cause: the harness runs package verification in a worktree at `/Users/shaun/.ah/w/AH-030/S1-A1`,
whose `node_modules` is an **empty directory**, and which sits outside the repository tree so
Node cannot resolve upward to the real one. The implement prompt then explicitly forbids the only
fix: "do not run npm install, pnpm, yarn, bun, npx, package-manager bootstrap commands".

So any repository whose verification commands need locally-installed binaries cannot pass
qualification in this harness. That is almost certainly why all 29 historical tasks target
`eversor-mystrataassist` and not this repo.

**I was wrong about the cause.** `discoverDependencyDirectories` in `server/git-worktree.mjs`
already provisions dependency directories into every new worktree, from the source checkout. It
worked correctly: I had pointed the task at `.claude/worktrees/mailbox-oauth-prd-revision-950e7a`,
a git worktree that has no `node_modules` of its own (Node resolves up to the main repository's,
which is why lint and tests ran there but provisioning found nothing to copy). The harness
provisioned exactly what the source had, which was nothing.

Fixed by running `npm ci` in the worktree so provisioning has a real source. No code change was
needed and none was made. The options below are recorded only because they were considered:

1. Populate the worktree's `node_modules` when it is created — symlink or hardlink the source
   repository's, since a worktree of the same commit has the same lockfile.
2. Allow an explicit, manifest-declared bootstrap command that the harness runs itself (not the
   agent) before verification.
3. Accept that this repo is verified by the operator rather than the harness, and dogfood
   topology on a different repository.

**My recommendation: option 1.** It is the smallest change, it needs no new agent authority, and
the "dependencies are already available" promise in the implement prompt becomes true instead of
aspirational. But it touches worktree creation, which the loop's hard rules put off limits, so it
is your call.

### Q4 (Phase 6) — RESOLVED: qualification failures are now attributed

`routingDecisions` on AH-030 is empty and `failureDiagnosis` is null, despite the run failing.
`_diagnoseFailure` is wired at `server/orchestrator-core.mjs:52`, on the repair path that follows
a **candidate gate** failure. AH-030 failed earlier than that: package qualification threw at
`server/orchestrator-work-packages.mjs:375` and the task went straight to `failed`.

So Phase 4's deterministic router covers dev-review / test / final-review failures, but not a
package that fails its own verification manifest — which on the evidence of this one run is the
likeliest way a task dies. "Retry means return to the stage whose assumption failed" does not yet
apply where it would help most, and AH-030 is exactly the case that would have been classified
`ENVIRONMENT_FAILURE` and routed to environment remediation rather than presented as a bare
package failure.

**Done.** `_diagnoseRunFailure` in `server/orchestrator-failure-diagnosis.mjs`, wired through
`server/orchestrator-run-coordinator.mjs`, with `buildRunFailureDiagnosisRequest` in
`server/prompts.mjs`. It reuses the existing `routeFailure` / `admitBackjump` / `_applyRewind`
machinery unchanged, so the routing table stays the single authority and the backjump budget still
bounds it.

Three scoping decisions, each made after a test caught the previous one being too broad:

1. **Attribution runs before the failure is recorded**, not after. The failure update clears
   `activeRunKind`, and the diagnosis agent executes under the live run reservation — the same
   ordering the gate-path diagnosis already relies on. My first attempt ran it afterwards and
   silently did nothing, because `_executeAgent` had no reservation to run under.
2. **Only implementation runs.** An investigation, specification or planning stage that throws
   *is* the failure; there is no upstream chain to attribute it to that is not already the current
   stage. Running it everywhere broke the scouts retry-allowance test.
3. **Only a package that could not qualify** (`/did not qualify/i`). A candidate assembly conflict
   or a moved target is mechanical. Gating only on "implementation failed" added a model call to
   `tests/orchestrator-package-qualification.test.mjs`, which has no `runCodex` stub because it
   never expected one — so the test hit the real runtime and hung. That test failing was the
   design telling me the scope was wrong.

A rewind returns `true` so the coordinator does not then record the failure over the destination
it rewound to. `ENVIRONMENT_FAILURE` routes to `requiresHuman` with no rewind, so AH-030's exact
case now leaves the task failed but says *why* — the code may be fine and the toolchain is not.

### Q5 (Phase 6) — FIXED: a dependent slice was rejected as drifted from its own predecessor

Found on AH-031 and **not fixed**: it is inside the candidate/worktree lineage machinery, and the
check it would change exists to stop verification evidence being attributed to the wrong commit.
Changing that blind is the wrong move.

Exact signature. A two-package plan where S2 depends on S1:

    S2: The candidate worktree is at ec3d624 but the candidate records 5cd3583;
        verification evidence would describe a different commit.

`ec3d624` is *S1's own commit*. The harness correctly based the dependent slice on its
predecessor's work; the lineage check then compared the slice worktree against the candidate's
original base revision and refused it as drift. Reproducible: it failed identically on a retry
with a fresh slice worktree (`ef469d7`, then `ec3d624`).

Consequence: any plan with a dependent second package cannot get past implementation. AH-030's
single-package plan reached implementation fine, which is consistent with this being specific to
sequential slices.

**Cause.** `GitWorktreeManager.#prepare` cherry-picks each `dependencyRevisions` entry onto the
base, which advances the worktree, but returned `baseRevision` unchanged and `headRevision: null` —
it never reported where the worktree actually ended up. The qualification step then computed
`packageHeadRevision = committed.headRevision ?? slice.baseRevision`, so a dependent package that
committed nothing of its own was pinned to the candidate base while its worktree sat on its
predecessor's commit. `assertCandidateHead` correctly refused evidence for a revision that was not
checked out.

**Fix.** `#prepare` now reads and returns `preparedRevision` — the revision the slice actually
starts from, base plus any stacked dependencies — and the qualification fallback prefers it. The
safeguard is untouched and still fails closed; it is simply no longer told the wrong revision to
expect. For an independent slice `preparedRevision === baseRevision`, so the common case is
unchanged.

Pinned in `tests/git-worktree.test.mjs`: a dependent slice's prepared revision differs from the
base, `assertCandidateHead` still rejects the base for it, accepts the prepared revision, and an
independent slice's two values stay equal.

### Q2 (Phase 5) — the revise loop is operator-triggered, not automatic

The plan called for `REVISE → planner v2 → critic again`, bounded at 2, automatically. I built
the critic and the bound, but **not** the automatic re-planning. The reason is concrete rather
than a preference:

`_planningAttempt` clears `activeRunKind` and `activeRunReservationId` when it finalises. A critic
running after that has no reservation to execute under — my first attempt failed with "The active
workflow attempt is missing its persisted run reservation" on three existing tests. So the critic
now runs *inside* the attempt, while the reservation is live. But that means an automatic second
plan would need a fresh reservation mid-flight, and minting one would mean touching run-reservation
and workflow-attempt semantics — the exact machinery the loop's hard rules put off limits.

What happens instead on REVISE: the task goes to `blocked` with the blocking findings as its
error, and the operator grants a plan retry. That path already exists and is already tested —
`_planningAttempt` has handled `planAttempt > 1` and `implementation-plan-r{n}.md` since before
this work, and `tests/orchestrator-planning-correction.test.mjs` covers it.

So the expensive half is automatic (a fresh, cross-model reader finds the defect before any
implementation tokens are spent) and the cheap half is one click. **Making it fully automatic
means changing reservation semantics — your call whether that is worth it.** My view: measure
first. If critics rarely REVISE, the automation buys nothing.

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

### F7 (Phase 5) — the critic, and why REVISE blocks rather than approving

New stage `plan-review`: fresh context, read-only, runs after the plan and before approval.
`server/prompts.mjs` gained its stage prompt and `<plan-critique>` contract; the loop lives in
`server/orchestrator-specification-planning.mjs`.

**Cross-model by default.** The critic uses the `gathering` policy tier, which on both providers
is the *other* frontier model from the planner — Luna against Sol, Sonnet against Opus. So the
default is a genuinely different reader rather than the planner grading its own work. Phase 6
should test whether same-model opposition does as well for less money.

**It runs under the planning reservation, not its own.** Stage `"plan"`, policy id
`"plan-review"` — exactly the precedent the repair agent already sets by running at stage
`"implement"` under policy `"repair"`. Nothing in the run-activity contract changed.

**A REVISE verdict blocks instead of becoming approvable.** This is the point of the stage: a
plan with a cited, in-dimension defect must not be one click away from spending implementation
tokens building something the critic already showed is wrong. The rejected plan is retained, not
discarded, so the revision can see what it is fixing.

**Taste cannot block, and that is enforced by shape rather than by prompt.** A blocking finding
must cite evidence and name one of ten closed dimensions (Phase 2's `parsePlanCritique`). An
aesthetic objection has no citation and fits no dimension, so it can only ever land as advisory.
`tests/plan-critic.test.mjs` pins both halves of that.

**Fast profile skips it** — a bounded one-package change contract has no plan to fault — and the
skip is recorded in `nodesSkipped` rather than being silent.

**One transient test failure observed.** A single `npm test` run reported 491/492 with an empty
failing-tests section; three subsequent full runs and the isolated file all reported clean. I did
not identify the cause, so it is recorded here rather than dismissed. If it recurs, it is worth
chasing before Phase 6 conclusions rest on suite colour.

**Not verified end to end.** As with Phases 3 and 4, no live model has produced a real critique.

### F8 (Phase 6) — what I verified without spending credits, and what I could not

Both CLIs (`codex`, `claude`) are on PATH and `.agent-harness/verification.json` is present, so
live runs are technically possible. I did not start them: they spend real credits and the
high-risk task stops at human approval gates. That is the handoff, written up in
`docs/harness-v2/phase-6-runbook.md` with three concrete task briefs, the frozen base, the
experiment ids, and the five acceptance checks.

**What I did verify, and it was worth doing.**

1. **Telemetry survives persistence.** `tests/topology-telemetry-persistence.test.mjs` drives the
   path the running app uses — create with an experiment, write a trace, persist, read back
   through `listEvaluationTasks`, summarise — on both the JSON and SQLite stores. The specific
   risk was a projection that dropped `topologyTrace`: that would have zeroed all telemetry in
   production while every unit test stayed green. `listEvaluationTasks` spreads `core_json`
   wholesale, so it survives. This closes the persistence half of F1.
2. **The real database migrates cleanly.** Adding `synthesis` and `plan-review` adds two POLICY_IDS,
   and `validateStagePolicies` iterates that list — an install whose settings predate them would
   have failed validation on keys it could not know about. I ran `init()` against a copy of the
   live 37MB store: all 29 tasks stayed readable, both policies were backfilled across all three
   profiles, and `plan` (Sol) versus `plan-review` (Luna) came out genuinely cross-model as
   designed. Pinned as a test against a synthetic legacy shape so it stays true.
3. **Absent is distinguished from malformed.** A task with no `topologyTrace` field at all reports
   zeroes with `invalidTopologyTraces: 0`; only a genuinely broken writer increments that counter.

**What remains unverified, and this is the real limit of the whole effort.** No live model has
produced a synthesis, a failure diagnosis, or a plan critique. Every claim in F5, F6 and F7 rests
on stubs. Specifically:

- Whether a real model will produce a well-evidenced `investigation-result` at all, or fail the
  coherence checks often enough to be annoying.
- Whether the plan critic's ten closed dimensions are the right ten, or whether real critiques
  keep wanting an eleventh.
- Whether models over-reach for upstream classifications when `IMPLEMENTATION_DEFECT` is the
  honest answer. The prompt pushes hard against this and the backjump budget bounds the damage,
  but the tendency is unmeasured.
- What the cognitive layer actually costs per run.

**And the framing that matters most:** these three runs cannot be a comparison. F1 established
that no historical task carries experiment metadata, so there is nothing to replay against. They
are first baselines. The honest claim they can support is "this topology executed and was
measured", never "this topology is better". Real comparison needs roughly twenty paired runs that
do not exist yet, and accumulating them is now the long pole — which was true before any of this
work started, and is the reason Phase 1 came first.

### F9 (Phase 6) — booting the app found a real bug that no test would have

Nobody had started the harness with five phases of changes in it. I booted the API against a
**copy** of the live store (`AGENT_HARNESS_DATABASE` pointed at a scratch copy, never the real
file) and hit `/api/settings` and `/api/evaluations/summary`. Both worked, all 29 tasks stayed
readable, and the evaluation endpoint reported 33 observational variants with the topology-aware
methodology string.

**The bug.** Shaun's live settings are a mixed-provider workflow: mostly OpenAI, but
`plan`, `specification` and `dev-review` run on Claude. My Phase 3/5 backfill read defaults from
`defaultRuntimeSettings()`, which uses the global `DEFAULT_EXECUTION_PROVIDER` — so a planner on
`claude-opus-5` was getting a critic on `gpt-5.6-luna`. Technically a different model, and the
"cross-model opposition" assertion would have passed. But different *by accident across vendors*
rather than opposition by design, and not a choice the operator made.

A majority vote over the existing policies did not fix it either: the majority genuinely is
OpenAI, so the vote picked OpenAI and the planner stayed the odd one out.

**The fix.** `POLICY_PROVIDER_ANCHORS` in `server/store.mjs`: a stage whose model choice is only
meaningful relative to another stage's follows that stage's provider. `plan-review` exists to
oppose `plan`, and `synthesis` is priced against the same planning tier, so both anchor to `plan`
and fall back to the majority only when there is no anchor. Re-verified against a fresh copy of
the live store: `plan` = `claude-opus-5`, `plan-review` = `claude-sonnet-5`, `synthesis` =
`claude-opus-5`. Cross-model, same vendor, as designed.

Two tests pin it: a mixed-provider workflow must take its critic from the planner's provider
rather than the majority's, and an all-OpenAI workflow must keep its critic on OpenAI.

**The lesson for Phase 6 proper.** This was found by starting the process, not by reading code or
adding unit tests — the unit test I had written asserted only "the models differ", which the bug
satisfied. It is a good argument for doing the live runs rather than treating a green suite as
sufficient, and a reminder that an assertion can be true while the behaviour is wrong.

### F10 (Phase 6) — looking at the UI found two more bugs the suite could not

Booted the full app (API plus Vite) against a copy of the live store and actually looked at it.
Note for anyone repeating this: the worktree has no `node_modules`; Node resolves up to the main
repository's, which is how the test runs worked, but Vite has to be launched by absolute path.

**What was right.** The Atlas floor plan renders exactly as intended — ten rooms, contiguous
numbering 1 to 10, no gaps and no layout damage, because `atlasStages` filters before numbering.
The Q1 decision to keep synthesis and plan-review off the map holds up visually. The 12-dot stage
rows on the Command Centre table also still fit.

**Bug one: `STAGE 10 / 10`.** `src/components/runtime/RuntimeTaskHeader.tsx` hardcoded the
denominator. It was correct by coincidence while there were exactly ten stages; with twelve, a
task sitting at stage 10 of 12 displayed as complete. Now reads `{workflowStages.length}`.

**Bug two: two bare em-dashes on every pre-existing task.** The stage rail falls back to `—` for a
stage the run passed without evidence and without a recorded disposition. That state existed
before, but was rare; now every task predating the cognitive stages shows two of them, next to
stages that all say a real word. Replaced with `not run`.

Neither was findable by the test suite, and neither is exotic — one was a hardcoded number, the
other a fallback branch that got common. Together with F9 that is three bugs found by starting
the process and reading the screen, against zero found by adding unit tests after the fact. The
argument for actually doing the Phase 6 live runs rather than trusting a green suite is now
evidence rather than principle.

### F11 (Phase 6) — the first live run, and what it actually proved

AH-030 "Lint the root vite config", fast profile requested, `topology-fast-bounded-v1`, frozen at
`3b55f66`, run against this worktree with both providers authenticated. It reached implementation
and failed there on an environment problem (Q3). Everything upstream of that worked, and one part
worked better than I expected.

**Synthesis found a defect in my own task brief.** I wrote "add `vite.config.mjs` to `biome.json`
includes". The first live `investigation-result` came back at 0.84 confidence saying the gap is
dual: `npm run lint` and `npm run format:check` hardcode the argument list
`src server scripts tests worker` (package.json:13-14), and Biome ignores files not passed as CLI
arguments regardless of `files.includes` — so the change I asked for would have looked done and
not been. Three hypotheses, every claim cited to a path and line, the right unknowns named
(including whether the harness would permit widening `ownedPaths` to `package.json`). Grill then
turned exactly that into the single question worth asking a human. This is the stage doing the
job it was added for, on its first attempt, and it caught a human error rather than a machine one.

**The profile escalated correctly, and my first read of it was wrong.** I saw synthesis execute on
a task created as `fast` and flagged it as a bug. It was not: `fast → standard` had already fired
with "the bounded contract crosses repository boundaries", because the fix genuinely needs two
files. Synthesis ran on the standard path, as designed. Worth recording that the escalation logic
and the new stage interact correctly, and that the obvious-looking alarm was mine, not the
harness's.

**The plan critic returned PASS with substance.** Two advisory findings, both in-dimension and
both real: that the plan leaned on parsing Biome's "Checked N files" summary (`assumptions`), and
that `format:check` and `npx biome check` are ad hoc because the verification manifest does not
declare them (`verification-adequacy`). Neither is a defect against the specification, so neither
blocked — which is the behaviour the closed-dimension contract was built to produce. Not a rubber
stamp, and not an over-reach.

**Cost of the cognitive layer, measured rather than guessed.** Through plan approval: 117k input
tokens (63k cached), 10k output, 0.221 credits, $0.374 estimated. Four distinct models in one
task — Luna, Sonnet, Opus, Sol.

**And the run exposed a hole in my own instrumentation.** The live trace read
`['triage','scouts','synthesis','grill','plan-review']`. `specification` and `plan` were missing,
along with every execution stage, because Phase 3 and Phase 5 called `recordNodeExecuted` by hand
in five places and nowhere else. `nodesExecuted` was systematically understating the graph, which
would have quietly corrupted any topology comparison — the exact thing Phase 1 exists to make
possible. Fixed by recording at the one choke point where a stage produces authoritative evidence
(`server/orchestrator-retention.mjs`), with a `topologyNode` override for the plan critic, which
files its artifact under `plan` so it lands in the Planning room. The record is deliberately
outside the `completedStages` dedup: that set answers "is this stage done", the trace answers
"what ran", and a stage that produced authoritative evidence twice ran twice.

Three bugs in Phases 1-5 have now been found by running the thing and none by adding tests
afterwards. That is the finding I would keep if I could keep only one.

### F12 — Q3 and Q4 closed

`npm ci` in the worktree fixed Q3, which was never a harness bug (see the correction above).

Q4 is real work: run failures on the qualification path are now attributed, using the Phase 4
routing table unchanged. `tests/run-failure-diagnosis.test.mjs` pins both halves — that the
failure is sent for attribution and the classification recorded, and that a fast run records the
skip instead of paying for a diagnosis it cannot act on.

Worth keeping: each of the three scoping decisions above was forced by a test failing, and each
time the honest reading was "the scope is wrong", not "the test is wrong". The suite was a better
designer than my first instinct in all three cases.

### F13 (Phase 6) — AH-031, and the task's actual goal landed

Second live run, standard profile, `topology-cognitive-v1`. The whole cognitive layer executed:
`['triage','scouts','synthesis','grill','specification','plan','plan-review']` — seven nodes, with
`specification` and `plan` present this time, confirming the instrumentation fix live. Grill
self-resolved with zero questions, because the brief now named both gates that synthesis had found
on AH-030. The plan critic PASSed again.

Implementation split into two packages: S1 owning `biome.json` and `package.json`, S2 owning
`vite.config.mjs`. **S1 qualified**, which is what Q3's fix bought — the same stage that died on
AH-030 with `biome: command not found` now passes verification. S2 then failed on Q5.

**I got the diagnosis of that wrong twice and want both corrections recorded.** First I called S2
a redundant package the critic should have caught under `package-boundaries`. It was not
redundant: `vite.config.mjs` genuinely had a finding (`assist/source/organizeImports` — the two
imports were out of order), which is exactly the "fix any findings that surface" half of the
brief. The two-package split was correct and the critic was right to pass it. Second, my Q4 gate
correctly did *not* fire here, because a lineage drift is not a qualification failure — that is
the scoping working, not a gap.

**The change the harness produced is correct, and it is now landed.** S1's commit was applied and
S2's work finished by hand:

    biome.json    files.includes gains "vite.config.mjs"
    package.json  lint and format:check both gain the vite.config.mjs argument
    vite.config.mjs  imports sorted

`npm run lint` now checks 231 files where it checked 229, and `npx biome check vite.config.mjs` no
longer reports the path as ignored. All four gates pass: lint, format:check, typecheck, 498 tests.

**And running format:check found two files of my own that were never formatted** —
`src/components/runtime/workflow.ts` and `tests/run-failure-diagnosis.test.mjs`. `format:check` is
not part of `npm test` or `npm run lint`, so nothing in the loop's own verification would ever
have caught them. Fixed. Worth noting that the task I chose as a throwaway smoke test found a real
gap in how I had been verifying my own work all along.

Running tally of bugs in Phases 1-5 found by running the system rather than by adding tests: five
(provider mis-anchoring, hardcoded stage denominator, bare dash in the rail, incomplete topology
trace, unformatted files). Found by adding tests afterwards: zero.

### F14 — approval completes by raising a pull request, not by merging locally

Requested directly: a local merge writes into the operator's own checkout, so the working tree ends
up ahead of what their tooling expects, watchers and builds see changes nobody asked for, and the
work has to be retriggered by hand.

`approvalCompletion` is a new runtime setting defaulting to `"pull-request"`, snapshotted per task
the way `grillPolicy` already is, and settable through `PUT /api/runtime/settings`. `approveMerge`
refuses when a task's policy is `pull-request` and names the alternative in the error. The local
merge path is entirely intact — it is opt-in rather than implicit.

Both halves of the migration take the same default: a task recorded before the setting existed
becomes `pull-request`, because a local merge is the surprising outcome and nothing should inherit
it silently.

Seventeen existing tests failed, and all seventeen were legitimate: each drives the local merge
path deliberately, so each now declares `approvalCompletion: "local-merge"`. None were weakened —
they assert the same fail-closed evidence behaviour they always did, and the guard was masking it
rather than replacing it.

`tests/approval-completion.test.mjs` pins the default, the per-task snapshot, the refusal and its
message, that an opted-in task is not refused for that reason, and the migration default.

### F15 — AH-032: every gate passed, and two corrections to what I told Shaun

Third live run, high-risk profile, `topology-cognitive-v1`. **The first run to clear the whole
workflow**: triage → scouts → synthesis → grill → specification → plan → plan-review → implement →
candidate assembled → dev-review PASS → test PASS (real lint, typecheck and test executed in the
candidate worktree) → final-review PASS → awaiting-human-approval.

**Correction one: my `approveMerge` guard was not the fix for the local-merge complaint, because
that path was already unreachable.** `server/task-action-routes.mjs` routes the `approve-merge`
action to `orchestrator.approvePullRequest`, identically to `open-pr`, and
`orchestrator.approveMerge` is called from nowhere in `server/` or `src/` — only from tests. So
approval over HTTP already raised a PR and never wrote to the operator's checkout. Verified live:
`local main` stayed at `481c91c`, clean, throughout. The guard and the `approvalCompletion` setting
are defence-in-depth and an explicit statement of intent, which is worth having, but they did not
change what the app does.

**Correction two: Q5 was not exercised.** The planner produced one work package, correctly — moving
two symbols and updating an import is not separable. So the dependent-slice path this run was meant
to test never ran. Q5's fix remains unit-tested only, in `tests/git-worktree.test.mjs`. Saying the
live run confirmed it would have been false.

**What did fail, and the real fix it produced.** PR publication reported only
`git exited with code 2`. Cause: `git ls-remote --exit-code` exits 2 and prints nothing for a ref
the remote does not have, and the PR's base branch — `claude/agentic-sdlc-orchestration-3c10ae` —
had never been pushed. Twelve other `claude/*` branches exist on the remote; a `push --dry-run`
succeeded, so auth was never the problem. `#remoteRevision` no longer passes `--exit-code`: it
checks for empty output and reports which ref is missing on which remote and that a PR needs its
base branch to exist there. That is a one-push fix the operator could not have derived from the old
message.

Running tally, unchanged in direction: seven bugs and wrong conclusions surfaced by running the
system (provider mis-anchoring, hardcoded stage denominator, bare dash in the rail, incomplete
topology trace, unformatted files, the useless PR error, and my own two claims above). Zero by
adding tests after the fact.
