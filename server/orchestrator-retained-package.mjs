import { throwIfAborted } from "./orchestrator-run-policy.mjs";
import { activity, now, workPackageVerificationMarkdown } from "./orchestrator-stage-support.mjs";
import { requireActiveRunReservation } from "./orchestrator-task-helpers.mjs";
import { beginAgentRun, completeAgentRun } from "./run-activity.mjs";

export class RetainedPackageOrchestrator {
  constructor({ store, worktrees, readVerificationManifestAtRevision, qualifyPackage, retainAgentResult }) {
    this._store = store;
    this._worktrees = worktrees;
    this._readVerificationManifestAtRevision = readVerificationManifestAtRevision;
    this._qualifyPackage = qualifyPackage;
    this._retainAgentResult = retainAgentResult;
  }

  async requalify(id, workPackageId, signal) {
    let task = await this._store.get(id);
    const workPackage = task.workPackages.find((item) => item.id === workPackageId);
    if (!workPackage?.headRevision || !workPackage.worktreePath) {
      throw new Error(`${workPackageId} has no exact retained slice to requalify.`);
    }
    const retained = await this._worktrees.inspectRetainedSlice(workPackage, {
      ownedPaths: workPackage.ownedPaths,
      requireClean: true,
    });
    throwIfAborted(signal);
    const manifestSourceRevision = (await this._worktrees.base(task, { allowDirty: true })).baseRevision;
    const manifest = await this._readVerificationManifestAtRevision(
      task.repositoryPath,
      manifestSourceRevision,
    );
    const qualification = await this._qualifyPackage({
      worktreePath: retained.worktreePath,
      workPackage,
      workPackageId,
      attempt: workPackage.attempts,
      headRevision: retained.headRevision,
      signal,
      manifest,
    });
    qualification.manifestSourceRevision = manifestSourceRevision;
    throwIfAborted(signal);
    if (qualification.status !== "passed") {
      await this._store.update(id, (draft) => {
        const target = draft.workPackages.find((item) => item.id === workPackageId);
        target.verificationRuns ??= [];
        target.verificationRuns.push(qualification);
        target.status = "failed";
        target.error = `${workPackageId} retained slice did not qualify under the corrected verification plan.`;
      });
      const failed = qualification.rows?.find((row) => row.status !== "passed");
      throw new Error(
        `${workPackageId} retained slice did not qualify: ${failed?.id ?? "repository verification"} failed${failed?.failureDetails ? ` — ${failed.failureDetails}` : "."}`,
      );
    }
    const startedAt = now();
    let runId = null;
    await this._store.update(id, (draft) => {
      const reservation = requireActiveRunReservation(draft, "implementation", "implement");
      const run = beginAgentRun(draft, {
        kind: "implementation",
        provider: reservation.provider,
        stage: "implement",
        role: "implement",
        model: null,
        reasoning: null,
        startedAt,
        candidateId: null,
        candidateRevision: null,
        candidateHeadRevision: null,
        workPackageId,
        workflowAttempt: reservation.workflowAttempt,
        workflowReservationId: reservation.id,
      });
      run.source = "harness-requalification";
      runId = run.id;
      completeAgentRun(draft, run.id, {
        status: "completed",
        completedAt: now(),
        durationMs: qualification.durationMs ?? 0,
        usage: null,
        runtimeEvents: [],
        error: null,
      });
    });
    const content = `## Outcome\n\n${workPackageId} reused its exact clean retained commit after the corrected repository verification plan passed. No model implementation was rerun.\n\n${workPackageVerificationMarkdown(qualification)}\n\n## Harness retained-slice evidence\n\n- Work package: ${workPackageId}\n- Base: ${workPackage.baseRevision}\n- Package commit: ${retained.headRevision}\n- Branch: ${retained.branch}\n- Verification manifest source revision: ${manifestSourceRevision}\n- Changed files: ${retained.files.length}`;
    await this._retainAgentResult(
      id,
      "implement",
      {
        runId,
        finalText: content,
        startedAt,
        completedAt: now(),
        durationMs: qualification.durationMs ?? 0,
        usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0 },
        runtimeEvents: [],
      },
      {
        synthetic: true,
        complete: false,
        replace: false,
        name: `slice-${workPackageId.toLowerCase()}-retained-requalification.md`,
        workPackageId,
        focusedTestEvidence: qualification,
        artifactTitle: `${workPackageId} retained slice requalified`,
      },
    );
    task = await this._store.get(id);
    await this.cleanup(id, task, retained.worktreePath);
    await this._store.update(id, (draft) => {
      const target = draft.workPackages.find((item) => item.id === workPackageId);
      target.status = "ready_for_integration";
      target.verificationRuns ??= [];
      target.verificationRuns.push(qualification);
      target.error = null;
      target.retainedForRequalification = false;
      draft.events.push(
        activity(
          "implement",
          `${workPackageId} retained commit ready for integration`,
          `${retained.headRevision.slice(0, 8)} passed the corrected focused repository verification without another model implementation run.`,
          "success",
          "decision",
        ),
      );
    });
  }

  async cleanup(id, task, worktreePath) {
    try {
      await this._worktrees.removeWorktree({ worktreePath, repositoryRoot: task.repositoryPath });
    } catch (error) {
      await this._store.update(id, (draft) => {
        draft.events.push(
          activity(
            "implement",
            "Worktree cleanup skipped",
            `${worktreePath}: ${error.message}`,
            "warning",
            "activity",
          ),
        );
      });
    }
  }
}
