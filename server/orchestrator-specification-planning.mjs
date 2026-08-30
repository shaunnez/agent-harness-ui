import { stat } from "node:fs/promises";
import path from "node:path";
import { parsePlanResult } from "./structured-output.mjs";
import { selectVerificationCommands } from "./verification.mjs";
import { fastEscalation } from "./workflow-profiles.mjs";

import { now, activity } from "./orchestrator-stage-support.mjs";
import { throwIfAborted } from "./orchestrator-run-policy.mjs";
import { retainedSliceCanBeRequalified } from "./orchestrator-task-helpers.mjs";

export class SpecificationPlanningOrchestrator {
  constructor({
    store,
    worktrees,
    readVerificationManifest,
    escalateProfile,
    executeAgent,
    retainAgentResult,
    repositoryAuthority,
  }) {
    this._store = store;
    this._worktrees = worktrees;
    this._readVerificationManifest = readVerificationManifest;
    this._escalateProfile = escalateProfile;
    this._executeAgent = executeAgent;
    this._retainAgentResult = retainAgentResult;
    this._repositoryAuthority = repositoryAuthority;
  }
  async _runSpecification(id, signal) {
    const task = await this._ensureRepositoryAuthority(await this._store.get(id));
    return this._withEvidenceWorkspace(task, "specification", async (evidencePath) => {
      const result = await this._executeAgent(task, "specification", signal, evidencePath, "read-only");
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
    });
  }

  async _runPlanning(id, signal) {
    const task = await this._ensureRepositoryAuthority(await this._store.get(id));
    return this._withEvidenceWorkspace(task, "plan", async (evidencePath) => {
      const planAttempt = task.attemptsByStage?.plan ?? 1;
      const result = await this._executeAgent(task, "plan", signal, evidencePath, "read-only");
      throwIfAborted(signal);
      const artifactOptions = {
        replace: planAttempt === 1 && !task.planRevalidation,
        name:
          planAttempt === 1 && !task.planRevalidation ? undefined : `implementation-plan-r${planAttempt}.md`,
      };
      let planResult;
      let workPackages;
      try {
        planResult = parsePlanResult(result.finalText, evidencePath);
        workPackages = planResult.packages;
        if (planResult.disposition === "changes-required") {
          const verificationManifest = await this._readVerificationManifest(evidencePath);
          for (const workPackage of workPackages) {
            selectVerificationCommands(verificationManifest, workPackage.verificationCommandIds);
          }
        } else {
          for (const evidence of planResult.evidence) {
            const info = await stat(path.resolve(evidencePath, evidence.path)).catch(() => null);
            if (!info) throw new Error(`Already-satisfied evidence path does not exist: ${evidence.path}`);
          }
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
      const profileEscalation =
        planResult.disposition === "changes-required"
          ? fastEscalation({
              profile: task.workflowProfile?.selected,
              kind: "plan",
              packageCount: workPackages.length,
              dependencyCount: workPackages.reduce(
                (total, workPackage) => total + workPackage.dependencies.length,
                0,
              ),
            })
          : null;
      if (profileEscalation) await this._escalateProfile(id, profileEscalation, "plan");
      const retainedDispositions = new Map();
      if (typeof this._worktrees.retainedPatchDisposition === "function") {
        try {
          const targetRevision = task.repositoryAuthority?.selectedRevision;
          if (!targetRevision) throw new Error("Planning requires repository authority.");
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
        const planArtifact = [...draft.artifacts].reverse().find((artifact) => artifact.stage === "plan");
        draft.planResult = {
          disposition: planResult.disposition,
          evidence: planResult.evidence,
          changesRemainNecessary: planResult.disposition === "changes-required",
          artifactId: planArtifact?.id ?? null,
          repositoryAuthorityId: task.repositoryAuthority?.id ?? null,
          repositoryRevision: task.repositoryAuthority?.selectedRevision ?? null,
          repositoryTargetRef: task.repositoryAuthority?.targetRef ?? null,
          repositoryAuthorityCheckedAt: task.repositoryAuthority?.capturedAt ?? null,
          createdAt: now(),
        };
        if (draft.planRevalidation) {
          draft.planRevalidation.completedAt = now();
          draft.planRevalidation.replacementArtifactId = planArtifact?.id ?? null;
        }
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
        draft.status =
          planResult.disposition === "already-satisfied"
            ? "awaiting-already-satisfied"
            : "awaiting-plan-approval";
        draft.currentStage = "plan";
        draft.activeRunKind = null;
        draft.activeRunReservationId = null;
        const batches = workPackages.length ? Math.max(...workPackages.map((item) => item.batch)) : 0;
        draft.events.push(
          activity(
            "plan",
            planResult.disposition === "already-satisfied"
              ? "Repository evidence indicates the request is already satisfied"
              : "Implementation plan ready",
            planResult.disposition === "already-satisfied"
              ? "No work packages were created. A human must review the evidence and explicitly close the task."
              : `${workPackages.length} work package${workPackages.length === 1 ? "" : "s"} across ${batches} dependency batch${batches === 1 ? "" : "es"}.`,
            "success",
            "decision",
          ),
        );
      });
    });
  }

  async _withEvidenceWorkspace(task, stage, callback) {
    const authority = task.repositoryAuthority;
    if (!authority?.selectedRevision || typeof this._worktrees?.prepareEvidence !== "function") {
      return callback(task.repositoryPath);
    }
    const workspace = await this._worktrees.prepareEvidence(
      task,
      authority,
      `${stage}-${crypto.randomUUID()}`,
    );
    try {
      return await callback(workspace.worktreePath);
    } finally {
      await this._worktrees.removeEvidence(workspace);
    }
  }

  async _ensureRepositoryAuthority(task) {
    if (task.repositoryAuthority?.selectedRevision) return task;
    const authority = await this._repositoryAuthority.capture(task.repositoryPath, {
      frozenRevision: task.experiment?.frozenBaseSha ?? null,
    });
    return this._store.update(task.id, (draft) => {
      draft.repositoryAuthority = authority;
      draft.repositoryAuthorityHistory ??= [];
      draft.repositoryAuthorityHistory.push(authority);
      draft.repositoryAuthorityStatus = "bound";
    });
  }
}
