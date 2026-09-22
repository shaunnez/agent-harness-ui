# Model evaluation continuation after H02 v7

**Current continuation:** [MODEL-EVALUATION-CODEX-COMPARISON.md](MODEL-EVALUATION-CODEX-COMPARISON.md) supersedes the old single-trial plan. After compaction, run the agreed two parallel H05 trials using Codex only: Sol High versus Luna High for Implement/Repair. Use Sol to coordinate. The separate retained-package failure-routing follow-up is not a prerequisite. No new model run was launched while writing the handoff. The original plan below is retained as history.

Updated 22 September 2026. Read this before older execution briefs. **No evaluation worker or reviewer is running.** This handoff prepares the next unit; it does not authorize a new paid campaign merely by being read.

## Latest decisions and scope

- Shaun deferred the Final Review improvement. Linear [ENG-977](https://linear.app/eversor-ai/issue/ENG-977/harness-make-final-review-assess-acceptance-independently-of-earlier) is assigned to Shaun Nesbitt, Medium priority, Engineering Backlog. No dedicated Harness Linear project was found; the ticket is explicitly prefixed Harness and links the repository. Do not create a duplicate or start that ticket while continuing evaluations.
- The recommendation to use retained H02 as a repair exercise is also parked for this handoff, pending clarification of Shaun's wording. An optional question asked whether to park both or keep repair first. In the absence of a contrary reply, progress with preparation of different cases. Repair rehearsal is not a prerequisite for zero-inference case qualification.
- Do not rerun all of H02, change reviewer prompts, promote a model policy, or add a permanent external reviewer as part of this continuation.
- The next proposed evaluation is a small reliability baseline across different tasks using the same balanced model grouping. Model comparisons, harder cases and retry escalation come afterward. No new paid trial was launched or authorized by the ticket/compaction request.

## What H02 established

The harness delivered candidate C1 in 36m40.552s on the first package attempt. Dev Review, Test and Final Review passed; 385 repository tests and four Sites tests passed. No repairs occurred. Both internal review roles and the independent evaluator used Sol High; implementation used Sonnet 5 High.

The original independent checker reported 9/11 because it demanded raw provenance enum text in prompts. A qualified h02-v5 correction accepted equivalent truthful readable labels and added provenance counterfactuals. The unchanged candidate passed 11/11; the one subsequent blind reviewer rejected a Settings save-scope defect. A browser diagnostic confirmed that selecting automatic Grill and clicking only Save model policy persisted the unsaved Grill choice. This is a localized candidate defect, with P1 severity considered aggressive in the subsequent architectural discussion. Current Frontier impact was not established. Preserve the recorded result rather than retroactively changing severity or marking the candidate accepted.

Twelve delivery provider invocations consumed 46,256,929 tokens, including 45,397,607 cached input. One independent review consumed 608,781 tokens. Every call settled with known usage, and both phases remained within allowance. The task reached human approval but was never published or merged. The external evaluator's finding was not fed back into delivery.

- Full result: [MODEL-EVALUATION-H02-V7.md](MODEL-EVALUATION-H02-V7.md).
- Private current pointer: `/Users/shaun/.codex/model-evaluation/20260922/CURRENT.md`.
- Private evidence: `/Users/shaun/.codex/model-evaluation/20260922/feasibility-v7b`, especially `closeout.json`, `adjudicated-report.json` and `grader-correction.json`.
- Candidate, clean and unchanged: `/private/tmp/h-eval-f7b/F1/w/AH-001/C1`, SHA `8fe118daa8a58628cda006b5b4154a90b58b17a1`.
- Original v4 task/report/freeze/check receipts and all earlier candidates remain retained. Do not overwrite them, restart their workers, or clean temporary evidence directories.

## Checkout and merge state

Canonical evaluation source is `/Users/shaun/.codex/worktrees/model-evaluation/agent-harness-ui`, branch `codex/model-evaluation-h02-v7`. H02 delivery used source `1ff36d39ab4d1753e7ca141ebb947c1696694705`; grader correction is `8fa39c089d3e80773c9375872fbe458b97bb5e7a`; initial closeout is `0b6d3b9b0d07ec67e532aec0eb1fb77abf235e00`. Later commits only maintain this handoff. Source/evaluator work is local, not pushed as a new PR.

PR #123 is merged at `19c9d3ef3e53db7625d1d76833cca2eeb6a024a3`. Its final change handles repository-baseline block recovery through plan revalidation; it does not alter review prompts or model policies. `origin/main` was fetched at that merge, while the original main checkout still showed `a4dba424` when inspected. Do not treat the merged PR as proof a user runtime has restarted. Do not reopen work on the old PR #123 review; another agent owned it.

Before qualification, refresh Git/worktree/process state. Preserve the completed evaluation branch and create a new source branch for reconciling with latest main, including PR #123. Rebase or otherwise reconcile deliberately, inspect conflicts, and run affected tests plus required harness checks. Preserve the original user checkout and services. Read repository/directory AGENTS.md for each project.

## Next proposed cases

Prepare serially, starting with M01. All are development cases; leave held-out cases untouched. These are existing reviewed-change replays, not invented product requirements. Exact briefs, base/reference SHAs and acceptance criteria live in `evaluations/cases/delivery-v1.json`.

| Order | Case | What it exercises | Readiness limits |
| --- | --- | --- | --- |
| 1 | M01, MyStrataAssist: keep overdue manager tasks on their real due dates | Small UI/date behavior; preserve separate obligation behavior | Six independent behavior checks and frontend qualification exist historically. Complete backend/OpenAPI/E2E/environment checks and runner/grader integration remain. |
| 2 | P03, PlanCheck: preserve quantity and allowance provenance on edits | Medium UI/backend/persistence behavior and regression safety | Selected but not yet qualified. Establish complete exact-base/reference checks and independent acceptance before inference. |
| 3 | H01, Harness: show configured but undiscovered models | Small catalog/UI compatibility behavior | Existing independent/browser qualification exists, but its historical baseline has a known target-defect assertion failing. Current runner admission may not support an explicit fail-to-pass test. Do not waive this or attribute it to an agent. Resolve qualification before freezing, or choose an equivalent reviewed small Harness case with a green baseline; do not build a broad new framework just to admit H01. |

The goal is three different tasks, one trial each, with one policy. This is a readiness baseline, not a reliable population pass-rate estimate or model ranking. Prefer one completed, graded trial before authorizing/preparing subsequent paid slots. An unrelated baseline failure blocks dispatch for that case. Retain its evidence and report it; do not spend models diagnosing pre-existing lint/type/environment failures.

P04 is not the next PlanCheck case: its earlier preparation was blocked by seven pre-existing mypy errors. Passing thousands of tests did not resolve that gate. Do not quietly substitute it.

## Preparation sequence and stop conditions

1. Inspect each exact historical base in an isolated checkout. Read the project's real verification contract and provision synthetic dependencies/databases/ports. Never use customer snapshots or production services. Existing check results are historical, not fresh permission to dispatch.
2. Run all required lint, formatting, types, tests, build and relevant environment checks. Separate any deliberately specified task-failing assertions from regression health; no unexplained baseline failure is acceptable.
3. Qualify independent acceptance against the starting code, a valid reference and a meaningful defective control. Include actual UI interaction/persistence where applicable. Ensure grader assertions accept legitimate implementation choices and distinguish a blocking requirement failure from cosmetic suggestions. Record exact hashes before delivery.
4. Adapt only the small runner/grader boundaries needed for the selected case. `prepare-case.mjs` can prepare cases, but current `prepare-batch.mjs` and `finalize-trial.mjs` are H02-specific. **Do not substitute a different case ID and assume they become generic.** Keep reference fixes, private graders, later Git history and previous candidates inaccessible to providers.
5. Freeze the task contract, permitted answer sheet, case/runner/grader/rubric versions, workflow profile, model matrix, repair limits and allowances. Preserve complete acceptance requirements. Use the actual eligible workflow depth for each task; do not force every small case through high-risk orchestration or silently vary depth between repeat/comparison arms.
6. End preparation with concrete case-readiness receipts and a proposed single next trial. Do not invoke a provider while preparing this handoff or from an ambiguous continuation. A clear instruction to run the prepared trial authorizes dispatch once all gates are satisfied.
7. For an authorized trial, run serially, finish independent acceptance, retain every failed attempt and stop on apparatus uncertainty or unknown active usage. Do not automatically repeat or substitute models. No benchmark PR, merge or deployment.

## Policy and allowances to carry forward

Retain the H02 balanced assignment as a provisional baseline, pinned explicitly on evaluation tasks rather than inferred from mutable production Settings:

| Role | Model / reasoning |
| --- | --- |
| Triage / selected scouts | Luna High |
| Grill / Specification / Plan | Sol High |
| Implement / Repair | Sonnet 5 High |
| Dev Review / Final Review, when model-owned | Sol High |
| Test narrative | Luna Medium |

Keep generous proposed per-trial safeguards: two-hour delivery, 200M total tokens including cached input, one hour per model call; at most one independent blind review if deterministic acceptance passes, separately one hour/30M tokens. Freeze an explicit profile and its numeric package/candidate repair limits. H02 used two package corrections and three shared high-risk candidate repairs; its ten model-stage runs and zero repairs are evidence, not mandatory workflow depth for small cases.

These inherited numbers are a proposed configuration, not authorization for three new paid tasks or an aggregate usage target. Do not reinstate the old 5M/30M delivery or 200k review caps accidentally. Check Claude/Codex availability before dispatch; no silent provider substitution. Retain input, cached input, output and wall time separately, with actual billing unavailable.

## What to measure and decide

For each case record first-attempt result, eventual result after permitted repairs, independent requirement failures, defect severity, time to approval-ready candidate, all-call token/cache usage, and whether intervention was needed. Show workflow completion, deterministic acceptance and blind review separately; a small UX defect must not be described as a crashed harness, and a full test pass must not imply complete behavior coverage.

After different cases work, repeat selected cases under the same frozen setup to assess variability. Only then compare one deliberate policy change on matched cases (for example a cheaper Implement model or stronger planning on difficult work). Do not change models, review prompts and test infrastructure simultaneously and attribute the result to one of them.

## Copyable continuation

Continue from `docs/MODEL-EVALUATION-PREPARATION.md` in `/Users/shaun/.codex/worktrees/model-evaluation/agent-harness-ui`. Preserve the completed preparation and closed H02 evidence. Confirm the other agent's retained-package failure-routing fix is merged, rebase and requalify the preparation branch. H05 is the proposed next single trial; M01/P03 are baseline-blocked. Do not dispatch a model run, restart H02, publish a PR, merge or deploy merely by reading this handoff.
