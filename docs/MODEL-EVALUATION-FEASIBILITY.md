# Quality-first feasibility results — 22 September 2026

The balanced policy has produced a candidate that passes the complete workflow and independent acceptance. A harness defect required an evaluator restart at Dev Review, so this is diagnostic success, not a clean autonomous benchmark pass. The fresh frozen trial subsequently completed autonomously, but its blind reviewer rejected a missing downstream context handoff. The review exceeded its allowance and is formally ungraded; a zero-inference diagnostic independently confirms the blocking defect. See [the blind review closeout](MODEL-EVALUATION-BLIND-REVIEW.md).

## Fixed delivery configuration

- Luna High: triage and selected scouts. Sol High: Grill, specification, Plan, Dev Review and Final Review. Sonnet 5 High: Implement and Repair. Luna Medium: Test narrative.
- Two hours per task, 30M measured tokens including cache reads, one hour per Implement/Repair call. Existing other stage timeouts and 24-agent-run/40-provider-call limits retained. No model escalation.
- H02, a medium UI/API/SQLite Grill-policy change, under high-risk assurance. Historical base `4b303a8da4fafd7a78149ddad40cbf714411d08b`; same public contract throughout; the original behavior checker and its explicitly versioned correction remain separate. The runner is rebased on main `3878a24`; this does not replace the historical case base.
- No manual candidate edits, PR publication, production default changes or separately billed API fallback.

## Observed outcomes

| Campaign | Result | Recorded delivery tokens | Explanation |
| --- | --- | ---: | --- |
| feasibility-v1 | Invalid | At least 5,440,742 | MacBook slept 21 seconds after S2 started; one interrupted call has unknown usage. |
| feasibility-v2 | Failed | 5,079,377 | Plan omitted a coupled fixture; ownership enforcement refused the implementation. Limits were not exhausted. |
| feasibility-v3 original | Invalid | 26,899,370 | One package passed all commands and assembled a candidate. Frozen commit authority was incorrectly treated as a Git branch/ref at Dev Review. |
| feasibility-v4 fresh | Workflow passed; corrected behavior 9/9; blind rubric invalid over budget; blocking context defect confirmed | 23,055,087 | 42m24s, one automatic repair, 19 calls, all known; fresh review/Test/final gates and full manifest pass. |
| v3 diagnostic continuation, cumulative | Independently accepted candidate; diagnostic only | 29,802,410 | One automatic repair, then fresh review/Test/final gates, nine independent checks and blinded rubric all passed. |

The diagnostic total includes the original v3 delivery; do not add those rows together. All 16 cumulative provider calls settled with known usage. External grading used another 152,371 tokens, recorded separately. The approximately 51-minute wall time includes the evaluator interruption. The original absolute deadline and allowance were never reset.

Implementation alone took 18m26s, beyond the former 15-minute limit. Larger limits demonstrably allowed useful progress, but limits were not the only problem: coupled-path planning and frozen-target review admission also needed correction.

## Corrections and verification

Generic Plan guidance now requires tracing type/schema/interface changes through constructors, callers, adapters, mocks and fixtures; tightly coupled changes belong in one independently qualifying package. No case-specific solution paths were supplied. The new plan included the omitted fixture and produced one coherent package.

`GitWorktreeManager.mergeState` now resolves an exact recorded `commit:<SHA>` base for read-only gate admission. Malformed/mismatched/missing authority and candidate drift still fail; immutable experiment targets remain ineligible for merging. A real-Git regression failed before the fix and passed afterwards. The source passed 38 focused tests, 762 core tests, lint, formatting, typecheck, build, Sites and manifest checks. Earlier rebased frontend qualification passed 164 Frontier and 18 Frontier API checks; subsequent changes did not touch frontend code.

The accepted diagnostic candidate is `65f02c6786574a476ce0b33733167919cf67abc3`, C1 revision 2. Sol review found that null legacy completion attribution escaped migration; ordinary Sonnet repair fixed it and added regression coverage. The exact repaired candidate passed lint, types, 387 tests, build, four Sites checks, fresh Sol development/final review, nine independent behavior checks including real browser persistence, and the blind external rubric. No evaluator edited candidate code.

## Fresh independent review closeout

The fresh trial is finished. Its candidate `0389a30f502e63fe8cbccac399dcc874a4792afd` reached human approval autonomously, with one ordinary repair preventing task creation from overriding Settings. A nonblocking manual zero-question completion label issue remains. Its complete manifest passed 387 tests and four Sites checks, lint, typecheck and build.

The frozen checker returned 7/9 because two assertions assumed `task.grillPolicy`; the public contract permits the snapshot under the existing `task.agentConfig`. This concern was recorded before final grading. The h02-v2 correction recognizes both layouts and removes both when constructing a legacy fixture. Base/reference/known-bad control scores remain 1/9, 9/9 and 7/9. Both retained final candidates pass all nine corrected checks, including browser, with exact SHAs unchanged and zero new model calls. Original frozen results are retained in their trial directories; the versioned replay is private `grading-replay-v2/`.

After explicit continuation, the fresh blind review completed in 118.629s using 229,204 tokens, including 187,904 cached input. Its raw verdict rejected a P1 gap: automatic Grill answers are stored but omitted from the specification decision context. The review exceeded its fixed 200k allowance, leaving formal acceptance ungraded. A separate deterministic diagnostic with mocked providers confirmed the omission and a working manual control; zero additional model calls. No candidate edits, retry, or new delivery. The next useful unit is checker coverage and grading qualification, not a wider matrix. These results do not establish a policy winner or cross-project success rate.

PlanCheck P04 remains blocked by seven existing mypy errors at its historical base. MyStrataAssist M01 has qualified frontend behavior but incomplete full backend/E2E/environment/grader qualification. Neither project has received a live model trial. Full exact-base preflight is mandatory before either is dispatched.

Private evidence: `/Users/shaun/.codex/model-evaluation/20260922/feasibility-v3/F1/diagnostic-continuation/`. Original invalid receipts, SQLite backup and initial candidate are retained separately. No production state or original working tree was changed.

## Usage checkpoint

The complete instrumented evaluation effort, including earlier failed runs and qualification, records at least 115,548,362 tokens (109,101,008 cached input), 155 attempts and five settled attempts with unknown usage. No attempts remain active. This excludes the authoring conversation and unrelated shared-account work; it is not a billed dollar amount. The earlier Codex account snapshot showed 21% of weekly usage consumed (79% remaining), shared across the account. Claude allowance was not queried. No new delivery or model-grading call is running.
