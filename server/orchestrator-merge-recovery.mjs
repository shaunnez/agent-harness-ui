import {
  assertCandidateGatesFresh,
  candidateGateFailure,
  currentCandidate,
} from "./orchestrator-run-policy.mjs";
import { activity, now } from "./orchestrator-stage-support.mjs";

export class MergeRecoveryOrchestrator {
  constructor({ store, mergeActive, worktrees, finalizeMerge }) {
    this._store = store;
    this._mergeActive = mergeActive;
    this._worktrees = worktrees;
    this._finalizeMerge = finalizeMerge;
  }
  async approveMerge(id, note = "") {
    if (this._mergeActive.has(id))
      throw new Error("This task already has a merge reconciliation in progress.");
    this._mergeActive.add(id);
    return this._approveMerge(id, note).finally(() => this._mergeActive.delete(id));
  }

  async reconcileMerge(id) {
    if (this._mergeActive.has(id))
      throw new Error("This task already has a merge reconciliation in progress.");
    this._mergeActive.add(id);
    return this._reconcileMergeIntent(id, { operatorRequested: true }).finally(() =>
      this._mergeActive.delete(id),
    );
  }

  async _approveMerge(id, note = "") {
    let task = await this._store.get(id);
    if (!task) throw new Error("Task not found.");
    if (task.status === "awaiting-human-approval") {
      const candidate = currentCandidate(task);
      if (candidate.status !== "awaiting_human_approval")
        throw new Error("The current candidate has not cleared every gate.");
      assertCandidateGatesFresh(task, candidate);
      const targetRef =
        candidate.baseRef ??
        (candidate.baseBranch && candidate.baseBranch !== "detached"
          ? `refs/heads/${candidate.baseBranch}`
          : null);
      if (!targetRef || !candidate.headRevision)
        throw new Error("The candidate does not have a mergeable target revision.");
      const preflightState =
        typeof this._worktrees.mergeState === "function"
          ? await this._worktrees.mergeState(candidate)
          : "pending";
      if (preflightState === "diverged") {
        await this._store.transition(
          id,
          (draft) =>
            draft.status === "awaiting-human-approval" &&
            currentCandidate(draft).headRevision === candidate.headRevision,
          (draft) => {
            const detectedAt = now();
            draft.status = "blocked";
            draft.error =
              "The target branch advanced after this candidate was created. Refresh the candidate from the target before approval.";
            draft.blocker = {
              code: "target-diverged",
              detail: draft.error,
              detectedAt,
              candidateId: candidate.id,
              candidateRevision: candidate.revisionNumber,
              candidateBaseRevision: candidate.baseRevision,
            };
            draft.events.push(
              activity("approval", "Target branch advanced", draft.error, "warning", "decision"),
            );
          },
        );
        throw new Error("The target branch advanced. Refresh the candidate from the target before approval.");
      }
      task = await this._store.transition(
        id,
        (draft) => {
          const activeCandidate = currentCandidate(draft);
          return (
            draft.status === "awaiting-human-approval" &&
            activeCandidate.status === "awaiting_human_approval" &&
            candidateGateFailure(draft, activeCandidate) == null
          );
        },
        (draft) => {
          const activeCandidate = currentCandidate(draft);
          draft.status = "merging";
          draft.mergeIntent = {
            candidateId: activeCandidate.id,
            candidateRevision: activeCandidate.revisionNumber,
            baseRevision: activeCandidate.baseRevision,
            headRevision: activeCandidate.headRevision,
            targetRef,
            note: note.trim().slice(0, 5_000),
            status: "pending",
            startedAt: now(),
            completedAt: null,
            error: null,
          };
          draft.events.push(
            activity(
              "approval",
              "Merge intent recorded",
              `${activeCandidate.id} revision ${activeCandidate.revisionNumber} is reserved for ${targetRef}.`,
              "warning",
              "decision",
            ),
          );
        },
      );
    } else if (task.status !== "merging" || task.mergeIntent?.status !== "pending") {
      throw new Error("The task is not awaiting merge approval.");
    }

    return this._reconcileMergeIntent(id);
  }

