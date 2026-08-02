# Agent Harness dogfood report

Updated: 2026-08-02

## Outcome

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

The current runtime intentionally creates one implementation candidate from one implementation session. The next major cut is the already-designed multi-package scheduler and assembly layer: dependency-aware work packages, per-slice worktrees and local qualification, explicit candidate membership and merge order, conflict handling, then authoritative candidate-level review and test gates.
