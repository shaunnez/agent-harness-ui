import { refreshGateFreshness, stageRunLimitFor } from "./run-activity.mjs";

import { MergeRecoveryOrchestrator } from "./orchestrator-merge-recovery.mjs";
import { now, activity } from "./orchestrator-stage-support.mjs";
import { sameCandidateTestRetryContext, currentCandidate } from "./orchestrator-run-policy.mjs";
import { recordApproval } from "./orchestrator-task-helpers.mjs";

export class CandidateOperationsOrchestrator extends MergeRecoveryOrchestrator {
  async refreshCandidate(id) {
    if (this._refreshActive.has(id) || this._mergeActive.has(id)) {
      throw new Error("This task already has a candidate or merge reconciliation in progress.");
    }
    this._refreshActive.add(id);
    try {
      const task = await this._store.get(id);
      if (!task) throw new Error("Task not found.");
      const candidate = currentCandidate(task);
      const legacyTargetDivergence =
        task.status === "blocked" &&
        /target ref (?:diverged|moved)|target branch advanced/i.test(task.error ?? "");
      if (
        task.status !== "blocked" ||
        (task.blocker?.code !== "target-diverged" && !legacyTargetDivergence)
      ) {
        throw new Error("The task is not blocked by an advanced target branch.");
      }
      if (!candidate?.headRevision)
        throw new Error("The task does not have a refreshable candidate revision.");
      let refreshed;
      try {
        const remoteTargetRevision =
          task.blocker?.source === "github" && typeof this._github.fetchTarget === "function"
            ? await this._github.fetchTarget(candidate, {
                remoteName: task.pullRequestIntent?.remoteName ?? task.blocker?.remoteName ?? "origin",
              })
            : null;
        refreshed = await this._worktrees.refreshCandidate(
          candidate,
          remoteTargetRevision ? { targetRevision: remoteTargetRevision } : undefined,
        );
      } catch (error) {
        if (/candidate refresh conflicted/i.test(error.message)) {
          await this._store.update(id, (draft) => {
            const activeCandidate = currentCandidate(draft);
            if (
              activeCandidate.id !== candidate.id ||
              activeCandidate.revisionNumber !== candidate.revisionNumber
            )
              return;
            draft.status = "blocked";
            draft.error = error.message;
            draft.blocker = {
              code: "target-refresh-conflict",
              detail: error.message,
              detectedAt: now(),
              candidateId: candidate.id,
              candidateRevision: candidate.revisionNumber,
              candidateBaseRevision: candidate.baseRevision,
            };
            draft.events.push(
              activity(
                "implement",
                "Candidate refresh needs a clean rebuild",
                "The target and retained patch overlap. Re-run the approved work packages from the latest target instead of guessing a conflict resolution.",
                "warning",
                "decision",
              ),
            );
          });
        }
        throw error;
      }
      const nextRevision = candidate.revisionNumber + 1;
      try {
        return await this._store.transition(
          id,
          (draft) => {
            const activeCandidate = currentCandidate(draft);
            return (
              draft.status === "blocked" &&
              activeCandidate.id === candidate.id &&
              activeCandidate.revisionNumber === candidate.revisionNumber &&
              activeCandidate.baseRevision === refreshed.previousBaseRevision &&
              activeCandidate.headRevision === refreshed.previousHeadRevision
            );
          },
          (draft) => {
            const activeCandidate = currentCandidate(draft);
            activeCandidate.revisionNumber = nextRevision;
            activeCandidate.baseRevision = refreshed.targetRevision;
            activeCandidate.headRevision = refreshed.headRevision;
            activeCandidate.status = "ready_for_review";
            activeCandidate.updatedAt = now();
            activeCandidate.revisions.push({
              number: nextRevision,
              headRevision: refreshed.headRevision,
              reason: "target-refresh",
              previousBaseRevision: refreshed.previousBaseRevision,
              previousHeadRevision: refreshed.previousHeadRevision,
              baseRevision: refreshed.targetRevision,
              createdAt: now(),
            });
            draft.status = "ready-for-review";
            draft.currentStage = "dev-review";
            draft.error = null;
            draft.blocker = null;
            if (draft.mergeIntent) {
              draft.mergeIntentHistory ??= [];
              draft.mergeIntentHistory.push({
                ...structuredClone(draft.mergeIntent),
                status: "failed",
                error:
                  draft.mergeIntent.error ??
                  "The target advanced; the approved candidate revision was superseded by target refresh.",
                supersededAt: now(),
                supersededByCandidateRevision: nextRevision,
              });
            }
            draft.mergeIntent = null;
            if (draft.pullRequestIntent) {
              draft.pullRequestIntentHistory ??= [];
              draft.pullRequestIntentHistory.push({
                ...structuredClone(draft.pullRequestIntent),
                status: "failed",
                lastError:
                  draft.pullRequestIntent.lastError ??
                  "The GitHub target advanced; this PR intent was superseded by target refresh.",
                supersededAt: now(),
                supersededByCandidateRevision: nextRevision,
              });
            }
            draft.pullRequestIntent = null;
            draft.completedStages = draft.completedStages.filter(
              (stage) => !["dev-review", "test", "final-review", "approval"].includes(stage),
            );
            refreshGateFreshness(draft);
            draft.events.push(
              activity(
                "implement",
                "Candidate refreshed from target",
                refreshed.alreadyApplied
                  ? `${candidate.id} revision ${nextRevision} records that its complete patch is already present at target ${refreshed.targetRevision.slice(0, 8)}. Every candidate-bound gate must still pass again.`
                  : `${candidate.id} revision ${nextRevision} now starts from ${refreshed.targetRevision.slice(0, 8)} and must pass every candidate-bound gate again.`,
                "success",
                "decision",
              ),
            );
          },
        );
      } catch (error) {
        if (typeof this._worktrees.recoverCandidate === "function")
          await this._worktrees.recoverCandidate(candidate);
        throw error;
      }
    } finally {
      this._refreshActive.delete(id);
    }
  }

