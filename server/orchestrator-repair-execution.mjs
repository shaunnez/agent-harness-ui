import path from "node:path";
import os from "node:os";
import { rm } from "node:fs/promises";
import {
  buildExecutionRequest,
  buildRepairRequest,
  buildStageRequest,
  getStageMetadata,
  projectRepairFindings,
} from "./prompts.mjs";
import { candidateGateCommandLimit } from "./candidate-gate-policy.mjs";
import { isProcessTimeoutError } from "./process-runtime.mjs";
import { symlinkedDependencySourceRoots } from "./git-worktree.mjs";
import { enrichUsage } from "./model-catalog.mjs";
import {
  beginAgentRun,
  DEFAULT_EXECUTION_PROVIDER,
  readExecutionProvider,
  refreshGateFreshness,
  runEventMetadata,
  runKindFor,
} from "./run-activity.mjs";

import { now, activity } from "./orchestrator-stage-support.mjs";
import {
  throwIfAborted,
  currentCandidate,
  resolveRunAgentPolicy,
  stageTimeoutMs,
} from "./orchestrator-run-policy.mjs";
import {
  assertRepairAuthorizerUnchanged,
  sameRepairReservationAuthority,
} from "./orchestrator-repair-authority.mjs";
import { requireActiveRunReservation, parseNoChangesNeeded } from "./orchestrator-task-helpers.mjs";

