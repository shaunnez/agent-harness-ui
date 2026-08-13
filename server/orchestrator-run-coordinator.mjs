import { refreshGateFreshness, stageRunLimitFor } from "./run-activity.mjs";
import { now, activity } from "./orchestrator-stage-support.mjs";
import { stageForRun } from "./orchestrator-task-helpers.mjs";

export class OrchestratorRunCoordinator {
  constructor({
    store,
    worktrees,
    runInvestigation,
    runSpecification,
    runPlanning,
    runImplementation,
    runRepair,
    runReviewWithFastRepair,
    runEvaluation,
  }) {
    this._store = store;
    this._worktrees = worktrees;
    this._runInvestigation = runInvestigation;
    this._runSpecification = runSpecification;
    this._runPlanning = runPlanning;
    this._runImplementation = runImplementation;
    this._runRepair = runRepair;
    this._runReviewWithFastRepair = runReviewWithFastRepair;
    this._runEvaluation = runEvaluation;
  }

  async run(id, kind, signal) {
    try {
      if (kind === "investigation") await this._runInvestigation(id, signal);
      if (kind === "specification") await this._runSpecification(id, signal);
      if (kind === "planning") await this._runPlanning(id, signal);
      if (kind === "implementation") await this._runImplementation(id, signal);
      if (kind === "repair") await this._runRepair(id, signal);
      if (kind === "review") await this._runReviewWithFastRepair(id, signal);
      if (kind === "test") await this._runEvaluation(id, "test", signal);
      if (kind === "final-review") await this._runEvaluation(id, "final-review", signal);
    } catch (error) {
      let implementationTargetDrift = null;
      if (kind === "implementation") {
        try {
          const stoppedTask = await this._store.get(id);
          const latestTarget = await this._worktrees.base(stoppedTask, { allowDirty: true });
          const attemptedBases = new Set(
            (stoppedTask.workPackages ?? []).map((workPackage) => workPackage.baseRevision).filter(Boolean),
          );
          if (
            attemptedBases.size &&
            [...attemptedBases].some((revision) => revision !== latestTarget.baseRevision)
          ) {
            implementationTargetDrift = latestTarget.baseRevision;
          }
        } catch {
          /* Preserve the original implementation failure when target inspection is unavailable. */
        }
      }
      await this._store.update(id, (draft) => {
        const failedKind = draft.activeRunKind ?? kind;
        const stage = stageForRun(failedKind, draft.currentStage);
        const attempts = draft.attemptsByStage?.[stage] ?? 1;
        const fastReplanRequired = error?.code === "FAST_PROFILE_REPLAN_REQUIRED";
        draft.currentStage = fastReplanRequired ? "scouts" : stage;
        draft.status = signal.aborted
          ? "cancelled"
          : attempts >= stageRunLimitFor(draft, stage)
            ? "blocked"
            : "failed";
        if (fastReplanRequired) {
          draft.stageDispositions = {};
          const affectedPackage = draft.workPackages?.find(
            (workPackage) => workPackage.id === error.workPackageId,
          );
          if (affectedPackage) {
            affectedPackage.status = "failed";
            affectedPackage.error = error.message;
          }
        }
        draft.error = error.message;
        if (implementationTargetDrift) {
          draft.status = "blocked";
          draft.blocker = {
            code: "implementation-target-diverged",
            detail: `The target advanced to ${implementationTargetDrift}. Restart approved packages from the latest target instead of continuing historical slices.`,
            detectedAt: now(),
            targetRevision: implementationTargetDrift,
          };
        }
        draft.activeRunKind = null;
        draft.activeRunReservationId = null;
        const candidate = draft.candidates?.at(-1);
        if (candidate) {
          const candidateStatus = {
            implementation: "failed",
            repair: "repair_required",
            review: "ready_for_review",
            test: "ready_for_test",
            "final-review": "ready_for_final_review",
          }[failedKind];
          if (candidateStatus) candidate.status = candidateStatus;
        }
        refreshGateFreshness(draft);
        draft.events.push(
          activity(
            fastReplanRequired ? "scouts" : stage,
            signal.aborted
              ? "Run cancelled"
              : fastReplanRequired
                ? "Full workflow evidence required"
                : "Stage failed",
            error.message,
            "danger",
          ),
        );
      });
    }
  }
}
