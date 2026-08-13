import { buildTestInterpretationRequest, getStageMetadata } from "./prompts.mjs";
import { RUNTIME_FRESHNESS_REASONS, runEventMetadata, stageRunLimitFor } from "./run-activity.mjs";
import { parseGateEvidence, validateFocusedTestEvidence } from "./structured-output.mjs";
import { fastEscalation, isArchitecturalRisk, recordWorkflowProfile } from "./workflow-profiles.mjs";

import { now, activity } from "./orchestrator-stage-support.mjs";
import {
  throwIfAborted,
  candidateGateFailure,
  currentCandidate,
  evaluationVerdict,
  modelCommandFailed,
  structuredEvidenceError,
  evaluationRerunState,
  reserveRun,
} from "./orchestrator-run-policy.mjs";

export class GateEvaluationOrchestrator {
  constructor({
    store,
    worktrees,
    runVerification,
    completeDeterministicFastGates,
    executeAgent,
    retainAgentResult,
    runRepair,
  }) {
    this._store = store;
    this._worktrees = worktrees;
    this._runVerification = runVerification;
    this._completeDeterministicFastGates = completeDeterministicFastGates;
    this._executeAgent = executeAgent;
    this._retainAgentResult = retainAgentResult;
    this._runRepair = runRepair;
  }
  async _runReviewWithFastRepair(id, signal) {
    await this._runEvaluation(id, "dev-review", signal);
    let task = await this._store.get(id);
    const candidate = task.candidates?.at(-1);
    const repairCount = candidate?.revisions?.filter((revision) => revision.reason === "repair").length ?? 0;
    if (
      task.workflowProfile?.selected !== "fast" ||
      task.status !== "repair-required" ||
      task.currentStage !== "dev-review" ||
      candidate?.status !== "repair_required" ||
      repairCount !== 0
    )
      return;

    await this._store.transition(
      id,
      (draft) =>
        draft.workflowProfile?.selected === "fast" &&
        draft.status === "repair-required" &&
        currentCandidate(draft).status === "repair_required" &&
        (currentCandidate(draft).revisions ?? []).every((revision) => revision.reason !== "repair"),
      (draft) => {
        draft.automaticRepairCycles = (draft.automaticRepairCycles ?? 0) + 1;
        reserveRun(draft, "repair");
        draft.events.push(
          activity(
            "implement",
            "Automatic fast repair started",
            "The first consolidated Development Review defect is receiving the one allowed automatic repair cycle.",
            "warning",
            "decision",
          ),
        );
      },
    );
    await this._runRepair(id, signal);
    task = await this._store.get(id);
    if (task.status !== "ready-for-review") return;
    await this._store.transition(
      id,
      (draft) => draft.status === "ready-for-review",
      (draft) => {
        reserveRun(draft, "review");
        draft.events.push(
          activity(
            "dev-review",
            "Automatic fresh review started",
            "The repaired candidate revision must earn a new independent Development Review verdict.",
            "info",
            "decision",
          ),
        );
      },
    );
    await this._runEvaluation(id, "dev-review", signal);
  }

