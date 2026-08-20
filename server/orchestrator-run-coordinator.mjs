import { activity, now } from "./orchestrator-stage-support.mjs";
import { stageForRun } from "./orchestrator-task-helpers.mjs";
import { refreshGateFreshness, stageRunLimitFor } from "./run-activity.mjs";

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
    diagnoseRunFailure,
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
    /**
     * Attribution for a run that failed outright, as opposed to a candidate that failed a gate.
     * Observed live on AH-030: a work package that fails its own verification manifest throws
     * from `orchestrator-work-packages.mjs` and lands here, never reaching the gate/repair path
     * where diagnosis was originally wired — so the likeliest way a task dies was the one way it
     * was never attributed. Optional so every existing construction keeps working untouched.
     */
    this._diagnoseRunFailure = diagnoseRunFailure ?? (async () => {});
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
      // Attribution runs before the failure is recorded, because the update below clears
      // `activeRunKind` and the diagnosis agent executes under the live run reservation — the
      // same ordering the gate-path diagnosis already relies on.
      //
      // Scoped to implementation deliberately. An investigation, specification or planning stage
      // that throws *is* the failure: there is no upstream chain to attribute it to that is not
      // already the current stage, so a model call there would buy nothing. A failed
      // implementation run is the one that carries a plan, a specification and an environment
      // behind it, and the one AH-030 showed was going unattributed.
      // Narrower still than "an implementation run failed": only a package that could not qualify
      // against its own verification manifest. That is the failure AH-030 exposed and the only one
      // with an upstream chain worth attributing. A candidate assembly conflict, a target that
      // moved, a cancelled run — those are mechanical, and spending a model call on them would buy
      // nothing while adding a model call to paths that never had one.
      const qualificationFailure = /did not qualify/i.test(error?.message ?? "");
      if (!signal.aborted && kind === "implementation" && qualificationFailure) {
        let rewound = false;
        try {
          rewound = await this._diagnoseRunFailure(id, signal, { kind, error });
        } catch {
          /* Attribution is additive. A failed diagnosis must not mask the original failure. */
        }
        // A rewind has already restated the task at an earlier stage. Recording the failure on
        // top of that would overwrite the destination with the failure it came from.
        if (rewound) return;
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
      // Attribution happens after the failure is recorded, so a diagnosis that itself fails
      // leaves exactly the state this handler already produced rather than stranding the task.
      // It classifies and may rewind; it never repairs.
    }
  }
}
