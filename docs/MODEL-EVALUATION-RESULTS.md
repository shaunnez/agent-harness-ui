# Model-policy evaluation — 22 September 2026

Status: Batch A delivery complete. No production policy has changed. Results are bound to the frozen batch-a-v4 receipts; see the scoring-audit note below.

Latest continuation: [the fresh blind review closeout](MODEL-EVALUATION-BLIND-REVIEW.md) records a confirmed automatic-answer context defect. Its review exceeded the frozen grading allowance; the raw verdict rejected the candidate and formal acceptance remains ungraded. The historical Batch A scores below are unchanged.

## Decision

A reliable autonomous workflow must reach a candidate suitable for human PR review, pass the original acceptance criteria and regression commands, and do so within its declared allowance without evaluator repair. A green implementation slice, passing model self-review or a low token price is insufficient.

**Retain the incumbent configuration; do not promote a challenger or launch Batch B.** All three policies delivered zero accepted candidates in three attempts. None reached integrated-candidate review or Test, so this campaign cannot compare their downstream review, repair or test-narration quality. A failed feasibility screen is a useful result, but it is not a model league table. The comparison covers one medium cross-layer Harness task under high-risk assurance; it cannot qualify small/hard tasks or either other repository.

## What ran

Nine fixed-policy delivery slots, three repeats each, rotated order. Same public brief, pre-fix revision, frozen answers, acceptance contract, five-command manifest and isolated environment. Policies pin every role; ordinary candidate repair allowance remains, capability escalation is disabled for this first comparison. One trial and one implementation package at a time.

- Incumbent high-risk: Luna XHigh triage/scouts/Grill/implement/repair/Test; Sol High specification/Dev Review/Final Review; Sol XHigh Plan.
- Balanced: Luna High triage/scouts; Sol High Grill/specification/Plan/Dev Review/Final Review; Sonnet 5 High implement/repair; Luna Medium Test narration.
- Astra-plan: balanced, changing only Plan to Astra High.

Per trial: 30 minutes, 5 million measured tokens including cached input, 24 agent runs, 40 provider invocations. The existing per-implementation-call limit is 15 minutes. No new call after an exhausted allowance; an in-flight call can overshoot. Independent grading has its own bounded allowance. These are resource constraints, not an attributable subscription charge.

| Policy | First-pass accepted | Eventual accepted | Total delivery time | Measured tokens (including cache reads) |
| --- | ---: | ---: | ---: | ---: |
| Incumbent | 0/3 | 0/3 | 71m 27s | At least 8,721,635; incomplete |
| Balanced | 0/3 | 0/3 | 59m 48s | 25,628,376 |
| Astra Plan | 0/3 | 0/3 | 41m 14s | 15,024,013 |

| Trial | Policy | Time | Tokens | Outcome |
| --- | --- | ---: | ---: | --- |
| A1 | Incumbent | 17m 44s | 1,985,477 | Type/caller compatibility failure; qualified slices: none |
| A2 | Balanced | 20m 06s | 10,797,172 | Token allowance exhausted; qualified slices: S1, S2 |
| A3 | Astra Plan | 14m 26s | 5,338,072 | Changed an unowned path; also over budget; qualified slices: none |
| A4 | Balanced | 15m 53s | 5,398,319 | Token allowance exhausted; qualified slices: S1 |
| A5 | Astra Plan | 15m 31s | 5,485,610 | Token allowance exhausted; qualified slices: S1 |
| A6 | Incumbent | 26m 53s | 5,947,861 | Token allowance exhausted; qualified slices: S1, S2 |
| A7 | Astra Plan | 11m 17s | 4,200,331 | Changed an unowned path; qualified slices: none |
| A8 | Incumbent | 26m 50s | At least 788,297; incomplete | Implementation hit its 15-minute limit; qualified slices: none |
| A9 | Balanced | 23m 49s | 9,432,885 | Token allowance exhausted; qualified slices: S1, S2 |

Batch A used **at least 49,374,024 measured tokens**, including 46,102,894 cache-read tokens, across 78 provider invocations (including adapter probes). One interrupted call has unknown usage. Total observed delivery time was 2h 52m 30s. There was no evaluator code rescue and no policy drift. Six trials exceeded the declared token budget; all failures remain in the delivery denominator. No accepted deliveries means no measurable resources per acceptance.

## What the evidence means

The evaluated system includes the models, prompts, context, package decomposition, native tools and recovery transitions. Whole-policy differences do not isolate individual roles. Balanced versus Astra-plan isolates the planning-model assignment under this one fixed policy, but does not establish universal model capability from three repetitions.

Observed mechanisms include an incompatible type/caller split, unowned test-registration or typed-fixture changes, an implementation-stage timeout, and calls exhausting a raw-token allowance dominated by cached context. Qualified partial packages remain failures of autonomous delivery. I chose an allowance that proved too restrictive for establishing the quality-first baseline we wanted. That experimental design limitation is mine; it is not evidence that the models cannot complete the task with a feasible allowance. The allowance still defines a valid constrained-delivery result. Never silently reclassify them as invalid setup or pool results with a changed cap.

