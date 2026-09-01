import { normalizeEvaluationInput } from "./evaluation.mjs";
import { selectWorkflowProfile, WORKFLOW_PROFILE_IDS } from "./workflow-profiles.mjs";

export function createTaskLifecycleRoutes({
  store,
  orchestrator,
  worktrees,
  continuationLocks,
  send,
  readJson,
  validateRepository,
  worktreeEntriesForTask,
  withActionEligibility,
  repositoryAuthorityService,
}) {
  return async function handleTaskLifecycleRoute(request, response, url) {
    const workflowProfileMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/workflow-profile$/);
    if (request.method === "PUT" && workflowProfileMatch) {
      const id = decodeURIComponent(workflowProfileMatch[1]);
      const input = await readJson(request);
      if (!WORKFLOW_PROFILE_IDS.includes(input.profile))
        throw new Error("Choose fast, standard, or high-risk.");
      if (typeof orchestrator.overrideWorkflowProfile !== "function")
        throw new Error("Workflow profile overrides are unavailable.");
      const task = await orchestrator.overrideWorkflowProfile(id, input.profile, String(input.reason ?? ""));
      send(response, 200, { task });
      return true;
    }

    const closeMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/close$/);
    if (request.method === "POST" && closeMatch) {
      const id = decodeURIComponent(closeMatch[1]);
      const task = await store.get(id);
      if (!task) {
        send(response, 404, { error: "Task not found." });
        return true;
      }
      if (task.status === "running") throw new Error("Cancel the active run before closing this task.");
      if (task.status === "awaiting-already-satisfied") {
        send(response, 409, {
          error: "Review the revision-bound evidence and use Close — already implemented.",
        });
        return true;
      }
      if (
        task.status === "merging" ||
        task.mergeIntent?.status === "pending" ||
        ["publishing", "open"].includes(task.pullRequestIntent?.status)
      ) {
        send(response, 409, { error: "Wait for the pending GitHub PR lifecycle before closing this task." });
        return true;
      }
      const input = await readJson(request);
      const supportedClosureReasons = ["not-needed", "superseded", "duplicate"];
      if (typeof input?.reason !== "string" || !supportedClosureReasons.includes(input.reason)) {
        throw new Error("Closure reason must be one of not-needed, superseded, or duplicate.");
      }
      const reason = input.reason;
      let supersededBy = null;
      if (reason === "superseded") {
        if (typeof input.supersededBy !== "string" || !input.supersededBy.trim()) {
          throw new Error("Superseded tasks require a nonblank supersededBy identifier.");
        }
        supersededBy = input.supersededBy.trim().slice(0, 80);
      }
      const note = String(input.note ?? "")
        .trim()
        .slice(0, 2_000);
      const closedAt = new Date().toISOString();
      let closed;
      try {
        closed = await store.transition(
          id,
          (draft) =>
            draft.status !== "running" &&
            !draft.activeRunKind &&
            draft.status !== "closed" &&
            draft.status !== "merging" &&
            draft.mergeIntent?.status !== "pending" &&
            !["publishing", "open"].includes(draft.pullRequestIntent?.status),
          (draft) => {
            draft.status = "closed";
            draft.activeRunKind = null;
            draft.error = null;
            draft.closure = { reason, supersededBy: supersededBy || null, note, closedAt };
            draft.events.push({
              id: crypto.randomUUID(),
              at: closedAt,
              category: "decision",
              tone: "info",
              stage: draft.currentStage,
              title: reason === "superseded" ? "Task marked superseded" : "Task closed",
              detail: supersededBy
                ? `Superseded by ${supersededBy}${note ? ` - ${note}` : ""}`
                : note || "No further work is required.",
            });
          },
        );
      } catch (error) {
        if (error.code !== "TASK_TRANSITION_CONFLICT") throw error;
        send(response, 409, {
          error: "Task state changed or GitHub PR reconciliation began before it could be closed.",
        });
        return true;
      }
      send(response, 200, { task: closed });
      return true;
    }

    const archiveMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/archive$/);
    if (request.method === "POST" && archiveMatch) {
      const id = decodeURIComponent(archiveMatch[1]);
      const task = await store.get(id);
      if (!task) {
        send(response, 404, { error: "Task not found." });
        return true;
      }
      if (task.status === "archived") {
        send(response, 409, { error: "This task is already archived." });
        return true;
      }
      if (["running", "cancelling"].includes(task.status) || task.activeRunKind) {
        send(response, 409, { error: "Cancel the active run before archiving this task." });
        return true;
      }
      if (
        task.status === "merging" ||
        task.mergeIntent?.status === "pending" ||
        ["publishing", "open"].includes(task.pullRequestIntent?.status)
      ) {
        send(response, 409, {
          error: "Wait for the pending GitHub PR lifecycle before archiving this task.",
        });
        return true;
      }
      const note = String((await readJson(request))?.note ?? "")
        .trim()
        .slice(0, 2_000);
      // Reclaim the worktrees, but never at the cost of work nobody has a copy of. A row is
      // discardable only when it is `cleanupReady` (present, clean, not active) or already gone
      // from disk. An entry carrying uncommitted changes is left exactly where it is and named
      // in the response, so archiving is always safe to run and never silently destructive.
      const entries = worktreeEntriesForTask(task);
      const archivedAt = new Date().toISOString();
      // The status moves *before* any worktree is touched. If the transition loses a race the
      // worktrees are still there, still listed, still removable from the inventory; the
      // opposite order would delete them and then fail, leaving nothing to point at.
      let archived;
      try {
        archived = await store.transition(
          id,
          (draft) =>
            draft.status !== "archived" &&
            draft.status !== "running" &&
            draft.status !== "cancelling" &&
            !draft.activeRunKind &&
            draft.status !== "merging" &&
            draft.mergeIntent?.status !== "pending" &&
            !["publishing", "open"].includes(draft.pullRequestIntent?.status),
          (draft) => {
            // `previousStatus` is recorded because archiving is a *visibility* decision, not a
            // verdict on the work: the status it interrupted is the only remaining evidence of
            // where the task actually stopped, and nothing else in the record preserves it.
            draft.archive = {
              archivedAt,
              previousStatus: draft.status,
              note,
              removedWorktrees: [],
              retainedWorktrees: [],
            };
            draft.status = "archived";
            draft.activeRunKind = null;
            draft.error = null;
            draft.events.push({
              id: crypto.randomUUID(),
              at: archivedAt,
              category: "decision",
              tone: "info",
              stage: draft.currentStage,
              title: "Task archived",
              detail: [`Archived from ${draft.archive.previousStatus}.`, note || null]
                .filter(Boolean)
                .join(" "),
            });
          },
        );
      } catch (error) {
        if (error.code !== "TASK_TRANSITION_CONFLICT") throw error;
        send(response, 409, { error: "Task state changed before it could be archived." });
        return true;
      }
      const rows = await worktrees.inventory(entries);
      const removed = [];
      const retained = [];
      for (const [index, row] of rows.entries()) {
        if (!row.gitExists) continue;
        if (!row.cleanupReady) {
          retained.push({
            id: row.id,
            worktreePath: row.worktreePath,
            reason: row.gitClean === false ? "uncommitted changes" : row.currentState,
          });
          continue;
        }
        await worktrees.removeWorktree({
          worktreePath: entries[index].worktreePath,
          repositoryRoot: task.repositoryPath,
        });
        removed.push({ id: row.id, worktreePath: row.worktreePath });
      }
      const recorded = await store.update(id, (draft) => {
        draft.archive.removedWorktrees = removed.map((entry) => entry.worktreePath);
        draft.archive.retainedWorktrees = retained.map((entry) => entry.worktreePath);
        if (removed.length || retained.length) {
          draft.events.push({
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            category: "decision",
            tone: retained.length ? "warning" : "info",
            stage: draft.currentStage,
            title: "Archived worktrees reclaimed",
            detail: [
              removed.length ? `${removed.length} worktree${removed.length === 1 ? "" : "s"} removed.` : null,
              retained.length
                ? `${retained.length} left in place (${retained.map((entry) => entry.reason).join(", ")}).`
                : null,
            ]
              .filter(Boolean)
              .join(" "),
          });
        }
      });
      send(response, 200, {
        task: recorded ?? archived,
        removedWorktrees: removed,
        retainedWorktrees: retained,
      });
      return true;
    }

    const evaluationMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/evaluation$/);
    if (request.method === "POST" && evaluationMatch) {
      const id = decodeURIComponent(evaluationMatch[1]);
      if (!(await store.get(id))) {
        send(response, 404, { error: "Task not found." });
        return true;
      }
      const input = await readJson(request);
      const task = await store.update(id, (draft) => {
        draft.evaluation = normalizeEvaluationInput(input, draft.evaluation);
      });
      send(response, 200, { task });
      return true;
    }

    const decisionMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/decisions$/);
    if (request.method === "POST" && decisionMatch) {
      const id = decodeURIComponent(decisionMatch[1]);
      const task = await store.get(id);
      if (!task) {
        send(response, 404, { error: "Task not found." });
        return true;
      }
      if (task.status === "running")
        throw new Error("Wait for the active agent before recording a decision.");
      const input = await readJson(request);
      if (!input.question?.trim() || !input.answer?.trim())
        throw new Error("Decision question and answer are required.");
      await orchestrator.recordDecision(id, input);
      send(response, 201, { recorded: true });
      return true;
    }

    const grillAnswerMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/grill\/answers$/);
    if (request.method === "POST" && grillAnswerMatch) {
      const id = decodeURIComponent(grillAnswerMatch[1]);
      const input = await readJson(request);
      if (!input.questionId?.trim() || !input.answer?.trim())
        throw new Error("Question ID and answer are required.");
      if (input.interactionSource !== "operator-ui") {
        throw new Error("Grill answers require an explicit operator UI action.");
      }
      input.questionId = input.questionId.trim();
      input.answer = input.answer.trim();
      await orchestrator.answerGrillQuestion(id, {
        questionId: input.questionId,
        answer: input.answer,
        source: "operator",
      });
      send(response, 201, { recorded: true });
      return true;
    }

    const finishGrillMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/grill\/finish$/);
    if (request.method === "POST" && finishGrillMatch) {
      const id = decodeURIComponent(finishGrillMatch[1]);
      const input = await readJson(request);
      if (input.interactionSource !== "operator-ui") {
        throw new Error("Finishing Grill requires an explicit operator UI action.");
      }
      const result = await orchestrator.finishGrill(id, {
        acceptRemaining: input.acceptRemaining === true,
        source: "operator",
      });
      send(response, 202, result);
      return true;
    }

    const continueImplementationMatch = url.pathname.match(
      /^\/api\/tasks\/([^/]+)\/continue-implementation$/,
    );
    if (request.method === "POST" && continueImplementationMatch) {
      const sourceId = decodeURIComponent(continueImplementationMatch[1]);
      const priorContinuation = continuationLocks.get(sourceId) ?? Promise.resolve();
      let releaseContinuation;
      const continuation = new Promise((resolve) => {
        releaseContinuation = resolve;
      });
      const continuationTail = priorContinuation.then(() => continuation);
      continuationLocks.set(sourceId, continuationTail);
      await priorContinuation;
      try {
        const source = await store.get(sourceId);
        if (!source) {
          send(response, 404, { error: "Task not found." });
          return true;
        }
        if (source.continuedByTaskId) {
          const existing = await store.get(source.continuedByTaskId);
          if (!existing) {
            send(response, 409, {
              error: `Linked implementation task ${source.continuedByTaskId} could not be found.`,
            });
            return true;
          }
          send(response, 200, { task: withActionEligibility(existing), created: false });
          return true;
        }
        if (source.workflow !== "investigate" || source.status !== "completed") {
          send(response, 409, {
            error: "Only a completed investigate-only task can continue to implementation.",
          });
          return true;
        }
        const specificationApproval = [...(source.approvals ?? [])]
          .reverse()
          .find((approval) => approval.stage === "specification");
        const specificationArtifact = [...(source.artifacts ?? [])]
          .reverse()
          .find((artifact) => artifact.stage === "specification");
        if (!specificationApproval || !specificationArtifact) {
          send(response, 409, {
            error:
              "The investigation needs an approved specification artifact before implementation can continue.",
          });
          return true;
        }

        const repositoryPath = await validateRepository(source.repositoryPath);
        const repositoryAuthority = await repositoryAuthorityService.capture(repositoryPath, {
          frozenRevision: source.experiment?.frozenBaseSha ?? null,
        });
        const settings = await store.settings();
        const selectedProfile = source.workflowProfile?.selected ?? "standard";
        const workflowProfile = selectWorkflowProfile({
          title: source.title,
          description: source.description,
          requestedProfile: selectedProfile,
        });
        const importedStages = new Set(["triage", "scouts", "grill", "specification"]);
        const importedArtifacts = (source.artifacts ?? [])
          .filter((artifact) => importedStages.has(artifact.stage))
          .map((artifact) => ({
            ...structuredClone(artifact),
            id: crypto.randomUUID(),
            runId: null,
            model: null,
            reasoning: null,
            agentRole: null,
            usage: {
              inputTokens: 0,
              cachedInputTokens: 0,
              cacheWriteTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
              cost: null,
              credits: null,
            },
            contextManifest: null,
            candidateId: null,
            candidateRevision: null,
            workPackageId: null,
            sourceTaskId: source.id,
            sourceArtifactId: artifact.id,
          }));
        const importedDecisions = (source.decisions ?? []).map((decision) => ({
          ...structuredClone(decision),
          id: crypto.randomUUID(),
          sourceTaskId: source.id,
          sourceDecisionId: decision.id,
        }));
        const continuationResult = await store.createContinuation(
          source.id,
          {
            title: `Implement: ${source.title}`.slice(0, 300),
            description: source.description,
            repositoryPath,
            workflow: "implement",
            priority: source.priority,
            model: source.agentConfig?.model ?? settings.defaultModel,
            reasoning: source.agentConfig?.reasoning ?? settings.defaultReasoning,
            stagePolicies: structuredClone(source.agentConfig?.stagePolicies ?? settings.stagePolicies),
            profileStagePolicies: structuredClone(
              source.agentConfig?.profileStagePolicies ?? settings.profileStagePolicies,
            ),
            workflowProfile,
            repositoryAuthority,
            continuation: {
              sourceTaskId: source.id,
              sourceApprovedAt: specificationApproval.createdAt,
              sourceApprovalId: specificationApproval.id,
              artifacts: importedArtifacts,
              decisions: importedDecisions,
              attachments: structuredClone(source.attachments ?? []),
              scoutDispatch: structuredClone(source.scoutDispatch ?? null),
              grillSession: structuredClone(source.grillSession ?? null),
              stageDispositions: structuredClone(source.stageDispositions ?? {}),
            },
          },
          { expectedUpdatedAt: source.updatedAt },
        );
        if (!continuationResult) {
          send(response, 404, { error: "Task not found." });
          return true;
        }
        const target = continuationResult.task;
        if (!continuationResult.created) {
          send(response, 200, { task: withActionEligibility(target), created: false });
          return true;
        }
        const started = await orchestrator.start(target.id, "planning");
        if (!started) {
          await store.update(target.id, (draft) => {
            draft.status = "failed";
            draft.currentStage = "plan";
            draft.error = "Planning did not start. Retry planning from this implementation task.";
          });
        }
        send(response, 201, { task: withActionEligibility(await store.get(target.id)), created: true });
        return true;
      } finally {
        releaseContinuation();
        if (continuationLocks.get(sourceId) === continuationTail) continuationLocks.delete(sourceId);
      }
    }

    return false;
  };
}
