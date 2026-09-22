# Fresh H02 baseline — 22 September 2026

**Shaun subsequently requested a fresh run instead of cancellation/resume handling. `feasibility-v6/F1` started at 15:00 NZ on 22 September with the same balanced policy, case, base, grader and generous allowances. The cancelled v5 attempt remains untouched.**

The new source freeze is `a1ecaa9`; changes since the prior executable freeze `a8bfd00` are documentation only. New private evidence is `/Users/shaun/.codex/model-evaluation/20260922/feasibility-v6`, and isolated delivery files are under `/private/tmp/h-eval-f6/F1`. All five exact-base manifest commands, API admission, persisted stage allowances and native permission checks passed before dispatch. Claude's built-in usage check showed 3% used in the current five-hour window. The live worker is identified in private `dispatch.json` (exec session `88663`); read the durable task/ledger and `status.py` before acting. Never duplicate a running worker. This authorization covers one fresh delivery and at most one blind review after behavior checks pass; it does not add a comparison campaign or implement cancellation/resume handling.

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