Several planning inputs truncated their specification narrative at 8,000 characters. The complete public task contract remained supplied, so omitted narrative is not established as the cause of these failures. Local evaluator preparation shared this machine during several runs; wall times are observed end-to-end delivery, not isolated model latency.

No observed production dollar charges are available. CLI and bundled API-equivalent Sonnet rate cards differ, Astra has no complete verified bundled rate, and token-derived work credits are estimates. Therefore no complete dollar/credit ranking is defensible. With no accepted deliveries, resources per acceptance are unavailable, never zero.

## Baseline and next experiment

Retain the current production configuration pending evidence; retention is not qualification. The proposed balanced matrix remains a testable engineering starting point, not an earned winner. Keep capable reasoning on specification/planning/review, bounded fact gathering on Luna, and Test narration cheap because the harness executes its verification deterministically. Do not add Astra everywhere or infer that its faster plan makes a whole task better.

First qualify bounded pre-candidate package recovery and correct ownership of coupled changes/test registration. Calibrate achievable total-task and per-stage allowances across providers in a non-ranking feasibility run. Then freeze a new small matched comparison, followed by untouched held-out cases only if it produces accepted delivery. Test model/effort changes one role at a time once the workflow is reliable. New Opus/Terra/open-source models enter through the same candidate qualification and provider-confinement gate.

Retry escalation is measurable: freeze the failure class, supported effort/model ladder, total attempts and total allowance. A concrete code defect can receive failed-test evidence and a bounded capability increase after the missing package-recovery transition exists; a broken environment or missing product decision cannot. Include all retries in eventual acceptance/resources; retain the initial first-pass failure.

## Reusable cases and continuous learning

Twelve historical cases are selected, six development and six untouched held out, spanning all three repositories and small/medium/hard work. Four separate readiness/routing controls are selected. Selection is not qualification.

H02 has nine independent UI/API/SQLite checks, a failing base, passing reviewed reference, rejected seeded mutant and calibrated blind external Sol review. It is the only live-qualified campaign case.

H01 has 9 independent checks, actual Settings behavior and complete command baseline qualification: base 3/9, reference 9/9, mutant 3/9; reference 309 existing tests pass. The base's sole existing failed test describes this exact defect and must be explicitly declared fail-to-pass in a future case-aware preflight.

M01 has 6 independent calendar-model checks, actual browser confirmation and passing frontend baselines; full repository/backend/E2E runner qualification remains. P04 has 10 independent PostgreSQL/deadline checks, passing full backend test baselines and three rejected mutants; seven pre-existing mypy errors still block delivery-baseline qualification. No model-policy claim for either repository is supported yet.

For actual tasks, retain the selected/effective policy, exact base/candidate, attempts, check outcomes, human interventions, PR-review corrections and escaped defects. Turn reviewed failures into anonymized synthetic replay cases. Historical traffic is useful for finding cases and feasibility limits; its mixed task difficulty cannot automatically rank models or promote a policy. Keep promotion reviewed and versioned; a model update reruns the same frozen cases against the current champion.

## Tooling and evidence

The implementation preserves early failures in delivery denominators, rejects policy drift and changed verification definitions, binds independent grades to exact candidate identity, and retains invalid/pending/ungraded outcomes and unknown usage. Native provider confinement and actual generated permission profiles were qualified. No API-key fallback, production DB changes, PR publication, merge or deployment occurred.

The final scorer audit also requires a completed delivery boundary and fresh authoritative review/Test/final-review gates. Preserve the original frozen scorer report beside the corrected replay; never replace unsuccessful delivery attempts with manually repaired code.

Frozen delivery harness: `543d51c743432ec8326f8ad072b28d6d3ff57832`. Corrected receipt-only scoring: `2c4b9e1845bedd9476822fbe56608ce10bc11fe3` (`workflow-boundary-and-sha-v1`). All nine outcomes are identical before and after correction; no provider calls were rerun. The original `report-frozen-543d51c.json`, corrected `report-corrected-v1.json`, hashes and audit are retained under the private campaign directory.

Final local verification: **761/761 repository tests**, **51/51 focused evaluation tests**, lint, format check, TypeScript, production build and **4/4 Sites tests** passed. The build produced all three expected Sites artifacts. Earlier Frontier API qualification passed 18/18; no remote CI or deployment was run.

Instrumented preparation and all campaigns together recorded at least 51,789,171 tokens across 99 invocations, four with unknown usage. This excludes the authoring conversation and unrelated account activity. Earlier v1/v2 apparatus failures, v3 budget failure/cancelled slots and unsuccessful grader calibrations remain separate, never pooled into Batch A. All recorded calls have ended.

Private receipts: `/Users/shaun/.codex/model-evaluation/20260922`. Public aggregate: [batch-a-v4-summary.json](../evaluations/results/batch-a-v4-summary.json). Each trial retains its frozen input, task/store, all-attempt usage ledger, stage/package summaries, error, and available base-to-slice diff. References and private grading evidence are not committed or exposed to trial agents.

Next work is specified in [MODEL-EVALUATION-FOLLOW-UPS.md](MODEL-EVALUATION-FOLLOW-UPS.md). Runner scope and repeat commands are in [evaluations/README.md](../evaluations/README.md).