  async _runEvaluation(id, stageId, signal) {
    const task = await this._store.get(id);
    const candidate = currentCandidate(task);
    await this._worktrees.verifyCandidate(candidate);
    // The harness executes the repository's declared verification commands *before* any model
    // runs, and the result of that execution is the evidence. A model is asked afterwards to
    // interpret it, never to produce it.
    //
    // Deliberately not inside the try below: a repository that declares no verification
    // commands is a configuration gap, not a candidate defect, so it fails the run with an
    // actionable message rather than becoming a REPAIR verdict a repair could only "fix" by
    // having a model invent the commands — the exact thing this change exists to prevent.
    let harnessVerification = null;
    if (stageId === "test") {
      harnessVerification =
        [...(candidate.verificationRuns ?? [])]
          .reverse()
          .find(
            (verification) =>
              verification.executionKind === "full-manifest" &&
              verification.candidateId === candidate.id &&
              verification.candidateRevision === candidate.revisionNumber &&
              verification.headRevision === candidate.headRevision &&
              verification.retryDisposition !== "human-rerun-requested",
          ) ?? null;
      if (harnessVerification) {
        await this._store.update(id, (draft) => {
          draft.events.push(
            activity(
              "test",
              "Full verification manifest reused",
              `${candidate.id} revision ${candidate.revisionNumber} already has one exact-revision manifest execution; the recorded result is reused without rerunning commands.`,
              "info",
              "test",
            ),
          );
        });
      } else {
        harnessVerification = await this._runVerification({
          worktreePath: candidate.worktreePath,
          candidate,
          executionKind: "full-manifest",
          signal,
        });
        await this._store.update(id, (draft) => {
          const activeCandidate = currentCandidate(draft);
          activeCandidate.verificationRuns ??= [];
          activeCandidate.verificationRuns.push(harnessVerification);
          draft.events.push(
            activity(
              "test",
              "Full verification manifest executed",
              `${activeCandidate.id} revision ${activeCandidate.revisionNumber} ran ${harnessVerification.rows.length} command${harnessVerification.rows.length === 1 ? "" : "s"} in ${harnessVerification.durationMs}ms.`,
              harnessVerification.status === "passed" ? "success" : "danger",
              "test",
            ),
          );
        });
      }
      throwIfAborted(signal);
      if (task.workflowProfile?.selected === "fast") {
        await this._completeDeterministicFastGates(
          id,
          candidate,
          validateFocusedTestEvidence(harnessVerification, candidate),
        );
        return;
      }
    }
    let result;
    // A reviewer that dirties its worktree without committing leaves every exact-SHA
    // check reporting agreement, because the SHA genuinely did not change — while the
    // gate's evidence now attests to file contents that were never in the reviewed
    // commit. That is a silent invalidation, and until now a final-review mutation
    // was caught nowhere: it is the last gate before merge.
    let reviewerMutation = null;
    try {
      result = await this._executeAgent(
        task,
        stageId,
        signal,
        candidate.worktreePath,
        "read-only",
        candidate,
        harnessVerification ? buildTestInterpretationRequest(task, candidate, harnessVerification) : null,
      );
    } finally {
      if (stageId === "test") {
        // The test stage is *expected* to dirty its worktree, so it recovers.
        if (typeof this._worktrees.recoverCandidate === "function") {
          await this._worktrees.recoverCandidate(candidate);
        }
        await this._worktrees.verifyCandidate(candidate);
      } else if (result) {
        // A reviewer is not expected to dirty anything, so it is never recovered:
        // silently restoring the worktree would erase the only evidence that the
        // reviewer mutated the candidate it was reviewing.
        try {
          await this._worktrees.verifyCandidate(candidate);
        } catch (error) {
          reviewerMutation = error;
        }
      }
    }
    throwIfAborted(signal);
    let focusedTestEvidence = null;
    let structuredGateEvidence = null;
    let evidenceError = null;
    const reviewerToolingFailure = modelCommandFailed(result.runtimeEvents);
    try {
      if (reviewerMutation) throw reviewerMutation;
      // Same contract, same validator, different source: the evidence is what the harness
      // observed, so `parseFocusedTestEvidence` is no longer in this path at all. Nothing the
      // model returned can change a status, a row or an exit code.
      focusedTestEvidence =
        stageId === "test" ? validateFocusedTestEvidence(harnessVerification, candidate) : null;
      structuredGateEvidence = ["dev-review", "final-review"].includes(stageId)
        ? parseGateEvidence(result.finalText, candidate, stageId)
        : null;
    } catch (error) {
      evidenceError = structuredEvidenceError(error);
    }
    // Model-run shell commands are diagnostics, never candidate verification. A
    // failure still fails closed, but it can only request a bounded rerun of this
    // read-only gate; it can never authorize candidate Repair, even when the model's
    // narrative also says REPAIR.
    if (!evidenceError && reviewerToolingFailure) {
      evidenceError = {
        code: "review_tooling_failure",
        copy: RUNTIME_FRESHNESS_REASONS.review_tooling_failure,
      };
    }
    const verdict = evidenceError
      ? "REPAIR"
      : evaluationVerdict(stageId, result, focusedTestEvidence, structuredGateEvidence);
    const gateResult = {
      verdict,
      candidateId: candidate.id,
      candidateRevision: candidate.revisionNumber,
      schemaVersion: 1,
      stage: stageId,
      reportedVerdict: structuredGateEvidence?.reportedVerdict ?? null,
      evaluatedAt: now(),
      findings: structuredGateEvidence?.findings ?? [],
      blockingReasons: [
        ...(evidenceError ? [evidenceError.copy] : []),
        ...(reviewerMutation
          ? [`The ${stageId} agent mutated the candidate it was reviewing. ${reviewerMutation.message}`]
          : []),
        ...(reviewerToolingFailure
          ? ["A reviewer diagnostic command failed; no candidate defect was inferred from that telemetry."]
          : []),
        ...(focusedTestEvidence?.status === "failed"
          ? ["Structured test evidence contains a failed result."]
          : []),
        ...(structuredGateEvidence?.blockingReasons ?? []),
      ],
    };
    await this._retainAgentResult(id, stageId, result, {
      replace: false,
      name: `${stageId}-${candidate.id.toLowerCase()}-r${candidate.revisionNumber}.md`,
      candidateId: candidate.id,
      candidateRevision: candidate.revisionNumber,
      complete: verdict === "PASS",
      focusedTestEvidence,
      gateResult,
      evidenceError,
    });
    if (reviewerMutation) {
      await this._store.update(id, (draft) => {
        draft.events.push(
          activity(
            stageId,
            "Reviewer mutated the candidate",
            `${reviewerMutation.message} The verdict was not accepted; this gate requires a rerun.`,
            "danger",
            "decision",
          ),
        );
      });
    }
    await this._store.update(id, (draft) => {
      const activeCandidate = currentCandidate(draft);
      const gateFailure = candidateGateFailure(draft, activeCandidate, [stageId]);
      const stageFreshness = gateFailure?.freshness ?? draft.gateFreshness?.[stageId] ?? null;
      const authoritativeRun = stageFreshness?.sourceRunId
        ? draft.runs?.find((run) => run.id === stageFreshness.sourceRunId)
        : null;
      activeCandidate.updatedAt = now();
      draft.activeRunKind = null;
      draft.activeRunReservationId = null;
      if (gateFailure) {
        const authoritativeFailedTest =
          stageId === "test" &&
          focusedTestEvidence?.status === "failed" &&
          gateFailure.freshness.reasonCode === "repair_required";
        const blockingFindings =
          authoritativeRun?.gateResult?.findings?.filter((finding) => finding.blocking === true) ?? [];
        const reviewRetryRequired =
          ["dev-review", "final-review"].includes(stageId) &&
          gateFailure.freshness.reasonCode !== "repair_required" &&
          blockingFindings.length === 0;
        if ((evidenceError || reviewRetryRequired) && !authoritativeFailedTest) {
          const rerunState = evaluationRerunState(stageId);
          activeCandidate.status = rerunState.candidateStatus;
          draft.status = rerunState.taskStatus;
          draft.currentStage = stageId;
          if (["dev-review", "final-review"].includes(stageId)) {
            draft.reviewRetries ??= [];
            const repeatedReason = draft.reviewRetries.some(
              (retry) =>
                retry.stage === stageId &&
                retry.candidateId === activeCandidate.id &&
                retry.candidateRevision === activeCandidate.revisionNumber &&
                retry.reasonCode === gateFailure.freshness.reasonCode,
            );
            draft.reviewRetries.push({
              stage: stageId,
              candidateId: activeCandidate.id,
              candidateRevision: activeCandidate.revisionNumber,
              runId: authoritativeRun?.id ?? null,
              reasonCode: gateFailure.freshness.reasonCode,
              reason: gateFailure.freshness.reasonCopy,
              createdAt: now(),
            });
            if (repeatedReason) {
              const attempts = draft.attemptsByStage?.[stageId] ?? 0;
              draft.stageRunLimits ??= {};
              draft.stageRunLimits[stageId] = Math.min(stageRunLimitFor(draft, stageId), attempts);
              draft.error = `${getStageMetadata(stageId).label} repeated ${gateFailure.freshness.reasonCode} for the same candidate revision. A human must inspect the retained telemetry before granting another attempt; candidate Repair is not authorized.`;
              draft.events.push(
                activity(
                  stageId,
                  "Repeated review failure stopped",
                  draft.error,
                  "danger",
                  "decision",
                  runEventMetadata(authoritativeRun),
                ),
              );
              return;
            }
          }
          draft.events.push(
            activity(
              stageId,
              `${getStageMetadata(stageId).label} rerun required`,
              `${activeCandidate.id} revision ${activeCandidate.revisionNumber} could not accept the persisted gate evidence. ${gateFailure.freshness.reasonCopy}`,
              "warning",
              "decision",
              runEventMetadata(authoritativeRun),
            ),
          );
          return;
        }
        if (
          stageId === "dev-review" &&
          draft.workflowProfile?.selected === "fast" &&
          isArchitecturalRisk(blockingFindings)
        ) {
          const escalation = fastEscalation({ profile: "fast", kind: "review-risk", architectural: true });
          if (escalation)
            recordWorkflowProfile(draft, escalation.target, escalation.reason, "automatic-escalation");
        }
        const repairCount = activeCandidate.revisions.filter(
          (revision) => revision.reason === "repair",
        ).length;
        if (stageId === "dev-review" && draft.workflowProfile?.selected === "fast" && repairCount >= 1) {
          activeCandidate.status = "repair_required";
          draft.status = "blocked";
          draft.currentStage = stageId;
          draft.error =
            "Fast profile exhausted its one automatic candidate-repair cycle. Human direction or a profile override is required before more code changes.";
          draft.events.push(
            activity(
              stageId,
              "Fast repair limit reached",
              draft.error,
              "danger",
              "decision",
              runEventMetadata(authoritativeRun),
            ),
          );
          return;
        }
        activeCandidate.status = "repair_required";
        draft.status = "repair-required";
        draft.currentStage = stageId;
        draft.events.push(
          activity(
            stageId,
            "Candidate requires repair",
            `${activeCandidate.id} revision ${activeCandidate.revisionNumber} did not pass ${getStageMetadata(stageId).label}. ${gateFailure.freshness.reasonCopy}`,
            "warning",
            "decision",
            runEventMetadata(authoritativeRun),
          ),
        );
        return;
      }
      if (stageId === "dev-review") {
        activeCandidate.status = "ready_for_test";
        draft.status = "ready-for-test";
        draft.currentStage = "test";
      } else if (stageId === "test") {
        activeCandidate.status = "ready_for_final_review";
        draft.status = "ready-for-final-review";
        draft.currentStage = "final-review";
      } else {
        activeCandidate.status = "awaiting_human_approval";
        draft.status = "awaiting-human-approval";
        draft.currentStage = "approval";
      }
      draft.events.push(
        activity(
          stageId,
          `${getStageMetadata(stageId).label} passed`,
          `${activeCandidate.id} revision ${activeCandidate.revisionNumber} advanced to the next gate.`,
          "success",
          "decision",
          runEventMetadata(authoritativeRun),
        ),
      );
    });
  }
}