export class RepairExecutionOrchestrator {
  constructor({
    store,
    worktrees,
    assertProviderConfinement,
    runAgent,
    snapshotSource,
    finishAgentRun,
    retainAgentResult,
  }) {
    this._store = store;
    this._worktrees = worktrees;
    this._assertProviderConfinement = assertProviderConfinement;
    this._runAgent = runAgent;
    this._snapshotSource = snapshotSource;
    this._finishAgentRun = finishAgentRun;
    this._retainAgentResult = retainAgentResult;
  }
  async _runRepair(id, signal) {
    const task = await this._store.get(id);
    const candidate = currentCandidate(task);
    if (!["repair_required", "repairing"].includes(candidate.status)) {
      throw new Error("The current candidate is not awaiting repair.");
    }
    const recovered =
      typeof this._worktrees.recoverCandidate === "function"
        ? await this._worktrees.recoverCandidate(candidate)
        : false;
    if (recovered) {
      await this._store.update(id, (draft) => {
        draft.events.push(
          activity(
            "implement",
            "Candidate worktree recovered",
            `${candidate.id} was restored to recorded revision ${candidate.headRevision.slice(0, 8)} before repair.`,
            "warning",
            "decision",
          ),
        );
      });
    }
    await this._worktrees.verifyCandidate(candidate);
    const nextRevision = candidate.revisionNumber + 1;
    const initialRepairReservation = requireActiveRunReservation(task, "repair", "implement");
    assertRepairAuthorizerUnchanged(task, candidate, initialRepairReservation);
    const repairRequest = buildRepairRequest(task, candidate);
    if (
      repairRequest.repairEvidence.newestFailingGate.runId !== initialRepairReservation.authorizingGateRunId
    ) {
      throw new Error("The repair request drifted from its reserved authorizing gate.");
    }
    const requestedFindings = projectRepairFindings(
      repairRequest.repairEvidence.newestFailingGate.blockingFindings,
    );
    let result;
    let committed;
    let noChangesNeeded;
    try {
      result = await this._executeAgent(
        task,
        "implement",
        signal,
        candidate.worktreePath,
        "workspace-write",
        candidate,
        repairRequest,
        "Candidate repair",
        "repair",
      );
      throwIfAborted(signal);
      const beforeCommit = await this._store.get(id);
      const beforeCommitCandidate = currentCandidate(beforeCommit);
      const beforeCommitReservation = requireActiveRunReservation(beforeCommit, "repair", "implement");
      if (!sameRepairReservationAuthority(initialRepairReservation, beforeCommitReservation)) {
        throw new Error("The repair authorizing gate changed before candidate commit.");
      }
      assertRepairAuthorizerUnchanged(beforeCommit, beforeCommitCandidate, beforeCommitReservation);
      // Recorded live (AH-002): the newest failing gate's only finding was non-blocking
      // and explicitly said no code change was warranted — the repair agent correctly
      // made none, and without this marker `commit` always treats an empty diff as a
      // stuck run. Same trusted-only-with-`commit`'s-own-check caveat as the slice flow.
      noChangesNeeded = parseNoChangesNeeded(result.finalText);
      committed = await this._worktrees.commit(
        candidate,
        `agent-harness(${task.id}): repair ${candidate.id} revision ${nextRevision}`,
        { allowGeneratedDeletions: true, allowNoChanges: Boolean(noChangesNeeded) },
      );
    } catch (error) {
      if (typeof this._worktrees.recoverCandidate === "function")
        await this._worktrees.recoverCandidate(candidate);
      throw error;
    }
    // A no-op repair must not become a new revision: `candidateRevisionLineage` (and
    // everything built on it — producer evidence, retry-grant authorization) requires
    // every revision to have a *distinct* `headRevision`, and this candidate's head is,
    // by definition, unchanged. Sending it back to `ready_for_review` at its existing
    // revision — the same shape a plain re-review of stale evidence already uses —
    // asks dev-review to look again rather than fabricating an identical "new" one.
    // `commit` reports `headRevision: null` for a no-op, which is right for a work
    // package starting unattempted but wrong here regardless: the candidate's real,
    // existing head is what stays authoritative.
    const revisionLabel = committed.noChangesNeeded ? candidate.revisionNumber : nextRevision;
    const content = committed.noChangesNeeded
      ? `${result.finalText}\n\n## Harness repair evidence\n\n- Candidate: ${candidate.id} revision ${revisionLabel}\n- Head: ${candidate.headRevision} (unchanged)\n- Outcome: no changes needed — ${noChangesNeeded.reason}\n\nNothing was committed: the newest failing gate's findings required no code change.`
      : `${result.finalText}\n\n## Harness repair evidence\n\n- Candidate: ${candidate.id} revision ${revisionLabel}\n- Previous: ${candidate.headRevision}\n- Head: ${committed.headRevision}\n- Changed files in repair: ${committed.files.length}\n\n\`\`\`text\n${committed.summary || "No diff stat returned."}\n\`\`\`\n\nThe exact repaired candidate patch is loaded on demand from the recorded revision.`;
    try {
      await this._retainAgentResult(
        id,
        "implement",
        { ...result, finalText: content },
        {
          replace: false,
          name: `candidate-${candidate.id.toLowerCase()}-r${revisionLabel}-repair.md`,
          candidateId: candidate.id,
          candidateRevision: revisionLabel,
        },
      );
      await this._store.update(id, (draft) => {
        const activeCandidate = currentCandidate(draft);
        const repairReservation = requireActiveRunReservation(draft, "repair", "implement");
        if (!sameRepairReservationAuthority(initialRepairReservation, repairReservation)) {
          throw new Error("The repair authorizing gate changed before revision persistence.");
        }
        assertRepairAuthorizerUnchanged(draft, activeCandidate, repairReservation);
        if (!committed.noChangesNeeded) {
          activeCandidate.revisionNumber = nextRevision;
          activeCandidate.headRevision = committed.headRevision;
          activeCandidate.sourceWorkflowAttempt = repairReservation.workflowAttempt;
          activeCandidate.sourceWorkflowReservationId = repairReservation.id;
          activeCandidate.revisions.push({
            number: nextRevision,
            headRevision: committed.headRevision,
            reason: "repair",
            requestedFindings: structuredClone(requestedFindings),
            sourceWorkflowAttempt: repairReservation.workflowAttempt,
            sourceWorkflowReservationId: repairReservation.id,
            sourceWorkflowReservedAt: repairReservation.reservedAt,
            authorizingGateStage: repairReservation.authorizingGateStage,
            authorizingGateProvider: readExecutionProvider({
              provider: repairReservation.authorizingGateProvider,
            }),
            authorizingGateWorkflowAttempt: repairReservation.authorizingGateWorkflowAttempt,
            authorizingGateReservationId: repairReservation.authorizingGateReservationId,
            authorizingGateReservedAt: repairReservation.authorizingGateReservedAt,
            authorizingGateRunId: repairReservation.authorizingGateRunId,
            authorizingGateArtifactId: repairReservation.authorizingGateArtifactId,
            createdAt: now(),
          });
        }
        activeCandidate.status = "ready_for_review";
        activeCandidate.updatedAt = now();
        draft.completedStages = draft.completedStages.filter(
          (stage) => !["dev-review", "test", "final-review", "approval"].includes(stage),
        );
        draft.status = "ready-for-review";
        draft.currentStage = "dev-review";
        draft.activeRunKind = null;
        draft.activeRunReservationId = null;
        refreshGateFreshness(draft);
        draft.events.push(
          activity(
            "implement",
            "Repaired candidate ready",
            committed.noChangesNeeded
              ? `${candidate.id} revision ${revisionLabel} made no changes — ${noChangesNeeded.reason} — and must pass review again.`
              : `${candidate.id} revision ${revisionLabel} @ ${committed.headRevision.slice(0, 8)} must pass review again.`,
            "success",
            "artifact",
          ),
        );
      });
    } catch (error) {
      if (typeof this._worktrees.recoverCandidate === "function")
        await this._worktrees.recoverCandidate(candidate);
      throw error;
    }
  }

