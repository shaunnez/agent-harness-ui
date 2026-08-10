# Follow-up: Harness-owned promotion lifecycle

Status: design follow-up only. This document does not change the current runtime contract or authorize a merge.

## Outcome

Extend the post-gate workflow from **Human approved** through **Integrated in Harness**, **Ready to promote**, and **Merged to main** without depending on, cleaning, or writing through a user's ordinary checkout.

## State model

1. `awaiting-human-approval`
   - All candidate-bound gates are fresh for one exact candidate revision and target snapshot.
   - **Approve for integration** records immutable operator intent; it does not mutate the target ref.
2. `integrating`
   - Harness creates a task-scoped integration worktree from the current target head.
   - It applies the approved candidate with the configured merge method and runs the integration manifest against the resulting tree.
3. `integrated-in-harness`
   - The integration revision, target snapshot, candidate membership, commands, outputs, and worktree identity are persisted.
   - Any conflict, failed command, dirty path, or identity drift blocks here with a typed reason.
4. `ready-to-promote`
   - A fresh operator review confirms the exact integrated revision, destination ref, merge method, and gate freshness.
   - **Promote exact revision** is the only action that may update the target ref.
5. `merged-to-main`
   - Harness proves the destination ref contains the exact promoted revision and records the observed target head and time.

Target movement before promotion invalidates `integrated-in-harness` and `ready-to-promote`. The task returns to target refresh and requires a new integration revision plus fresh operator promotion approval. The original candidate approval remains retained as audit evidence but cannot authorize the changed revision.

## Harness-owned integration worktrees

- Allocate outside the source repository at a Harness-controlled, task-and-revision-specific path.
- Create from the persisted target ref and exact target SHA; never use the user's current checkout as the merge destination.
- Persist repository real path, worktree path, branch/ref, base SHA, candidate SHA, integration SHA, owner task, creation time, and cleanup state.
- Permit writes only during integration and verification. Require a clean exact integration revision before promotion.
- Refuse reuse when any recorded identity differs, the directory is dirty, or Git no longer reports the worktree registration.
- Keep failed or conflicting worktrees for bounded inspection; cleanup is an explicit idempotent action with retained evidence.
- Serialize promotion per repository and target ref. Candidate preparation may run concurrently, but only one target compare-and-update may hold the promotion lease.

## Authority and atomicity

- Separate `candidateApproval`, `integrationIntent`, and `promotionApproval` records. Each binds task, candidate/revision, source and target SHAs, actor, timestamp, and intended action.
- Use an atomic compare-and-update against the expected target SHA. A mismatch records `target-diverged`; it never retries a ref update blindly.
- Never infer readiness from UI counters. The backend exposes available actions with typed ineligibility reasons.
- A restart reconciles retained integration and promotion intents idempotently by inspecting Git refs and persisted identities before changing task state.
- A repair or refreshed candidate creates a new revision and makes downstream integration and promotion evidence stale.

## Failure boundaries

- Candidate application conflict: `blocked/integration-conflict`; retain the worktree and require repair or refresh.
- Integration verification failure: `blocked/integration-verification`; retain exact command evidence and authorize only bounded repair.
- Dirty or missing integration worktree: `blocked/integration-worktree-drift`; do not recreate silently.
- Target advanced: existing target-refresh flow, followed by fresh gates and approval.
- Target update outcome unknown: `blocked/promotion-reconciliation`; reconcile the exact intent before any retry.

## Delivery slices

1. Persist the new states, intent records, authoritative action projection, and migrations without enabling promotion.
2. Add Harness-owned integration worktree creation, candidate application, verification, recovery, and cleanup.
3. Add repository/target promotion leases and atomic target compare-and-update with reconciliation tests.
4. Add UI evidence and two distinct operator boundaries: approve for integration, then promote exact revision.
5. Dogfood against disposable repositories, then enable behind an explicit runtime capability flag.

## Acceptance evidence for the follow-up

- Dirty user checkouts remain byte-for-byte untouched during integration and promotion.
- Restart tests cover every persisted intent boundary and prove idempotence.
- Concurrent promotion tests prove one winner and fail-closed target drift.
- Conflict, failed verification, dirty worktree, missing worktree, and unknown ref-update outcomes retain actionable evidence.
- The UI never offers an action rejected by the same backend projection.
- The final `merged-to-main` state is established from the observed destination ref, not from a successful command exit alone.