  async rebuildCandidateFromTarget(id) {
    if (this._refreshActive.has(id) || this._mergeActive.has(id)) {
      throw new Error("This task already has a candidate or merge reconciliation in progress.");
    }
    this._refreshActive.add(id);
    try {
      const task = await this._store.get(id);
      if (!task) throw new Error("Task not found.");
      const candidate = currentCandidate(task);
      if (task.status !== "blocked" || task.blocker?.code !== "target-refresh-conflict") {
        throw new Error("The task is not blocked by a candidate refresh conflict.");
      }
      if (task.activeRunKind || task.activeRunReservationId) {
        throw new Error("Wait for the active run before rebuilding this candidate.");
      }
      if (
        typeof this._worktrees.mergeState !== "function" ||
        (await this._worktrees.mergeState(candidate)) !== "diverged"
      ) {
        throw new Error("The candidate target is no longer diverged; refresh task state before rebuilding.");
      }
      return await this._store.transition(
        id,
        (draft) => {
          const activeCandidate = currentCandidate(draft);
          return (
            draft.status === "blocked" &&
            draft.blocker?.code === "target-refresh-conflict" &&
            activeCandidate.id === candidate.id &&
            activeCandidate.revisionNumber === candidate.revisionNumber &&
            activeCandidate.headRevision === candidate.headRevision
          );
        },
        (draft) => {
          const activeCandidate = currentCandidate(draft);
          activeCandidate.status = "superseded";
          activeCandidate.updatedAt = now();
          for (const workPackage of draft.workPackages ?? []) {
            workPackage.status = "planned";
            workPackage.error = null;
            workPackage.retainedContinuation = null;
            workPackage.retainedForRequalification = false;
            workPackage.retainedReplacementReason = null;
            workPackage.verificationRuns = [];
          }
          const attempts = draft.attemptsByStage?.implement ?? 0;
          draft.stageRunLimits ??= {};
          draft.stageRunLimits.implement = Math.max(stageRunLimitFor(draft, "implement"), attempts + 1);
          draft.status = "ready-for-implementation";
          draft.currentStage = "implement";
          draft.error = null;
          draft.blocker = null;
          draft.mergeIntent = null;
          draft.completedStages = draft.completedStages.filter(
            (stage) => !["implement", "dev-review", "test", "final-review", "approval"].includes(stage),
          );
          refreshGateFreshness(draft);
          draft.events.push(
            activity(
              "implement",
              "Clean candidate rebuild authorized",
              `${candidate.id} remains retained for audit. The approved packages will run again from the latest target and assemble a new candidate.`,
              "warning",
              "decision",
            ),
          );
        },
      );
    } finally {
      this._refreshActive.delete(id);
    }
  }

