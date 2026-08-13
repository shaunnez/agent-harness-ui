import { parseWorkPackages } from "./structured-output.mjs";
import { selectVerificationCommands } from "./verification.mjs";
import { fastEscalation } from "./workflow-profiles.mjs";

import { now, activity } from "./orchestrator-stage-support.mjs";
import { throwIfAborted } from "./orchestrator-run-policy.mjs";
import { retainedSliceCanBeRequalified } from "./orchestrator-task-helpers.mjs";

import { InvestigationProgressionOrchestrator } from "./orchestrator-investigation.mjs";

export class SpecificationPlanningOrchestrator extends InvestigationProgressionOrchestrator {
  async _runSpecification(id, signal) {
    const task = await this._store.get(id);
    const result = await this._executeAgent(task, "specification", signal, task.repositoryPath, "read-only");
    throwIfAborted(signal);
    await this._retainAgentResult(id, "specification", result, { replace: true });
    await this._store.update(id, (draft) => {
      draft.status = "awaiting-spec-approval";
      draft.currentStage = "specification";
      draft.activeRunKind = null;
      draft.activeRunReservationId = null;
      draft.events.push(
        activity(
          "specification",
          "Specification ready for approval",
          "Review the evidence and approve or stop.",
          "success",
          "decision",
        ),
      );
    });
  }

  async _runPlanning(id, signal) {
    const task = await this._store.get(id);
    const planAttempt = task.attemptsByStage?.plan ?? 1;
    const result = await this._executeAgent(task, "plan", signal, task.repositoryPath, "read-only");
    throwIfAborted(signal);
    const artifactOptions = {
      replace: planAttempt === 1,
      name: planAttempt === 1 ? undefined : `implementation-plan-r${planAttempt}.md`,
    };
    let workPackages;
    try {
      workPackages = parseWorkPackages(result.finalText, task.repositoryPath);
      const verificationManifest = await this._readVerificationManifest(task.repositoryPath);
      for (const workPackage of workPackages) {
        selectVerificationCommands(verificationManifest, workPackage.verificationCommandIds);
      }
    } catch (error) {
      await this._retainAgentResult(id, "plan", result, {
        ...artifactOptions,
        complete: false,
        name:
          planAttempt === 1
            ? "implementation-plan-invalid.md"
            : `implementation-plan-r${planAttempt}-invalid.md`,
        artifactTitle: "Unparseable implementation plan retained",
        artifactTone: "warning",
      });
      throw error;
    }
    const profileEscalation = fastEscalation({
      profile: task.workflowProfile?.selected,
      kind: "plan",
      packageCount: workPackages.length,
      dependencyCount: workPackages.reduce(
        (total, workPackage) => total + workPackage.dependencies.length,
        0,
      ),
    });
    if (profileEscalation) await this._escalateProfile(id, profileEscalation, "plan");
    const retainedDispositions = new Map();
    if (typeof this._worktrees.retainedPatchDisposition === "function") {
      try {
        const targetRevision = (await this._worktrees.base(task, { allowDirty: true })).baseRevision;
        for (const workPackage of workPackages) {
          const prior = task.workPackages?.find((item) => item.id === workPackage.id);
          if (!retainedSliceCanBeRequalified(prior, workPackage)) continue;
          try {
            retainedDispositions.set(
              workPackage.id,
              await this._worktrees.retainedPatchDisposition(
                { ...prior, repositoryRoot: task.repositoryPath },
                targetRevision,
              ),
            );
          } catch {
            retainedDispositions.set(workPackage.id, "conflicts");
          }
        }
      } catch {
        /* Test seams without a repository retain the conservative requalification path. */
      }
    }
    await this._retainAgentResult(id, "plan", result, artifactOptions);
    await this._store.update(id, (draft) => {
      for (const workPackage of workPackages) {
        const prior = draft.workPackages?.find((item) => item.id === workPackage.id);
        if (!prior) continue;
        workPackage.attempts = Math.max(workPackage.attempts, prior.attempts ?? 0);
        if (retainedSliceCanBeRequalified(prior, workPackage)) {
          workPackage.branch = prior.branch;
          workPackage.worktreePath = prior.worktreePath;
          workPackage.baseRevision = prior.baseRevision;
          workPackage.headRevision = prior.headRevision;
          workPackage.files = [...prior.files];
          const disposition = retainedDispositions.get(workPackage.id) ?? "pending";
          const qualificationRepair = /did not qualify/i.test(prior.error ?? "");
          workPackage.retainedForRequalification = disposition === "pending" && !qualificationRepair;
          workPackage.retainedReplacementReason = disposition === "pending" ? null : disposition;
          if (disposition === "pending" && qualificationRepair) {
            workPackage.retainedContinuation = {
              requestedAt: now(),
              files: [...prior.files],
              outsideOwnership: [],
              qualificationFailure: prior.error,
            };
          }
        }
      }
      draft.workPackages = workPackages;
      draft.status = "awaiting-plan-approval";
      draft.currentStage = "plan";
      draft.activeRunKind = null;
      draft.activeRunReservationId = null;
      const batches = Math.max(...workPackages.map((item) => item.batch));
      draft.events.push(
        activity(
          "plan",
          "Implementation plan ready",
          `${workPackages.length} work package${workPackages.length === 1 ? "" : "s"} across ${batches} dependency batch${batches === 1 ? "" : "es"}.`,
          "success",
          "decision",
        ),
      );
    });
  }
}
