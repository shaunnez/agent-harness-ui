# Delivery evaluations

The primary question is whether a frozen model policy delivers independently acceptable code without operator rescue. See `docs/MODEL-EVALUATION-RESULTS.md` for observed results and `docs/MODEL-BASELINE-AND-EVALUATION.md` for the method and proposed policies.

## Current scope

The checked-in delivery runner supports qualified H02, H05, H06 and P05 cases on the inspected macOS native CLI environment. P05 is the PlanCheck UI/backend/PostgreSQL replay; it provisions Python and frontend dependencies in each isolated trial, then grades a committed candidate with synthetic PostgreSQL and browser checks. It is not a generic cross-repository or cross-platform runner. The case bank selects 15 historical tasks; qualification status is explicit on each case. M01/P03 have confirmed historical baseline blockers; H01/P04 also retain unresolved gates. Unsupported case IDs are rejected.

`prepare-case.mjs` can create clean private base/reference checkouts for a selected case, but does not qualify that case. Reference patches, later history, independent grading inputs and retained sibling candidates must remain inaccessible to evaluated agents.

## Freeze before dispatch

1. Read applicable AGENTS.md, inspect Git and preserve dirty source checkouts/services. Use new private evidence and public candidate roots, independent task stores, and synthetic databases.
2. Prove the base's expected task failures, passing reference, meaningful rejected mutant, and pass-to-pass regression baseline. An existing target-defect test may be explicitly declared fail-to-pass; never waive an unexplained baseline failure.
3. Qualify the complete manifest, independent grader, fixed blinded rubric and actual provider permission configuration. Existing authenticated Codex/Claude runtimes are used; no API-key fallback.
4. Choose exact model/effort matrices and a feasible equal allowance before the comparison. The 5M/30-minute task limit and 15-minute implementation-call limit in the original pilot are historical experimental configuration, not a recommended universal delivery budget. Changing it or a prompt/tool/environment requires a new freeze.
5. Commit the qualified harness, then prepare a new campaign. Record its harness/case/grader/environment/policy versions and zero-inference preflight receipts.

## Runner entry points

All commands run from the isolated harness source. Preparation refuses an existing output directory. Replace placeholders deliberately; never rerun a started worker because its console output is missing.

```text
node scripts/evaluation/prepare-case.mjs CASE_ID SOURCE_REPOSITORY NEW_PRIVATE_CASE_DIRECTORY
EVAL_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node scripts/evaluation/prepare-batch.mjs NEW_PRIVATE_BATCH NEW_PUBLIC_ROOT SOURCE_REPOSITORY codex-comparison H05
EVAL_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node scripts/evaluation/prepare-batch.mjs NEW_PRIVATE_BATCH NEW_PUBLIC_ROOT SOURCE_REPOSITORY codex-6-comparison H05
EVAL_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node scripts/evaluation/prepare-batch.mjs NEW_PRIVATE_BATCH NEW_PUBLIC_ROOT PLANCHECK_REPOSITORY medium-provider-comparison P05
node scripts/evaluation/trial-worker.mjs PRIVATE_TRIAL/config.json
node scripts/evaluation/finalize-trial.mjs PRIVATE_TRIAL
node scripts/evaluation/report-batch.mjs PRIVATE_BATCH
```

The optional final case argument defaults to H02. H05 supports its historical one-arm `dry-run` / `feasibility` preparation and the explicit two-arm `codex-comparison` mode. The comparison freezes Sol High versus Luna High for Implement and Repair while keeping every other role equal, permits only the Codex provider, and prepares both isolated trials before dispatch. `prepare-batch.mjs ... dry-run H05` prepares zero-inference task-creation checks; it does not demonstrate model delivery. Use `trial-worker.mjs PRIVATE_TRIAL/config.json --preflight` for task admission without dispatch. A plain worker invocation starts delivery and requires run authorization. Never promote a dirty-source dry-run bundle to live execution; prepare anew from clean committed source.

