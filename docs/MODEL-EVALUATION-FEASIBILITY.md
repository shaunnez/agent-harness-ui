# Quality-first feasibility results — 22 September 2026

The balanced policy has produced a candidate that passes the complete workflow and independent acceptance. A harness defect required an evaluator restart at Dev Review, so this is diagnostic success, not a clean autonomous benchmark pass. A fresh frozen trial is required before comparing policies or promoting defaults.

## Fixed delivery configuration

- Luna High: triage and selected scouts. Sol High: Grill, specification, Plan, Dev Review and Final Review. Sonnet 5 High: Implement and Repair. Luna Medium: Test narrative.
- Two hours per task, 30M measured tokens including cache reads, one hour per Implement/Repair call. Existing other stage timeouts and 24-agent-run/40-provider-call limits retained. No model escalation.
- H02, a medium UI/API/SQLite Grill-policy change, under high-risk assurance. Historical base `4b303a8da4fafd7a78149ddad40cbf714411d08b`; same public contract and graders throughout. The runner is rebased on main `3878a24`; this does not replace the historical case base.
- No manual candidate edits, PR publication, production default changes or separately billed API fallback.

## Observed outcomes

| Campaign | Result | Recorded delivery tokens | Explanation |
| --- | --- | ---: | --- |
| feasibility-v1 | Invalid | At least 5,440,742 | MacBook slept 21 seconds after S2 started; one interrupted call has unknown usage. |
| feasibility-v2 | Failed | 5,079,377 | Plan omitted a coupled fixture; ownership enforcement refused the implementation. Limits were not exhausted. |
| feasibility-v3 original | Invalid | 26,899,370 | One package passed all commands and assembled a candidate. Frozen commit authority was incorrectly treated as a Git branch/ref at Dev Review. |
| v3 diagnostic continuation, cumulative | Independently accepted candidate; diagnostic only | 29,802,410 | One automatic repair, then fresh review/Test/final gates, nine independent checks and blinded rubric all passed. |

The diagnostic total includes the original v3 delivery; do not add those rows together. All 16 cumulative provider calls settled with known usage. External grading used another 152,371 tokens, recorded separately. The approximately 51-minute wall time includes the evaluator interruption. The original absolute deadline and allowance were never reset.

Implementation alone took 18m26s, beyond the former 15-minute limit. Larger limits demonstrably allowed useful progress, but limits were not the only problem: coupled-path planning and frozen-target review admission also needed correction.

## Corrections and verification

Generic Plan guidance now requires tracing type/schema/interface changes through constructors, callers, adapters, mocks and fixtures; tightly coupled changes belong in one independently qualifying package. No case-specific solution paths were supplied. The new plan included the omitted fixture and produced one coherent package.

`GitWorktreeManager.mergeState` now resolves an exact recorded `commit:<SHA>` base for read-only gate admission. Malformed/mismatched/missing authority and candidate drift still fail; immutable experiment targets remain ineligible for merging. A real-Git regression failed before the fix and passed afterwards. The source passed 38 focused tests, 762 core tests, lint, formatting, typecheck, build, Sites and manifest checks. Earlier rebased frontend qualification passed 164 Frontier and 18 Frontier API checks; subsequent changes did not touch frontend code.

The accepted diagnostic candidate is `65f02c6786574a476ce0b33733167919cf67abc3`, C1 revision 2. Sol review found that null legacy completion attribution escaped migration; ordinary Sonnet repair fixed it and added regression coverage. The exact repaired candidate passed lint, types, 387 tests, build, four Sites checks, fresh Sol development/final review, nine independent behavior checks including real browser persistence, and the blind external rubric. No evaluator edited candidate code.

## Next gate

Run one fresh trial from the corrected frozen harness with unchanged models, limits, task and graders. Require independent acceptance before widening the comparison. The preceding runs are development diagnostics; they do not establish a policy winner or cross-project success rate.

PlanCheck P04 remains blocked by seven existing mypy errors at its historical base. MyStrataAssist M01 has qualified frontend behavior but incomplete full backend/E2E/environment/grader qualification. Neither project has received a live model trial. Full exact-base preflight is mandatory before either is dispatched.

Private evidence: `/Users/shaun/.codex/model-evaluation/20260922/feasibility-v3/F1/diagnostic-continuation/`. Original invalid receipts, SQLite backup and initial candidate are retained separately. No production state or original working tree was changed.