  async _executeAgent(
    task,
    stageId,
    signal,
    cwd,
    sandbox,
    candidate = null,
    promptOverride = null,
    eventLabel = null,
    policyId = stageId,
    workPackageId = null,
    runScopeId = null,
  ) {
    const metadata = getStageMetadata(stageId);
    // The test stage used to be the one exception here: workspace-write plus
    // `networkAccess: true`, because a model ran the verification commands itself. The
    // harness runs them now (`server/verification.mjs`), so this stage's model only reads the
    // worktree in order to interpret results the harness already observed. Read-only, no
    // network, nothing provider-specific — which is precisely what made the stage impossible
    // on Claude (#40) and dependent on Codex credits.
    const effectiveSandbox = sandbox;
    const agentRequest =
      promptOverride ??
      (candidate ? buildExecutionRequest(task, stageId, candidate) : buildStageRequest(task, stageId));
    const settings = await this._store.settings();
    const policy = resolveRunAgentPolicy(task, policyId, settings);
    const runId = crypto.randomUUID();
    const startedAt = now();
    const runRole = runScopeId ?? policyId;
    const runKind = runKindFor(stageId, runRole, workPackageId);
    const runtimeTemp = path.join(os.tmpdir(), "agent-harness", task.id, runId);
    // Stages against `task.repositoryPath` run in the operator's real working tree,
    // where there is no existing check, so it is snapshotted and required to come back
    // identical. `candidate` was the wrong proxy for that: a work package (`candidate`
    // left null, `cwd` its own isolated slice worktree) is *supposed* to leave the slice
    // dirty — that is the run succeeding — and comparing it against its pre-run status
    // would fail every successful implementation. The real distinguishing fact is
    // whether `cwd` is the operator's real checkout at all.
    const sourceSnapshot =
      cwd === task.repositoryPath ? await this._snapshotSource(policy.provider, cwd, effectiveSandbox) : null;
    let runProvider = DEFAULT_EXECUTION_PROVIDER;
    await this._store.update(task.id, (draft) => {
      const reservation = Object.values(draft.stageRunReservations ?? {}).find(
        (entry) => entry?.id === draft.activeRunReservationId,
      );
      if (!reservation || reservation.kind !== draft.activeRunKind || reservation.stage !== stageId) {
        throw new Error("The active workflow attempt is missing its persisted run reservation.");
      }
      // The reservation owns provider identity for the attempt. A run may never
      // execute on a provider other than the one its reservation reserved, so a
      // resolved policy that disagrees refuses to spawn instead of falling back.
      const reservationProvider = readExecutionProvider(reservation);
      if (policy.provider !== reservationProvider) {
        throw new Error(
          `Stage ${stageId} resolved provider ${policy.provider} but its workflow reservation is bound to ${reservationProvider}.`,
        );
      }
      runProvider = reservationProvider;
      draft.currentStage = stageId;
      const detail =
        stageId === "test"
          ? `Interpreting harness verification of ${cwd}; source changes are checked before and after the run`
          : `${sandbox === "read-only" ? "Reading" : "Working in"} ${cwd}`;
      const run = beginAgentRun(draft, {
        id: runId,
        kind: runKind,
        provider: reservationProvider,
        stage: stageId,
        role: runRole,
        model: policy.model,
        reasoning: policy.reasoning,
        startedAt,
        candidateId: candidate?.id ?? null,
        candidateRevision: candidate?.revisionNumber ?? null,
        candidateHeadRevision: candidate?.headRevision ?? null,
        workPackageId,
        workflowAttempt: reservation?.workflowAttempt ?? null,
        workflowReservationId: reservation?.id ?? null,
      });
      draft.events.push(
        activity(
          stageId,
          `${eventLabel ?? metadata.label} agent started`,
          `${detail} · ${policy.model} · ${policy.reasoning}`,
          "info",
          "agent",
          runEventMetadata(run),
        ),
      );
    });
    const runtimeEvents = [];
    const commandLimit = candidateGateCommandLimit(stageId);
    const runController = commandLimit == null ? null : new AbortController();
    let commandStarts = 0;
    let commandLimitExceeded = false;
    const relayAbort = () => runController?.abort();
    if (runController) {
      if (signal.aborted) runController.abort();
      else signal.addEventListener("abort", relayAbort, { once: true });
    }
    // `cwd` is the operator's real checkout for stages that run there, which is already
    // fully within its own allow-read scope. Only an isolated worktree (a candidate or a
    // work-package slice) can carry the symlink-into-source-checkout gap described on
    // `symlinkedDependencySourceRoots`.
    const extraReadRoots =
      cwd === task.repositoryPath
        ? []
        : await symlinkedDependencySourceRoots(
            cwd,
            typeof this._worktrees.repositoryRoot === "function"
              ? await this._worktrees.repositoryRoot(task.repositoryPath)
              : task.repositoryPath,
          ).catch(() => []);
    try {
      await this._assertProviderConfinement(runProvider, effectiveSandbox, false, cwd);
      const result = await this._runAgent(runProvider, {
        cwd,
        prompt: agentRequest.prompt,
        signal: runController?.signal ?? signal,
        sandbox: effectiveSandbox,
        // No stage grants network access any more. The only stage that ever needed it needed
        // it to run commands, and it no longer runs them.
        networkAccess: false,
        extraReadRoots,
        model: policy.model,
        reasoning: policy.reasoning,
        tempDirectory: runtimeTemp,
        timeoutMs: stageTimeoutMs(stageId, effectiveSandbox, task),
        onEvent(event) {
          if (event.type === "activity") runtimeEvents.push(event);
          if (
            commandLimit != null &&
            event.toolCall?.category === "repository-command" &&
            event.toolCall?.phase === "started"
          ) {
            commandStarts += 1;
            if (commandStarts > commandLimit && !commandLimitExceeded) {
              commandLimitExceeded = true;
              runtimeEvents.push({
                type: "activity",
                tone: "warning",
                title: "Review command budget exceeded",
                detail: `${getStageMetadata(stageId).label} attempted more than ${commandLimit} repository commands; the model run was stopped before more review cost accumulated.`,
                commandFailed: true,
                runtimeScope: "review-tooling",
              });
              runController.abort();
            }
          }
        },
      });
      if (commandLimitExceeded) {
        throw new Error(
          `${getStageMetadata(stageId).label} exceeded its hard ${commandLimit}-command review budget.`,
        );
      }
      // Before the run is recorded as completed: a stage that mutated the operator's
      // working tree produced evidence about files that were never in the tree it
      // claims to have read.
      if (sourceSnapshot) await this._worktrees.assertRepositoryUnchanged(cwd, sourceSnapshot);
      const completedAt = now();
      result.runId = runId;
      result.model = policy.model;
      result.reasoning = policy.reasoning;
      result.agentRole = policyId;
      result.contextManifest = agentRequest.contextManifest;
      result.startedAt = startedAt;
      result.completedAt = completedAt;
      result.durationMs = Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime());
      result.usage = enrichUsage(
        result.model,
        result.usage,
        settings.pricing?.rates,
        settings.pricing?.version,
      );
      result.runtimeEvents = runtimeEvents;
      await this._finishAgentRun(task.id, stageId, eventLabel ?? metadata.label, result, "completed");
      return result;
    } catch (error) {
      const failure = commandLimitExceeded
        ? new Error(
            `${getStageMetadata(stageId).label} exceeded its hard ${commandLimit}-command review budget.`,
          )
        : error;
      const completedAt = now();
      await this._finishAgentRun(
        task.id,
        stageId,
        eventLabel ?? metadata.label,
        {
          runId,
          startedAt,
          completedAt,
          durationMs: Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime()),
          runtimeEvents,
          usage: null,
          error: failure instanceof Error ? failure.message : String(failure),
        },
        signal.aborted ? "cancelled" : isProcessTimeoutError(error) ? "timed-out" : "failed",
      );
      throw failure;
    } finally {
      signal.removeEventListener?.("abort", relayAbort);
      await rm(runtimeTemp, { recursive: true, force: true });
    }
  }
}