  async _reconcileMergeIntent(id, { operatorRequested = false } = {}) {
    let task = await this._store.get(id);
    if (!task) throw new Error("Task not found.");
    if (task.status === "merged-to-target" && task.mergeIntent?.status === "completed") return task;
    const retryableFailure =
      task.status === "blocked" &&
      task.blocker?.code === "merge-reconciliation" &&
      task.mergeIntent?.status === "failed";
    if (retryableFailure) {
      task = await this._store.transition(
        id,
        (draft) =>
          draft.status === "blocked" &&
          draft.blocker?.code === "merge-reconciliation" &&
          draft.mergeIntent?.status === "failed",
        (draft) => {
          draft.status = "merging";
          draft.error = null;
          draft.blocker = null;
          draft.mergeIntent.status = "pending";
          draft.mergeIntent.error = null;
          draft.mergeIntent.reconciliationAttempts = (draft.mergeIntent.reconciliationAttempts ?? 0) + 1;
          draft.mergeIntent.lastReconciliationAt = now();
          draft.events.push(
            activity(
              "approval",
              "Merge reconciliation requested",
              "The original exact-candidate approval intent is retained while the target and candidate are checked again.",
              "warning",
              "decision",
            ),
          );
        },
      );
    } else if (task.status !== "merging" || task.mergeIntent?.status !== "pending") {
      throw new Error(
        operatorRequested
          ? "This task does not have a retained merge intent that can be reconciled."
          : "The task is not awaiting merge reconciliation.",
      );
    }

    const candidate = currentCandidate(task);
    if (
      task.mergeIntent.candidateId !== candidate.id ||
      task.mergeIntent.candidateRevision !== candidate.revisionNumber ||
      task.mergeIntent.headRevision !== candidate.headRevision ||
      task.mergeIntent.baseRevision !== candidate.baseRevision
    ) {
      const error = new Error(
        "The retained merge intent no longer matches the exact current candidate revision.",
      );
      await this._blockMergeIntent(id, candidate, error);
      throw error;
    }
    try {
      assertCandidateGatesFresh(task, candidate);
      const mergeState =
        typeof this._worktrees.mergeState === "function"
          ? await this._worktrees.mergeState(candidate)
          : "pending";
      if (mergeState === "diverged")
        throw new Error("The recorded target ref moved after merge approval was reserved.");
      if (mergeState === "pending") await this._worktrees.merge(candidate);
      return this._finalizeMerge(id);
    } catch (error) {
      await this._blockMergeIntent(id, candidate, error);
      throw error;
    }
  }

  async _blockMergeIntent(id, candidate, error) {
    await this._store.update(id, (draft) => {
      if (draft.status !== "merging" || draft.mergeIntent?.status !== "pending") return;
      const targetDiverged = /target ref (?:diverged|moved)|target branch advanced|source branch moved/i.test(
        error.message,
      );
      draft.status = "blocked";
      draft.error = error.message;
      draft.blocker = {
        code: targetDiverged ? "target-diverged" : "merge-reconciliation",
        detail: error.message,
        detectedAt: now(),
        candidateId: candidate.id,
        candidateRevision: candidate.revisionNumber,
        candidateBaseRevision: candidate.baseRevision,
      };
      draft.mergeIntent.status = "failed";
      draft.mergeIntent.error = error.message;
      draft.mergeIntent.failedAt = now();
      draft.events.push(
        activity(
          "approval",
          targetDiverged ? "Target branch advanced" : "Merge reconciliation required",
          error.message,
          "danger",
          "decision",
        ),
      );
    });
  }

  async recoverMergeIntents() {
    const tasks = await this._store.list();
    for (const task of tasks.filter(
      (item) => item.status === "merging" && item.mergeIntent?.status === "pending",
    )) {
      try {
        await this._reconcileMergeIntent(task.id);
      } catch {
        // Reconciliation persists its exact blocker before returning. Startup recovery is
        // deliberately best-effort so one blocked task cannot keep the companion offline.
      }
    }
  }
}
