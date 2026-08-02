# Agent Harness dogfood report

Updated: 2026-08-02

## Regression and parallel-scheduler campaign

Six additional implementation tasks were run through the real local workflow. The first three deliberately exercised the legacy single-package path; the next three exercised dependency-batched work packages, isolated slice worktrees, deterministic candidate assembly, candidate-bound review/test, repair, and fast-forward merge.

| Task | Path | Shipped change | Candidate | Merged revision | Tokens | Artifacts |
| --- | --- | --- | --- | --- | ---: | ---: |
| AH-010 | Legacy, 1 package | Shared local runtime schema version | C1 r2 | `67a0831b` | 1,093,252 | 14 |
| AH-011 | Legacy, 1 package | Grill answer payload validation | C1 r1 | `ea09f933` | 702,989 | 11 |
| AH-012 | Legacy, 1 package | Artifact copy feedback with stale-result protection | C1 r3 | `933c8121` | 2,018,800 | 16 |
| AH-013 | Parallel, 3 packages | Verified candidate-bound inline diff inspection | C1 r7 | `3a44706c` | 8,052,076 | 28 |
| AH-014 | Parallel, 3 packages | Persisted structured focused-test evidence and drilldowns | C1 r3 | `c5707804` | 8,896,506 | 18 |
| AH-015 | Parallel, 3 packages | Read-only retained worktree inventory and runtime drilldown | C1 r2 | `10703391` | 3,989,393 | 15 |

All six tasks completed and merged. Together they retained 102 artifacts, 18 approvals, and 24,753,016 reported tokens. AH-013, AH-014, and AH-015 each ran two independent packages concurrently in dependency batch 1, started their integration package only after both dependencies qualified, and assembled three exact package commits into one candidate.

### Failure accounting

The initial 12-failure ceiling was reached exactly and the run stopped as requested:

- 4 failures during the three legacy regressions;
- 7 failures during AH-013, including real cross-package contract findings, stale-response races, Windows command invocation failures, and a transient atomic-store rename failure; and
- 1 AH-014 Development Review failure that proved the initial parser/UI slices were not actually wired end to end.

After an explicit resume, a fresh allowance used 2 of 12 failures:

1. AH-014 Focused Test failed closed because the test agent used Bash-style `&&` under Windows PowerShell. The execution prompt now includes the structured evidence contract and a Windows-safe command rule.
2. AH-015 Development Review found a real backend/UI field-name mismatch. The repair aligned the shared contract and added an API-to-render integration assertion.

No failure evidence was bypassed. Every failed candidate revision remained retained, and only revisions that subsequently passed Development Review, Focused Test, Final Review, and Human Approval were merged.

### Harness and product defects fixed

- Planner ownership paths are normalized to repository-relative paths and rejected when they escape the repository.
- Ordinary `npm test` no longer implicitly requires a prebuilt Sites bundle; hosted-worker checks remain explicit under `test:sites`.
- Bounded retry overrides now work after exhausted repair, review, test, and final-review gates, including when the recorded attempt count has already crossed the prior allowance.
- Atomic JSON-store replacement retries only transient Windows `EPERM`, `EACCES`, and `EBUSY` rename failures with bounded backoff.
- Candidate diff inspection verifies the recorded worktree and exact head revision, returns capped unified diff data, and guards the UI against stale in-flight responses.
- Focused-test agents emit a candidate-bound structured evidence block that is parsed and persisted beside the Markdown artifact. The real runtime renders drillable pass/fail rows and AH-015 proved the feature with two live persisted rows.
- The runtime exposes retained slice and candidate worktrees through a strictly read-only inventory contract, including recorded/live revisions, branch, cleanliness, lifecycle, and cleanup readiness.

### What the parallel run proves

- Independent package agents really overlap in time and work in different Git worktrees.
- Dependent packages receive the complete dependency commit closure before starting.
- Candidate assembly is deterministic and downstream gates bind to the assembled candidate, not individual slice branches.
- Parallel contract mismatches are caught by candidate-level review and can be repaired without discarding qualified package commits.
- A newly merged workflow feature can be dogfooded immediately by the next task: AH-015 produced and persisted the structured test evidence introduced by AH-014.

## Earlier vertical-slice outcome

Three real implementation tasks were created in the UI and carried through investigation, specification approval, plan approval, isolated implementation, development review, Focused Test, holdout Final Review, explicit human approval, and fast-forward merge:

| Task | Shipped change | Candidate | Merged revision | Tokens | Artifacts |
| --- | --- | --- | --- | ---: | ---: |
| AH-003 | Reject invalid workflow values at the API boundary | C2 r3 | `6d170181` | 1,099,704 | 13 |
| AH-008 | Show approval history in the universal task inspector | C1 r3 | `dbdab702` | 3,283,484 | 13 |
| AH-009 | Make active-stage access messaging truthful | C1 r3 | `4f084a53` | 2,472,721 | 13 |

Together the completed tasks retained 39 stage artifacts, 9 human approvals, and 6,855,909 reported tokens. Each final merge was performed by the product only after revalidating the source checkout, candidate base, reviewed candidate head, and fast-forward eligibility.

## Resumed failure allowance

The resumed run used 4 of the 12 additional allowed failures. All four were Development Review findings and were repaired successfully:

1. AH-008 r1 did not prove approval rendering through the real workspace component.
2. AH-008 r2 still covered only a helper instead of the actual workspace render path.
3. AH-009 r1 omitted the repair-state worktree boundary and did not adequately prove viewed-stage independence.
4. AH-009 r2 derived repair access copy from the failed gate rather than the repair action's write boundary.

No root cause appeared three times. AH-008 and AH-009 both passed Development Review at r3, then passed Test and Final Review on that same revision. The earlier 12-attempt ceiling was respected before this resumed allowance; abandoned AH-004, AH-006, and AH-007 candidates were never merged.

## Harness defects found and fixed

- Focused Test originally ran in a read-only sandbox that prevented ordinary test runners from creating temporary files. Test now receives a candidate-local ignored temp directory and guarded `workspace-write`, while pre/post checks require an unchanged candidate SHA and clean Git status.
- Approval history initially had insufficient render-level coverage. It now renders inside the real universal inspector and explicitly handles both empty history and approvals without a note.
- The workspace could retain the viewed stage from a previously opened task. The runtime workspace is now keyed by task ID so task switches start at the new task's active stage.
- Execution metadata could label the viewed artifact's agent as active. The agent and sandbox rows now follow the active stage, while Stage context continues to show `Viewing` and `Active` separately.

## What this proves

- A ChatGPT-authenticated Codex session can run the whole workflow without collecting an API key.
- Source-changing work is isolated in harness-owned worktrees and committed by the harness, not the agent.
- Failed gate evidence can drive bounded repair revisions without losing prior artifacts.
- Development Review, Focused Test, Final Review, and Human Approval all bind to the exact candidate revision that is merged.
- The Test gate can run repository checks that need temp files without allowing unnoticed candidate mutation.

## Next product slice

Run a bounded pilot against a real repository such as `Eversor-MyStrataAssist`, starting with one small, reversible issue. The scheduler and assembly layer are now proven locally; the next unknowns are repository-specific commands, multi-project boundaries, real assembly conflicts, and how much task decomposition guidance is needed before broadening concurrency or adding cleanup actions.
