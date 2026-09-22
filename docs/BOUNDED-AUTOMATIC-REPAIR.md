# Bounded automatic repair

Implemented on `codex/bounded-package-repair`, based on main `3878a241`.

## Operator controls

Open Frontier **Settings → Models & workflow**. The existing **Repair** choice controls automatic correction of package checks before integration and candidate defects found by Dev Review, Test or Final Review. Those stages' own auto-run choices control whether their next evaluation starts automatically. Main's saved Repair, Dev Review and Test choices were already automatic when inspected; this branch does not change the live database or restart its runtime.

The new **Repair limits** card accepts additional attempts from 0 through 10:

| Scope | Default |
| --- | ---: |
| Automatic corrections per package | 2 |
| Fast candidate repairs | 1 |
| Standard candidate repairs | 2 |
| High-risk candidate repairs | 3 |

Two package corrections means at most three implementation calls for that package in an uninterrupted attempt. Counts persist; a manual retry does not replenish automatic corrections. Candidate repairs share one allowance across all downstream gates, including manual repairs and calls that fail or are cancelled. Model/tool execution retries remain separate from code repairs.

New tasks snapshot the numeric limits. Legacy tasks use the defaults. Changing settings does not rewrite an existing task or its receipts. Stage allowances expand where necessary to accommodate the selected profile's configured candidate allowance, without clearing attempts or reducing an explicitly granted allowance.

## Execution and evidence

1. Retain the failed package commit, qualification rows, provider run and artifact.
2. Check automatic mode, remaining allowance, task reservation and clean retained worktree.
3. Reserve a correction before dispatch and link it to the previous failed check's run.
4. Send the observed failure back under the original Implement model policy.
5. Re-run qualification; assemble only when every package qualifies. A corrected candidate must still pass review and testing.

Dependent packages retain their dependency commits. Candidate lineage accepts only explicitly linked sequential corrections backed by failed qualification; unexplained duplicate calls remain invalid. Long TAP output retains failing assertions so a passing tail does not hide them.

Cancellation, invalid plans, ownership violations, inherited baseline failures, command-start failures and timeouts do not automatically request a code change. Fast tasks retain their existing escalation/replanning behavior when focused qualification fails. Hitting a limit retains the failure and stops; it does not silently launch a replacement task.

## Verification

The regression tests exercise correction and integration, exhaustion, manual/zero settings, cancellation, baseline failures, ownership, persisted settings, task snapshots, larger candidate allowances, and lineage rejection. A real Git/worktree test repairs a dependent package while preserving its dependency and validates the resulting candidate's producer evidence. No provider is called by these tests.

Verified on 22 September 2026: core 723/723, Frontier 164/164, Frontier API 18/18 and Sites 4/4 tests passed. Lint, formatting, TypeScript, both application builds and manifest coverage checks passed. Tests used process-local unsigned fixture commits; dependency installation was isolated in this worktree because the borrowed main dependency tree lacked a native SQLite binding. Main's dependencies and dirty files were preserved.

Browser qualification uses the isolated Frontier preview at `http://127.0.0.1:5297/?mode=fixture#settings`. Settings save and validation are exercised in demonstration mode; real API persistence and task snapshots are covered by `tests/frontier/api/settings-roundtrip.test.mjs`. The deterministic QA API has no discovered model catalogue, so its normal settings form correctly prevents policy saves; this is not treated as a successful live UI round trip.

At the available 1280 × 720 viewport, the new fields and Repair choice were readable and reachable through the existing settings scroll area, with the save bar retained. Saving package 3 / standard 4 succeeded, 11 displayed validation and disabled Save, and the default 2 / 1 / 2 / 3 values were restored and saved. The preview retains automatic Repair in demonstration mode only.

No historical evaluation candidate or receipt was changed. No paid evaluation, PR, merge or deployment was performed. The implementation is local and is not yet active in the user's main runtime.
