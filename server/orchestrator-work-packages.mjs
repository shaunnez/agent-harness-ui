import { currentCandidate, throwIfAborted } from "./orchestrator-run-policy.mjs";
import {
  activity,
  allSettledWithConcurrency,
  FastProfileReplanError,
  now,
  workPackageVerificationMarkdown,
} from "./orchestrator-stage-support.mjs";
import {
  dependencyClosure,
  parseNoChangesNeeded,
  requireActiveRunReservation,
} from "./orchestrator-task-helpers.mjs";
import { buildWorkPackageRequest } from "./prompts.mjs";
import { refreshGateFreshness } from "./run-activity.mjs";
import { fastEscalation } from "./workflow-profiles.mjs";

export class WorkPackageOrchestrator {
  constructor({
    store,
    worktrees,
    packageConcurrency,
    runPackageVerification,
    readVerificationManifestAtRevision,
    assertExecutablePlan,
    qualifyPackage,
    requalifyRetainedPackage,
    cleanupSliceWorktree,
    escalateProfile,
    executeAgent,
    retainAgentResult,
  }) {
    this._store = store;
    this._worktrees = worktrees;
    this._packageConcurrency = packageConcurrency;
    this._runPackageVerification = runPackageVerification;
    this._readVerificationManifestAtRevision = readVerificationManifestAtRevision;
    this._assertExecutablePlan = assertExecutablePlan;
    this._qualifyPackage = qualifyPackage;
    this._requalifyRetainedWorkPackage = requalifyRetainedPackage;
    this._cleanupSliceWorktree = cleanupSliceWorktree;
    this._escalateProfile = escalateProfile;
    this._executeAgent = executeAgent;
    this._retainAgentResult = retainAgentResult;
  }
  async _runImplementation(id, signal) {
    let task = await this._store.get(id);
    await this._assertExecutablePlan(task);
    const retainedPackage = task.workPackages.find(
      (item) =>
        item.retainedContinuation || item.retainedForRequalification || item.retainedReplacementReason,
    );
    // Implementation is isolated from the operator's checkout at an exact committed
    // HEAD. Unrelated local edits must remain untouched, but they do not make that
    // commit unsafe to use as a worktree base. Human Approval still requires the
    // target checkout to be clean before merge.
    const base = await this._worktrees.base(task, { allowDirty: true });
    const batchNumbers = [...new Set(task.workPackages.map((item) => item.batch))].sort((a, b) => a - b);
    for (const batch of batchNumbers) {
      throwIfAborted(signal);
      task = await this._store.get(id);
      const packages = task.workPackages.filter(
        (item) =>
          item.batch === batch && item.status !== "ready_for_integration" && item.status !== "integrated",
      );
      if (!packages.length) continue;
      const blocked = packages.find((item) =>
        item.dependencies.some((dependency) => {
          const dependencyPackage = task.workPackages.find((candidate) => candidate.id === dependency);
          return !["ready_for_integration", "integrated"].includes(dependencyPackage?.status);
        }),
      );
      if (blocked)
        throw new Error(`${blocked.id} cannot start because one or more dependency packages are not ready.`);
      await this._store.update(id, (draft) => {
        draft.events.push(
          activity(
            "implement",
            `Dependency batch ${batch} started`,
            `${packages.map((item) => item.id).join(", ")} running in isolated worktrees.`,
            "info",
            "agent",
          ),
        );
      });
      const outcomes = await allSettledWithConcurrency(packages, this._packageConcurrency, (workPackage) =>
        this._runWorkPackage(id, workPackage.id, base.baseRevision, signal),
      );
      const failures = outcomes
        .map((outcome, index) => ({ outcome, workPackage: packages[index] }))
        .filter((entry) => entry.outcome.status === "rejected");
      if (failures.length) {
        const fastReplan = failures.find(
          (entry) => entry.outcome.reason?.code === "FAST_PROFILE_REPLAN_REQUIRED",
        );
        if (fastReplan) throw fastReplan.outcome.reason;
        throw new Error(
          failures
            .map(
              (entry) =>
                `${entry.workPackage.id}: ${entry.outcome.reason?.message ?? "implementation failed"}`,
            )
            .join(" | "),
        );
      }
      await this._store.update(id, (draft) => {
        draft.events.push(
          activity(
            "implement",
            `Dependency batch ${batch} qualified`,
            `${packages.map((item) => item.id).join(", ")} ready for integration.`,
            "success",
            "decision",
          ),
        );
      });
    }

    throwIfAborted(signal);
    task = await this._store.get(id);
    const orderedPackages = [...task.workPackages].sort(
      (a, b) => a.batch - b.batch || a.id.localeCompare(b.id),
    );
    if (
      orderedPackages.some((item) => item.status !== "ready_for_integration" && item.status !== "integrated")
    ) {
      throw new Error("Candidate assembly cannot start until every work package is ready for integration.");
    }
    const candidateId = `C${(task.candidates?.length ?? 0) + 1}`;
    const implementationReservation = requireActiveRunReservation(task, "implementation", "implement");
    const candidate = await this._worktrees.prepare(task, candidateId, {
      baseRevision: base.baseRevision,
      allowHistoricalBase: Boolean(retainedPackage),
      allowDirtySource: true,
    });
    candidate.status = "assembling";
    candidate.verificationRuns = [];
    candidate.sourceWorkflowAttempt = implementationReservation.workflowAttempt;
    candidate.sourceWorkflowReservationId = implementationReservation.id;
    candidate.members = orderedPackages.map((item, index) => ({
      packageId: item.id,
      headRevision: item.headRevision,
      order: index + 1,
    }));
    await this._store.update(id, (draft) => {
      draft.currentStage = "implement";
      draft.candidates ??= [];
      draft.candidates.push(candidate);
      draft.events.push(
        activity(
          "implement",
          "Candidate assembly started",
          `${candidate.id} will apply ${candidate.members.map((item) => item.packageId).join(" -> ")}.`,
          "info",
          "agent",
        ),
      );
    });
    const assembled = await this._worktrees.assemble(candidate, candidate.members);
    const manifest = candidate.members
      .map(
        (member) => `- ${member.order}. ${member.packageId}: ${member.headRevision ?? "no changes needed"}`,
      )
      .join("\n");
    const content = `## Outcome\n\nAll ${candidate.members.length} work packages were assembled into ${candidate.id}.\n\n## Candidate membership\n\n${manifest}\n\n## Harness candidate evidence\n\n- Candidate: ${candidate.id} revision 1\n- Base: ${candidate.baseRevision}\n- Head: ${assembled.headRevision}\n- Branch: ${candidate.branch}\n- Changed files: ${assembled.files.length}\n\n\`\`\`text\n${assembled.summary || "No diff stat returned."}\n\`\`\`\n\nThe exact candidate patch is loaded on demand from the recorded revision.`;
    await this._retainAgentResult(
      id,
      "implement",
      {
        finalText: content,
        usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0 },
        runtimeEvents: [],
      },
      {
        replace: false,
        name: `candidate-${candidate.id.toLowerCase()}-r1.md`,
        candidateId,
        candidateRevision: 1,
        synthetic: true,
      },
    );
    await this._store.update(id, (draft) => {
      const activeCandidate = currentCandidate(draft);
      activeCandidate.headRevision = assembled.headRevision;
      activeCandidate.status = "ready_for_review";
      activeCandidate.updatedAt = now();
      activeCandidate.revisions.push({
        number: 1,
        headRevision: assembled.headRevision,
        reason: "assembly",
        sourceWorkflowAttempt: implementationReservation.workflowAttempt,
        sourceWorkflowReservationId: implementationReservation.id,
        sourceWorkflowReservedAt: implementationReservation.reservedAt,
        createdAt: now(),
      });
      for (const workPackage of draft.workPackages) workPackage.status = "integrated";
      draft.status = "ready-for-review";
      draft.currentStage = "dev-review";
      draft.activeRunKind = null;
      draft.activeRunReservationId = null;
      refreshGateFreshness(draft);
      draft.events.push(
        activity(
          "implement",
          "Integration candidate ready",
          `${candidate.id} @ ${assembled.headRevision.slice(0, 8)} contains ${candidate.members.length} work packages and is ready for development review.`,
          "success",
          "artifact",
        ),
      );
    });
  }

  async _runWorkPackage(id, workPackageId, baseRevision, signal) {
    let task = await this._store.get(id);
    const workPackage = task.workPackages.find((item) => item.id === workPackageId);
    if (workPackage.retainedForRequalification) {
      await this._requalifyRetainedWorkPackage(id, workPackageId, signal);
      return;
    }
    const retainedContinuation = workPackage.retainedContinuation ?? null;
    const attempt = retainedContinuation ? workPackage.attempts : workPackage.attempts + 1;
    const dependencyIds = dependencyClosure(workPackage, task.workPackages);
    const dependencyRevisions = task.workPackages
      .filter((item) => dependencyIds.includes(item.id))
      .sort((a, b) => a.batch - b.batch || a.id.localeCompare(b.id))
      .map((item) => item.headRevision)
      // A dependency that legitimately made no changes has no commit to bring in.
      .filter(Boolean);
    const sliceId = `${workPackage.id}-A${attempt}`;
    try {
      // The previous attempt's worktree, if any, is permanently superseded the moment a
      // retry starts — nothing reads it again — and every worktree left behind spends
      // this repository's shared exec-argument budget (see claude-exec-budget.mjs).
      // Kept around for exactly one generation past its own failure, for inspection,
      // and reaped here rather than immediately on failure.
      if (workPackage.worktreePath && !retainedContinuation) {
        await this._cleanupSliceWorktree(id, task, workPackage.worktreePath);
      }
      const slice = retainedContinuation
        ? {
            id: sliceId,
            baseRevision: workPackage.baseRevision,
            preparedRevision: workPackage.headRevision ?? workPackage.baseRevision,
            branch: workPackage.branch,
            worktreePath: workPackage.worktreePath,
            headRevision: workPackage.headRevision,
          }
        : await this._worktrees.prepare(task, sliceId, {
            baseRevision,
            dependencyRevisions,
            branchId: sliceId,
            allowHistoricalBase: Boolean(workPackage.retainedReplacementReason),
            allowDirtySource: true,
          });
      if (retainedContinuation) {
        await this._worktrees.inspectRetainedSlice(workPackage, { requireClean: false });
      }
      await this._store.update(id, (draft) => {
        const target = draft.workPackages.find((item) => item.id === workPackageId);
        target.status = "running";
        if (!retainedContinuation) target.attempts = attempt;
        target.branch = slice.branch;
        target.worktreePath = slice.worktreePath;
        target.baseRevision = slice.baseRevision;
        target.error = null;
        draft.events.push(
          activity(
            "implement",
            retainedContinuation
              ? `${workPackageId} retained agent resumed`
              : `${workPackageId} agent started`,
            `${slice.branch} in dependency batch ${target.batch}.`,
            "info",
            "agent",
          ),
        );
      });
      task = await this._store.get(id);
      const currentPackage = task.workPackages.find((item) => item.id === workPackageId);
      const result = await this._executeAgent(
        task,
        "implement",
        signal,
        slice.worktreePath,
        "workspace-write",
        null,
        buildWorkPackageRequest(task, currentPackage, slice),
        `${workPackageId} implementation`,
        "implement",
        workPackageId,
      );
      throwIfAborted(signal);
      // Trusted only in combination with `commit`'s own status check: the marker is
      // read here, but it is `allowNoChanges` inside `commit` that actually verifies
      // the worktree is clean before treating this as a no-op. An agent that emits the
      // marker while having actually changed something still goes through the ordinary
      // commit path below.
      const noChangesNeeded = parseNoChangesNeeded(result.finalText);
      const committed = await this._worktrees.commit(
        slice,
        `agent-harness(${task.id}): ${workPackageId} ${currentPackage.title}`,
        {
          ownedPaths: currentPackage.ownedPaths,
          allowNoChanges: Boolean(noChangesNeeded),
          squashFromBase: Boolean(retainedContinuation && workPackage.headRevision),
        },
      );
      // A package that committed nothing is verified at whatever its worktree is actually on.
      // For an independent slice that is the base; for a slice stacked on a dependency it is the
      // dependency's commit. Falling back to `baseRevision` in the second case is what made a
      // dependent package fail as drifted from its own predecessor.
      const packageHeadRevision = committed.headRevision ?? slice.preparedRevision ?? slice.baseRevision;
      await this._store.update(id, (draft) => {
        const target = draft.workPackages.find((item) => item.id === workPackageId);
        target.headRevision = committed.headRevision;
        target.files = committed.files;
      });
      const pathEscalation = fastEscalation({
        profile: task.workflowProfile?.selected,
        kind: "changed-paths",
        files: committed.files,
      });
      if (pathEscalation) {
        await this._escalateProfile(id, pathEscalation, "implement");
        throw new FastProfileReplanError(
          `${pathEscalation.reason} Resume investigation so standard scout, decision, specification, and plan evidence replaces the abbreviated fast contract before more implementation.`,
          workPackageId,
        );
      }
      let qualification = null;
      if (this._runPackageVerification) {
        qualification = await this._qualifyPackage({
          worktreePath: slice.worktreePath,
          workPackage: currentPackage,
          workPackageId,
          attempt,
          headRevision: packageHeadRevision,
          signal,
        });
        throwIfAborted(signal);
        await this._store.update(id, (draft) => {
          const target = draft.workPackages.find((item) => item.id === workPackageId);
          target.verificationRuns ??= [];
          target.verificationRuns.push(qualification);
          target.headRevision = committed.headRevision;
          target.files = committed.files;
        });
        if (qualification.status !== "passed") {
          const verificationEscalation = fastEscalation({
            profile: (await this._store.get(id)).workflowProfile?.selected,
            kind: "verification-failure",
          });
          if (verificationEscalation) await this._escalateProfile(id, verificationEscalation, "implement");
          const failedEvidence = `## Harness slice evidence\n\n- Work package: ${workPackageId}\n- Attempt: ${attempt}\n- Base: ${slice.baseRevision}\n- Package commit tested: ${packageHeadRevision}\n- Branch: ${slice.branch}\n- Changed files: ${committed.files.length}`;
          const content = `${result.finalText}\n\n${workPackageVerificationMarkdown(qualification)}\n\n${failedEvidence}`;
          await this._retainAgentResult(
            id,
            "implement",
            { ...result, finalText: content },
            {
              complete: false,
              replace: false,
              name: `slice-${workPackageId.toLowerCase()}-a${attempt}.md`,
              workPackageId,
              focusedTestEvidence: qualification,
              artifactTitle: `${workPackageId} qualification failed`,
              artifactTone: "danger",
            },
          );
          if (verificationEscalation) {
            throw new FastProfileReplanError(
              `${verificationEscalation.reason} Resume investigation so the standard workflow records fresh scout, decision, specification, and plan evidence before implementation retries.`,
              workPackageId,
            );
          }
          const failed = qualification.rows?.find((row) => row.status !== "passed");
          throw new Error(
            `${workPackageId} did not qualify: ${failed?.id ?? "repository verification"} failed${failed?.failureDetails ? ` — ${failed.failureDetails}` : "."}`,
          );
        }
      }
      // The branch (or, for a no-op, the unchanged base) is all downstream assembly
      // needs; the worktree itself is done being useful the moment it lands.
      await this._cleanupSliceWorktree(id, task, slice.worktreePath);
      const evidence = committed.noChangesNeeded
        ? `## Harness slice evidence\n\n- Work package: ${workPackageId}\n- Attempt: ${attempt}\n- Dependencies: ${currentPackage.dependencies.join(", ") || "None"}\n- Base: ${slice.baseRevision}\n- Outcome: no changes needed — ${noChangesNeeded.reason}\n- Branch: ${slice.branch}\n\nNothing was committed: the base revision already satisfies this work package.`
        : `## Harness slice evidence\n\n- Work package: ${workPackageId}\n- Attempt: ${attempt}\n- Dependencies: ${currentPackage.dependencies.join(", ") || "None"}\n- Base: ${slice.baseRevision}\n- Package commit: ${committed.headRevision}\n- Branch: ${slice.branch}\n- Changed files: ${committed.files.length}\n\n\`\`\`text\n${committed.ownSummary || "No diff stat returned."}\n\`\`\`\n\nThe exact package commit remains available through Git; its full patch is not copied into downstream prompts.`;
      const content = `${result.finalText}${qualification ? `\n\n${workPackageVerificationMarkdown(qualification)}` : ""}\n\n${evidence}`;
      await this._retainAgentResult(
        id,
        "implement",
        { ...result, finalText: content },
        {
          complete: false,
          replace: false,
          name: `slice-${workPackageId.toLowerCase()}-a${attempt}.md`,
          workPackageId,
          focusedTestEvidence: qualification,
        },
      );
      await this._store.update(id, (draft) => {
        const target = draft.workPackages.find((item) => item.id === workPackageId);
        target.status = "ready_for_integration";
        target.headRevision = committed.headRevision;
        target.files = committed.files;
        target.verificationRuns ??= qualification ? [qualification] : [];
        target.error = null;
        target.retainedContinuation = null;
        target.retainedReplacementReason = null;
        draft.events.push(
          activity(
            "implement",
            `${workPackageId} ready for integration`,
            committed.noChangesNeeded
              ? `No changes needed — ${noChangesNeeded.reason}`
              : `${committed.headRevision.slice(0, 8)} changed ${committed.files.length} file${committed.files.length === 1 ? "" : "s"}.`,
            "success",
            "artifact",
          ),
        );
      });
    } catch (error) {
      await this._store.update(id, (draft) => {
        const target = draft.workPackages.find((item) => item.id === workPackageId);
        target.status = "failed";
        target.error = error.message;
        draft.events.push(
          activity("implement", `${workPackageId} failed`, error.message, "danger", "decision"),
        );
      });
      throw error;
    }
  }
}