  async restartImplementationFromTarget(id) {
    if (this._refreshActive.has(id) || this._mergeActive.has(id)) {
      throw new Error("This task already has a candidate or target reconciliation in progress.");
    }
    this._refreshActive.add(id);
    try {
      const task = await this._store.get(id);
      if (!task) throw new Error("Task not found.");
      if (!["failed", "blocked"].includes(task.status) || task.currentStage !== "implement") {
        throw new Error("The task is not stopped during implementation.");
      }
      if (task.activeRunKind || task.activeRunReservationId) {
        throw new Error("Wait for the active run before restarting implementation.");
      }
      if (task.candidates?.length) {
        throw new Error("This task already has a candidate; use candidate refresh or rebuild instead.");
      }
      const target = await this._worktrees.base(task, { allowDirty: true });
      const attemptedBases = new Set(
        (task.workPackages ?? []).map((workPackage) => workPackage.baseRevision).filter(Boolean),
      );
      if (!attemptedBases.size || [...attemptedBases].every((revision) => revision === target.baseRevision)) {
        throw new Error("The implementation packages already use the latest target revision.");
      }
      return await this._store.transition(
        id,
        (draft) =>
          ["failed", "blocked"].includes(draft.status) &&
          draft.currentStage === "implement" &&
          !draft.activeRunKind &&
          !draft.activeRunReservationId &&
          !draft.candidates?.length,
        (draft) => {
          for (const workPackage of draft.workPackages ?? []) {
            workPackage.status = "planned";
            workPackage.error = null;
            workPackage.retainedContinuation = null;
            workPackage.retainedForRequalification = false;
            workPackage.retainedReplacementReason = null;
            workPackage.verificationRuns = [];
          }
          const attempts = draft.attemptsByStage?.implement ?? 0;
          draft.stageRunLimits ??= {};
          draft.stageRunLimits.implement = Math.max(stageRunLimitFor(draft, "implement"), attempts + 1);
          draft.status = "ready-for-implementation";
          draft.error = null;
          draft.blocker = null;
          draft.events.push(
            activity(
              "implement",
              "Implementation restart authorized from latest target",
              `Prior slice artifacts remain retained. Approved packages will restart from ${target.baseRevision.slice(0, 8)} with bounded concurrency and fresh qualification.`,
              "warning",
              "decision",
            ),
          );
        },
      );
    } finally {
      this._refreshActive.delete(id);
    }
  }

  async retryTestOnSameCandidate(id) {
    const started = await this.start(id, "test", {
      canStart: (draft) => {
        sameCandidateTestRetryContext(draft);
        return true;
      },
      onReserve: (draft) => {
        const context = sameCandidateTestRetryContext(draft);
        context.verification.retryDisposition = "human-rerun-requested";
        context.verification.retryRequestedAt = now();
        draft.sameCandidateTestRetries ??= [];
        draft.sameCandidateTestRetries.push({
          id: crypto.randomUUID(),
          candidateId: context.candidate.id,
          candidateRevision: context.candidate.revisionNumber,
          candidateHeadRevision: context.candidate.headRevision,
          failedVerificationCompletedAt: context.verification.completedAt ?? null,
          requestedAt: now(),
        });
        const attempts = draft.attemptsByStage?.test ?? 0;
        draft.stageRunLimits ??= {};
        draft.stageRunLimits.test = Math.max(stageRunLimitFor(draft, "test"), attempts + 1);
        context.candidate.status = "ready_for_test";
        draft.status = "ready-for-test";
        draft.currentStage = "test";
        draft.error = null;
        draft.blocker = null;
        draft.completedStages = draft.completedStages.filter(
          (stage) => !["test", "final-review", "approval"].includes(stage),
        );
        refreshGateFreshness(draft);
        draft.events.push(
          activity(
            "test",
            "Same-candidate Test retry authorized",
            `${context.candidate.id} revision ${context.candidate.revisionNumber} is unchanged. The failed full manifest will run once more without authorizing candidate repair.`,
            "warning",
            "decision",
          ),
        );
      },
    });
    if (!started) throw new Error("The same-candidate Test retry could not be reserved.");
    return { started: true };
  }

