# Fresh H02 baseline — 22 September 2026

> Current result (22 September 2026): [H02 v7 closeout](MODEL-EVALUATION-H02-V7.md) supersedes the execution status below. Delivery completed in 36m41s with zero repairs; corrected independent behavior 11/11; one blind review rejected a Settings save-scope defect confirmed in the browser. No worker or grader remains active. The sections below retain historical evidence, not authority to relaunch.

**Fresh `feasibility-v6/F1` finished after 27m54s. The implementation call completed, but package qualification failed four API validation tests. No integrated candidate or blind review. All provider calls are settled. The cancelled v5 attempt remains untouched; no cancellation/resume handling was implemented.**

Shaun explicitly requested this fresh run instead of cancellation/resume handling. Source freeze `a1ecaa9` differs from prior executable freeze `a8bfd00` only in documentation. Private evidence is `/Users/shaun/.codex/model-evaluation/20260922/feasibility-v6`, and isolated delivery files are under `/private/tmp/h-eval-f6/F1`. All five exact-base manifest commands, API admission, persisted stage allowances and native permission checks passed before dispatch. Claude's built-in usage check showed 3% used in the current five-hour window. The run started at `03:00:17.474Z` and ended at `03:28:11.633Z` (15:00–15:28 Pacific/Auckland). Worker exec session `88663` is complete; never restart it.

## Fresh v6 result

- Triage, scouts, Grill, Specification and Plan completed. Plan produced one coupled implementation package. Sonnet 5 High completed that package in one attempt; no model substitution, operator code edits or automatic repair occurred.
- Retained package commit: `f6342b9896ab2beb823014a4ad6274c5d5ead3ac`, in `/private/tmp/h-eval-f6/F1/w/AH-001/S1-A1`. It is clean and unchanged after diagnosis.
- Authoritative package qualification passed lint and types, then failed `npm test`: **380/384 passed**. Build and Sites checks were skipped after that failure. Agent-reported checks are separate from this observed result.
- A zero-inference diagnostic reran the unchanged suite under the verifier's confinement and reproduced the same four failures. Existing tests for missing/blank question IDs and answers omit the newly required `interactionSource: "operator-ui"`. They therefore receive the provenance error before their expected missing-field error. The starting baseline had passed all 371 tests; this is a candidate test-compatibility gap, not an unexplained baseline failure.
- Sonnet reported that its native sandbox prevented HTTP listener tests, plus a Git-signing fixture failure. The current Claude profile disables network and does not enable local binding; the native permission preflight only establishes filesystem confinement. The host verifier successfully ran the HTTP tests and found the actual assertion failures. Do not characterize the model's claimed environment failure as the cause of those four assertions.
- The harness stopped at package qualification without feeding the failures back for automatic correction. No integrated candidate exists, so independent acceptance and the conditional blind review did not run.
- **30,354,715 tokens**, including **29,754,526 cached input tokens** (98.0%); nine provider attempts, all settled with known usage. Sonnet's implementation accounted for 29,351,728 tokens. Total usage exceeded the frozen 30M allowance by 354,715 tokens (1.18%) in the completed call. The call was not cut off; the stop was test qualification failure. The report records a failed trial and budget ineligibility, with no leader.

Private evidence: `closeout.json`, `report.json`, `qualification-diagnostic/`, `accounting-after.json`, and the original `F1` task/ledger/SQLite/end receipts. Fingerprints confirm cancelled v5 receipts and partial work remain unchanged. The updated all-attempt accounting has 173 provider attempts, zero active, at least 146,899,946 tokens, and six historical unknown-usage attempts; it excludes this authoring conversation and unrelated account use.

Recommended next work is a bounded implementation-verification feedback path: let the implementation agent invoke the approved harness verifier and respond to concrete package-qualification failures while retaining the checks and recorded attempt history. This is a recommendation, not an implemented change or a newly launched run. No cancellation/resume feature work, automatic replacement campaign, model ranking, PR, merge or deployment occurred.

## Earlier cancellation and blocked continuation

Shaun authorized this one-time continuation after cancellation, with instructions to report a blocker if safe resumption was unavailable. The built-in Claude `/usage` check showed 3% of the five-hour session used, resetting at 19:50 Pacific/Auckland; the check session recorded zero model tokens and zero API seconds, and exited. The task remains cancelled with no active runs or provider calls. Its retained continuation action is denied: the supported path covers failed/blocked tasks with interruption, timeout or qualification errors, excluding explicit cancellation. Ordinary retry attempts cleanup of the retained worktree and prepares a new package attempt, so it is not a safe continuation of the partial work.

Separately, the cancelled Sonnet ledger entry has unknown usage; the provider guard refuses any subsequent invocation when prior usage is missing. No status, ledger, candidate code or allowance was changed to bypass these checks. Original receipts and the seven-file partial implementation remain preserved. The separate private receipt is `feasibility-v5/resume-check-20260922T0250Z.json`. No replacement campaign or blind review was launched by that timed check. Shaun then chose the fresh v6 run described above; cancellation/resume handling is explicitly outside this unit.