`codex-6-comparison H05` is the separate GPT-6 migration policy; it leaves the historical 5.6 matrix intact. See [the GPT-6 result](../docs/MODEL-EVALUATION-CODEX-6-RESULT.md). The Playwright module must live outside all paths denied to the independent grader. Preparation rejects a module under the private model-evaluation evidence root; a byte-identical Playwright 1.61.1 copy is available at `/Users/shaun/.codex/evaluation-tools/playwright-1.61.1/node_modules/playwright/index.mjs`.

The same `codex-6-comparison` mode also admits the qualified medium H02 development case with its high-risk assurance profile and the same generous two-hour / 200M-token delivery allowance. H03 remains hard, held out and without runner integration.

Place new live campaigns directly under the established private date root, and verify the resulting protected paths cover all earlier private campaigns, references and public candidates. Nested preparation-only directories do not establish that containment. The worker must run directly with Node. Provider-native tool confinement is configured by the guard; verification runs in its own OS-confined child. Do not nest native provider sandboxes inside an outer `sandbox-exec` process.

`prepare-batch.mjs ... feasibility H02` or `... feasibility H05` prepares one balanced-policy trial (`F1`). `... codex-comparison H05` prepares exactly two concurrent trials (`A` Sol implementation/repair and `B` Luna implementation/repair). Every H05 trial has the two-hour task allowance, 200M total tokens and one-hour calls for every model stage. All modes retain 100 agent-run / 1,000 provider-invocation safeguards. New preparations freeze numeric repair limits: two automatic corrections per package, three shared candidate repairs for H02's high-risk profile or two for H05's standard profile. Stage overrides are frozen in the environment and persisted onto the isolated task before dispatch. Two observations are directional comparison evidence, not a reliable pass-rate estimate or automatic policy promotion.

Independent review uses H02's unchanged `delivery-rubric-v5` or the case-specific `delivery-rubric-h05-v1`: one hour / 30M tokens, accounted separately from delivery. Its parent timeout follows that allowance; no one-to-three inspection-command cap remains. Historical frozen campaigns and grades retain their original limits. See [the Grill correction record](../docs/MODEL-EVALUATION-GRILL-FIX.md) for H02 history and the current preparation handoff for remaining dispatch gates.

Run the complete required quality baseline on the exact isolated case revision before model dispatch, including linting and typing. Qualification of a different checkout is insufficient. PlanCheck and MyStrataAssist remain ineligible until their complete manifests, synthetic environments, references and graders pass; do not spend model calls against an unexplained broken baseline.

Also run the real-Git frozen-target regression in `tests/git-worktree.test.mjs`: a `commit:<SHA>` experiment authority must admit candidate review while retaining the exact base, candidate identity and merge restrictions. Passing a repository's baseline alone does not prove that the harness can advance an assembled candidate into review.

On macOS launch long trials with a process-scoped idle-sleep assertion, for example `caffeinate -is node scripts/evaluation/trial-worker.mjs PRIVATE_TRIAL/config.json`. This does not prevent lid-closed sleep on battery. If the host suspends, retain power-log evidence and adjudicate the interrupted trial separately; elapsed sleep is not active model execution. Keep the original receipt and usage, including unknown usage, and prepare any replacement as a new frozen campaign.

Dispatch the frozen slots serially, finalizing each before the next. Inspect SQLite, provider-ledger.json, delivery-ended.json and task.json after disconnect/compaction. Stop for apparatus uncertainty or unknown active consumption. Keep invalid attempts, failed attempts and cancelled slots visible. No benchmark task publishes a PR or changes production policy.

## Interpretation and reruns

The worker counts all model attempts and adapter probes. Dispatch refuses exhausted time/token/call allowances; an in-flight call may overshoot. Cached input is included in raw token totals. Actual subscription charges are unavailable; missing rates/usage never mean zero.

Independent acceptance is bound to exact candidate ID, revision and SHA. The complete frozen manifest and fresh authoritative gates are required. Passing slices or self-scores are diagnostics. Score first-pass and eventual acceptance separately, including all permitted repairs in a trial; resources per acceptance are unavailable when no trial succeeds.

A new model release becomes a versioned challenger against the current policy. Start with development cases, then use untouched held-out cases after feasibility and reliability justify them. Production incidents can add reviewed, sanitized replay cases; observational traffic cannot silently become a controlled model ranking or automatically promote defaults.