  async _finalizeMerge(id) {
    return this._store.transition(
      id,
      (draft) => draft.status === "merging" && draft.mergeIntent?.status === "pending",
      (draft) => {
        const activeCandidate = currentCandidate(draft);
        const approvedAt = now();
        const approvalNote = draft.mergeIntent.note;
        draft.approvals ??= [];
        const approval = {
          id: crypto.randomUUID(),
          stage: "approval",
          note: approvalNote,
          createdAt: approvedAt,
        };
        draft.approvals.push(approval);
        activeCandidate.status = "merged";
        activeCandidate.updatedAt = approvedAt;
        draft.status = "merged-to-target";
        draft.currentStage = "approval";
        if (!draft.completedStages.includes("approval")) draft.completedStages.push("approval");
        draft.mergeIntent.status = "completed";
        draft.mergeIntent.completedAt = approvedAt;
        draft.mergeIntent.error = null;
        draft.error = null;
        const approvalArtifact = {
          id: crypto.randomUUID(),
          stage: "approval",
          name: `approval-${activeCandidate.id.toLowerCase()}-r${activeCandidate.revisionNumber}.md`,
          kind: "markdown",
          content: `# Human approval and merge\n\n- Candidate: ${activeCandidate.id} revision ${activeCandidate.revisionNumber}\n- Repository: ${draft.repositoryPath}\n- Target branch: ${activeCandidate.baseBranch}\n- Merge method: fast-forward only\n- Base revision: ${activeCandidate.baseRevision}\n- Merged revision: ${activeCandidate.headRevision}\n- Approved at: ${approvedAt}\n- Note: ${approvalNote || "Approved without an additional note."}`,
          createdAt: approvedAt,
          model: "Human approval",
          usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0 },
          candidateId: activeCandidate.id,
          candidateRevision: activeCandidate.revisionNumber,
        };
        draft.artifacts.push(approvalArtifact);
        draft.events.push(
          activity(
            "approval",
            "Human approval recorded",
            approvalNote || "Approved without an additional note.",
            "success",
            "decision",
            { approvalId: approval.id },
          ),
        );
        draft.events.push(
          activity("approval", "Approval artifact ready", approvalArtifact.name, "success", "artifact", {
            artifactId: approvalArtifact.id,
            approvalId: approval.id,
          }),
        );
        draft.events.push(
          activity(
            "approval",
            "Candidate merged",
            `${activeCandidate.id} fast-forwarded ${activeCandidate.baseBranch} to ${activeCandidate.headRevision.slice(0, 8)}.`,
            "success",
            "decision",
            { approvalId: approval.id },
          ),
        );
      },
    );
  }

  async completeMergedTask(id, note = "") {
    const task = await this._store.get(id);
    if (!task) throw new Error("Task not found.");
    if (task.status !== "merged-to-target") throw new Error("The task is not merged to its target branch.");
    const candidate = currentCandidate(task);
    if (candidate?.status !== "merged")
      throw new Error("The task does not have a merged candidate to promote.");
    return this._store.transition(
      id,
      (draft) => draft.status === "merged-to-target",
      (draft) => {
        const approvedAt = now();
        const activeCandidate = currentCandidate(draft);
        recordApproval(draft, "promotion", note);
        draft.status = "completed";
        draft.completedAt = approvedAt;
        draft.events.push(
          activity(
            "approval",
            "Task marked completed",
            `${activeCandidate.id} revision ${activeCandidate.revisionNumber} was promoted onward from ${activeCandidate.baseBranch}.`,
            "success",
            "decision",
          ),
        );
      },
    );
  }
}