Shaun explicitly authorized the next unit with “Do it”: qualify the missing independent handoff check, then run one fresh balanced baseline and at most one blind review. No repeat or model comparison is part of this unit.

## Frozen scope

- H02 v2, historical task base `4b303a8da4fafd7a78149ddad40cbf714411d08b`. The brief now explicitly requires resolved automatic/manual answers and true answer source to reach Specification and its supplied-context manifest. This is a clarified new case version, not a re-score of an earlier run.
- Same balanced grouping: Luna High Triage/scouts; Sol High Grill/Specification/Plan/Dev Review/Final Review; Sonnet 5 High Implement/Repair; Luna Medium Test narrative. The harness executes repository verification itself. No policy escalation or model substitution.
- Two-hour / 30M-token delivery; all stage calls at one hour within the task deadline. Existing API-supported run-count safeguards: 100 agent runs / 1,000 provider invocations. These are ceilings, not expected usage.
- One separate Sol High blind review if behavior checks pass: one hour / 30M tokens under `delivery-rubric-v5`. Maximum declared delivery-plus-review scope is three hours / 60M tokens. No automatic retry. In-flight token overshoot can occur and must be reported.
- Sole decision metric: autonomous independently accepted delivery. Gate pass rates, repairs, tokens, latency and cache rate are diagnostics. One run cannot establish a policy winner or reliability rate.

## Independent checker qualification

`h02-v3` retains the prior nine behavior checks and adds automatic and manual specification-context checks. They capture actual Specification dispatch, verify answer/source and supplied-context evidence, and change only resolved decision records to confirm the prompt consumes the selection rather than merely carrying the old recommendation artifact. The public contract requires the behavior without prescribing a particular task-policy nesting or answer formatting.

Zero real provider calls:

| Subject | Result |
| --- | --- |
| Historical task base | 1/11; expected target-feature failures |
| Reviewed reference plus isolated context correction | 11/11; full five-command manifest also passes |
| Reference with resolved-answer prompt content deliberately removed | 9/11; both context checks fail |
| Retained failing candidate `0389a30f502e63fe8cbccac399dcc874a4792afd` | 9/11; both context checks fail; SHA and working tree unchanged |

Private evidence: `/Users/shaun/.codex/model-evaluation/20260922/grader-v3-qualification/`. Correct reference is `bfafc5e5e894899f338506cc39bbdb6f93bc72e1`; mutant is `d7d680e`. Original reference/candidate checkouts and receipts remain unchanged. The first qualification recorder noticed the new reference's dependency symlink as untracked; it was excluded locally, with the already-passing checker receipt retained. No code result was changed to resolve that recorder check.

Current harness regressions: 33 frozen-target/Grill/context checks passed. Prior full qualification of the unchanged runtime/UI remains in [MODEL-EVALUATION-GRILL-FIX.md](MODEL-EVALUATION-GRILL-FIX.md). Main was fetched and remains `3878a2419979465a53171cd59a5cff455a6a2646`; the isolated branch already contains it. Concurrent original-checkout edits were preserved.

## Execution record

Campaign `feasibility-v5/F1` ran from 02:14 UTC until user cancellation at 02:34 UTC. Source freeze: `a8bfd00`. Exact-base lint, types, 371 tests, build and four Sites checks passed before dispatch; API admission, persisted allowances and provider-native permissions also passed. An initial zero-inference baseline attempt waited on inherited Git signing; it was stopped and the complete baseline passed with process-only signing disabled. Its interruption record is retained.

Triage, two scouts, Grill, Specification and Plan completed. The plan selected one coupled package. Sonnet 5 High was implementing it when Shaun requested cancellation. The normal task cancellation API returned success; task and implementation run are cancelled, the worker and provider processes exited, and all nine ledger attempts are settled. There is no integrated candidate or acceptance result. The cancellation is not a model-quality failure.

Known completed usage is 996,869 tokens. The cancelled Sonnet call has unknown usage, so that is a lower bound, not the complete consumption. The two Haiku adapter probes completed before implementation. No blind review or replacement was launched. Preserve `/private/tmp/h-eval-f5/F1/w/AH-001/S1-A1` and all private evidence under `/Users/shaun/.codex/model-evaluation/20260922/feasibility-v5`, especially `cancellation.json`, `preflight-summary.json`, `F1/provider-ledger.json`, SQLite, task export and delivery-ended receipt.

Before dispatch, verify the actual isolated task base's complete manifest, API admission, persisted overrides, native provider permissions, clean source and frozen identities. Use process-scoped idle-sleep prevention. The laptop is on battery; a lid-close or power interruption must be recorded as host interruption, never silently retried or attributed to a model.

No PR publication, merge, production activation or deployment is authorized by this evaluation. PlanCheck and MyStrataAssist are not being evaluated in this unit.
