# Evidence-backed follow-up work

Prioritized from the completed Batch A: 0 accepted candidates in 9 trials. These are concrete issue proposals, not implemented production changes or published tracker issues. Address items 1–3 before another ranking campaign; item 4 remains a separate, lower-confidence context improvement. All paths refer to frozen harness `543d51c`.

## 1. Recover one eligible implementation-package defect before candidate assembly

**Problem.** A1 committed its first slice, then TypeScript rejected removal of a union member still used by a later package. No integrated candidate existed, so the candidate repair loop could not run. The workflow stopped despite remaining time/tokens. A3 instead changed an unowned test-registration file and correctly stopped. More reasoning alone does not make the missing recovery transition exist.

**Small change.** Add an explicit bounded package-recovery policy using existing reservations, retained slices and attempt accounting. Initially one retry under the same model policy, with the exact failed command and candidate diff. Keep failures typed: implementation defect, ownership/plan correction required, repository baseline, environment/provider failure, or missing decision. Do not derive authority from free-form model prose alone.

**Acceptance.** A committed, clean failed slice can receive a corrective model attempt; it must not merely re-run the same failing verification. A dirty interrupted slice retains its existing continuation semantics. Qualified siblings remain intact. Every attempt/usage/error is retained and counts toward the same trial. A second failure stops. Baseline/environment/missing-decision failures never invoke code repair. Ownership violations never gain paths automatically; plan correction is separately validated. Concurrent resume and restart cannot double-dispatch. Revised candidates invalidate downstream gates exactly as today.

**Files.** server/orchestrator-work-packages.mjs, orchestrator-task-control.mjs, orchestrator-retained-package.mjs, package-qualification-policy.mjs and existing reservation/effective-policy helpers. Reuse the existing manual plan-correction and retained-requalification paths; do not replace them or introduce a second scheduler.

**Verification.** Deterministic fake-provider integration tests for clean failed commit -> one correction -> qualification; failed correction -> stop; ownership refusal; baseline failure; duplicate reservation; restart; preserved sibling. Then a new frozen matched H02 campaign. This is a workflow challenger, not retroactive rescue of A1/A3.

## 2. Make package boundaries account for compatibility and test registration

**Problem.** A1 separated a type change from a caller that still needed the old member. A3 planned a new test but excluded package.json, whose explicit npm-test file list required registration. A7 also edited an unowned typed preview fixture while adding a required field, despite remaining within its budget. Existing Plan instructions already require independently qualifying packages and owned tests; repeating that general instruction is insufficient.

**Small change.** Include the concrete resolved verification entry points in planning context. Require a plan to include registration/configuration paths when tests need them, or use an existing test file. Keep type/caller changes compatible across dependency boundaries, or combine coupled work. Do not mechanically force every task into one package or weaken final checks.

**Acceptance.** Golden plan fixtures expose explicit test lists, type/caller coupling and truly independent packages. Correct plans preserve necessary parallelism, declare registration ownership, and pass a deterministic executable-plan check. Semantic compatibility remains a model responsibility checked by real qualification; no string-matching promise should be described as proof that a plan works.

**Verification.** Replay the retained planning inputs under a separately versioned prompt/context treatment, then matched whole-workflow trials. The planner role's contribution is not identified by the current whole-policy failures.

## 3. Calibrate the delivery allowance before another model comparison

**Problem.** The 5M allowance includes cache reads and is checked at dispatch boundaries. A2 consumed 10.80M after a single 7.51M in-flight call and qualified two slices; A4/A5 qualified one slice before exceeding 5M; A9 qualified two and consumed 9.43M. Equal raw tokens are a reproducible constraint, but not equal dollars, compute or subscription credits across providers. This cap can dominate the answer to a model-selection question.

A8 also hit the existing 900-second implementation-stage timeout. Its interrupted usage remains unknown; increasing only the total-task limit would not change that stage limit.

**Small change.** Keep Batch A's outcomes intact. For the next campaign use a non-ranking feasibility run to establish achievable total-task and per-stage wall/attempt allowances and a conservative runaway token guard across participating providers. Record uncached input, cache reads/writes and output separately. Use verified API-equivalent prices only where complete; do not invent an Astra rate or infer account billing. Distinguish in-flight overshoot from a hard cap in product/report copy.

**Acceptance.** Preflight declares the exact accounting unit, enforcement boundary, overshoot behavior, unknown-usage handling and equal per-trial ceilings. Failures remain in accepted-delivery denominator. No cap is changed after observing a comparison arm. A provider that cannot report usage or support interruption is explicitly bounded by the available controls and stops before another dispatch.

## 4. Protect critical specification fields from truncation (lower priority)

**Observation.** A2's 8,567-character specification was cut to 8,000 for planning. The omitted tail included implementation guidance, while the complete public task contract remained present. This is not an established cause of its failure.

**Small change.** Preserve complete structured acceptance/interface/decision fields; budget optional narrative separately. Keep the existing context manifest honest about truncation. Qualify with a long-spec fixture and matched stage replay before claiming improved delivery.

## Escalation experiment after recovery works

Compare fixed recovery with a snapshotted escalation policy on the same cases, triggers and total allowance. For a concrete implementation defect, pass the failed evidence and optionally advance to the next supported effort or a designated stronger permitted model. Transport retries stay on the same policy; environment/permission/product-decision blocks stop. First-pass acceptance remains failed even if escalation succeeds. All attempts count in eventual acceptance/time/resources. Explicit role pins and provider constraints remain enforceable. No automatic strongest-model fallback for every error.
