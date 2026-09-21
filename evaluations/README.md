# Delivery evaluations

The primary question is whether a frozen model policy delivers independently acceptable code without operator rescue. See `docs/MODEL-EVALUATION-RESULTS.md` for observed results and `docs/MODEL-BASELINE-AND-EVALUATION.md` for the method and proposed policies.

## Current scope

The checked-in delivery runner supports the qualified H02 Harness case on the inspected macOS native CLI environment. It is not a generic cross-repository or cross-platform runner. The case bank selects 12 real historical tasks and 4 readiness controls; qualification status is explicit on each case. H01/M01/P04 have additional private preparation evidence, with remaining gates recorded. Do not launch them by substituting their IDs into the H02-specific runner.

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
EVAL_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node scripts/evaluation/prepare-batch.mjs NEW_PRIVATE_BATCH NEW_PUBLIC_ROOT SOURCE_REPOSITORY
node scripts/evaluation/trial-worker.mjs PRIVATE_TRIAL/config.json
node scripts/evaluation/finalize-trial.mjs PRIVATE_TRIAL
node scripts/evaluation/report-batch.mjs PRIVATE_BATCH
```

`prepare-batch.mjs ... dry-run` prepares zero-inference task-creation checks; it does not demonstrate model delivery. The worker must run directly with Node. Provider-native tool confinement is configured by the guard; verification runs in its own OS-confined child. Do not nest native provider sandboxes inside an outer `sandbox-exec` process.

Dispatch the frozen slots serially, finalizing each before the next. Inspect SQLite, provider-ledger.json, delivery-ended.json and task.json after disconnect/compaction. Stop for apparatus uncertainty or unknown active consumption. Keep invalid attempts, failed attempts and cancelled slots visible. No benchmark task publishes a PR or changes production policy.

## Interpretation and reruns

The worker counts all model attempts and adapter probes. Dispatch refuses exhausted time/token/call allowances; an in-flight call may overshoot. Cached input is included in raw token totals. Actual subscription charges are unavailable; missing rates/usage never mean zero.

Independent acceptance is bound to exact candidate ID, revision and SHA. The complete frozen manifest and fresh authoritative gates are required. Passing slices or self-scores are diagnostics. Score first-pass and eventual acceptance separately, including all permitted repairs in a trial; resources per acceptance are unavailable when no trial succeeds.

A new model release becomes a versioned challenger against the current policy. Start with development cases, then use untouched held-out cases after feasibility and reliability justify them. Production incidents can add reviewed, sanitized replay cases; observational traffic cannot silently become a controlled model ranking or automatically promote defaults.
