import { resolveEffectiveRunPolicy } from "./effective-policy.mjs";
import { policyIdForRun } from "./model-catalog.mjs";
import { repairAuthorizerSnapshot, timestampAfter } from "./orchestrator-repair-authority.mjs";
import { activity, now } from "./orchestrator-stage-support.mjs";
import {
  applyStageRunReservation,
  labelForRun,
  runDetail,
  stageForRun,
} from "./orchestrator-task-helpers.mjs";
import { getStageMetadata } from "./prompts.mjs";
import {
  CANDIDATE_GATE_STAGES,
  RUNTIME_FRESHNESS_REASONS,
  refreshGateFreshness,
  stageRunLimitFor,
} from "./run-activity.mjs";
import { isCandidateEvidenceError } from "./structured-output.mjs";

export function removeStageArtifacts(task, stageId) {
  const removedIds = new Set(
    (task.artifacts ?? []).filter((artifact) => artifact.stage === stageId).map((artifact) => artifact.id),
  );
  task.artifacts = (task.artifacts ?? []).filter((artifact) => artifact.stage !== stageId);
  if (!removedIds.size) return;
  for (const run of task.runs ?? []) {
    if (removedIds.has(run.artifactId)) run.artifactId = null;
  }
}

export function throwIfAborted(signal) {
  if (signal.aborted) throw new Error("Codex run cancelled.");
}

export function candidateGateFailure(task, candidate, stages = CANDIDATE_GATE_STAGES) {
  const projection = refreshGateFreshness(task);
  for (const stage of stages) {
    const freshness = projection[stage];
    const exactCandidate =
      freshness?.candidateId === candidate.id && freshness?.candidateRevision === candidate.revisionNumber;
    if (!freshness?.fresh || !exactCandidate) return { stage, freshness };
  }
  return null;
}

export function sameCandidateTestRetryContext(task) {
  const candidate = currentCandidate(task);
  if (
    !["repair-required", "failed", "blocked"].includes(task.status) ||
    task.currentStage !== "test" ||
    !["repair_required", "ready_for_test"].includes(candidate.status)
  ) {
    throw new Error("The task is not awaiting a retryable Test failure.");
  }
  const verification = [...(candidate.verificationRuns ?? [])]
    .reverse()
    .find(
      (entry) =>
        (entry.executionKind == null || entry.executionKind === "full-manifest") &&
        entry.candidateId === candidate.id &&
        entry.candidateRevision === candidate.revisionNumber &&
        entry.headRevision === candidate.headRevision &&
        entry.status === "failed" &&
        entry.retryDisposition !== "human-rerun-requested",
    );
  if (!verification) throw new Error("No failed exact-candidate verification is available to rerun.");
  const alreadyRetried = (task.sameCandidateTestRetries ?? []).some(
    (retry) => retry.candidateId === candidate.id && retry.candidateRevision === candidate.revisionNumber,
  );
  if (alreadyRetried)
    throw new Error("This candidate revision already used its one same-candidate Test retry.");
  const latestArtifact = [...(task.artifacts ?? [])]
    .reverse()
    .find(
      (artifact) =>
        artifact.stage === "test" &&
        artifact.candidateId === candidate.id &&
        artifact.candidateRevision === candidate.revisionNumber,
    );
  const blockingCandidateDefect = latestArtifact?.gateResult?.findings?.some(
    (finding) => finding.blocking === true && finding.kind === "candidate-defect",
  );
  if (blockingCandidateDefect) {
    throw new Error(
      "The retained Test evidence identifies a blocking candidate defect; use candidate repair instead.",
    );
  }
  return { candidate, verification };
}

export function assertCandidateGatesFresh(task, candidate) {
  const failure = candidateGateFailure(task, candidate);
  if (!failure) return;
  const stageLabel = getStageMetadata(failure.stage).label;
  const reason = failure.freshness?.reasonCopy ?? RUNTIME_FRESHNESS_REASONS.missing_authoritative_summary;
  throw new Error(
    `${candidate.id} revision ${candidate.revisionNumber} cannot be approved because ${stageLabel} is not fresh. ${reason}`,
  );
}

export function currentCandidate(task) {
  const candidate = task.candidates?.at(-1);
  if (!candidate) throw new Error("This task does not have an integration candidate.");
  return candidate;
}

export function resolveRunAgentPolicy(task, policyId, settings) {
  void settings;
  return resolveEffectiveRunPolicy(task, policyId);
}

/**
 * Implement and repair get an hour. It is a runaway guard, not a work budget.
 *
 * The previous 900_000 had no recorded derivation, and the 1_800_000 that replaced it was
 * fitted to two observed runs — then immediately falsified by a third. Measured C4
 * implement runs on one unchanged brief: 944s, 1031s, 1616s, 1661s, and one that passed
 * 1800s. That spread is the model's path through the work, not the work's size, so any
 * limit drawn through the middle of it silently decides the delivery rate. For an
 * experiment whose primary outcome is delivery, a tuned timeout is a knob that sets the
 * result.
 *
 * So it is deliberately set where it stops a genuinely stuck agent and nothing else, and
 * matches the 3_600_000 ceiling `stageTimeoutOverridesMs` is already clamped to below.
 *
 * A wall clock is the wrong instrument for bounding agent work, and this does not pretend
 * otherwise — it only stops being the thing that decides experiment outcomes. Real work
 * bounds (agent turns, token budget, package size) belong in the run policy; the
 * experiment budget in `experiment-decision.mjs` already declares `maxWallTimeMs` and
 * `maxTotalTokens`, but classifies a finished task rather than stopping a running one.
 */
export function stageTimeoutMs(stageId, sandbox, task = null) {
  const defaultTimeout = ["implement", "repair"].includes(stageId)
    ? 3_600_000
    : sandbox === "workspace-write" || ["plan", "dev-review", "final-review"].includes(stageId)
      ? 600_000
      : 360_000;
  const configured = task?.stageTimeoutOverridesMs?.[stageId];
  return Number.isInteger(configured) && configured >= defaultTimeout && configured <= 3_600_000
    ? configured
    : defaultTimeout;
}

export function evaluationVerdict(
  stageId,
  result,
  focusedTestEvidence = null,
  structuredGateEvidence = null,
) {
  if (CANDIDATE_GATE_STAGES.includes(stageId) && modelCommandFailed(result.runtimeEvents)) return "REPAIR";
  if (stageId === "test" && focusedTestEvidence?.status !== "passed") return "REPAIR";
  if (stageId === "test") return "PASS";
  if (["dev-review", "final-review"].includes(stageId)) return structuredGateEvidence?.verdict ?? "REPAIR";
  return "REPAIR";
}

export function modelCommandFailed(runtimeEvents = []) {
  return runtimeEvents.some(
    (event) => event?.commandFailed === true && event?.runtimeScope !== "context-preflight",
  );
}

export function structuredEvidenceError(error) {
  const code = isCandidateEvidenceError(error) ? error.code : "contradictory_evidence";
  return { code, copy: RUNTIME_FRESHNESS_REASONS[code] };
}

export function evaluationRerunState(stageId) {
  return {
    "dev-review": { taskStatus: "review-retry-required", candidateStatus: "review_retry_required" },
    test: { taskStatus: "ready-for-test", candidateStatus: "ready_for_test" },
    "final-review": { taskStatus: "ready-for-final-review", candidateStatus: "ready_for_final_review" },
  }[stageId];
}

export function canStartRun(task, kind) {
  const stage = stageForRun(kind, task.currentStage);
  const attempts = task.attemptsByStage?.[stage] ?? 0;
  if (task.status === "blocked" || attempts >= stageRunLimitFor(task, stage)) return false;
  if (
    kind === "specification" &&
    ["failed", "cancelled"].includes(task.status) &&
    task.currentStage !== "specification"
  ) {
    return false;
  }
  if (
    kind === "specification" &&
    task.designRequest?.requested === true &&
    task.designRequest.status !== "selected" &&
    task.status !== "awaiting-grill"
  ) {
    return false;
  }
  const allowed = {
    investigation: ["queued", "failed", "cancelled"],
    specification: ["awaiting-grill", "failed", "cancelled"],
    planning: ["awaiting-plan-approval", "failed", "cancelled"],
    implementation: ["ready-for-implementation", "failed", "cancelled"],
    repair: ["repair-required", "failed", "cancelled"],
    review: ["ready-for-review", "review-retry-required", "failed", "cancelled"],
    test: ["ready-for-test", "failed", "cancelled"],
    "final-review": ["ready-for-final-review", "failed", "cancelled"],
  }[kind];
  if (!allowed.includes(task.status)) return false;
  if (kind === "repair" && currentCandidate(task).status !== "repair_required") return false;
  if (kind === "implementation" && task.candidates?.at(-1)?.status === "repair_required") return false;
  return true;
}

export function reserveRun(task, kind) {
  const stage = stageForRun(kind, task.currentStage);
  const candidate = task.candidates?.at(-1) ?? null;
  const reservation = createStageRunReservation(task, kind, stage);
  task.status = "running";
  task.error = null;
  task.startedAt ??= now();
  task.completedAt = null;
  applyStageRunReservation(task, reservation);
  task.activeRunKind = kind;
  if (candidate) {
    const candidateStatus = {
      repair: "repairing",
      review: "reviewing",
      test: "testing",
      "final-review": "final_reviewing",
    }[kind];
    if (candidateStatus) candidate.status = candidateStatus;
  }
  task.events.push(activity(stage, `${labelForRun(kind)} started`, runDetail(kind), "info", "agent"));
}

export function createStageRunReservation(task, kind, stage, provider = null) {
  const candidate = kind === "implementation" ? null : (task.candidates?.at(-1) ?? null);
  const repairAuthorizer = kind === "repair" ? repairAuthorizerSnapshot(task, candidate) : null;
  const reservedAt = repairAuthorizer
    ? timestampAfter(repairAuthorizer.authorizingGateArtifactCreatedAt)
    : now();
  const authorizedRunScopes =
    kind === "implementation"
      ? (task.workPackages ?? [])
          .filter((workPackage) => !["ready_for_integration", "integrated"].includes(workPackage.status))
          .map((workPackage) => workPackage.id)
      : [];
  const effectivePolicy = resolveRunAgentPolicy(task, policyIdForRun(kind, stage));
  if (provider != null && provider !== effectivePolicy.provider) {
    throw new Error(
      `Stage ${stage} requested provider ${provider}, but its effective policy requires ${effectivePolicy.provider}.`,
    );
  }
  return {
    id: crypto.randomUUID(),
    stage,
    kind,
    provider: effectivePolicy.provider,
    effectivePolicy,
    workflowAttempt: (task.attemptsByStage?.[stage] ?? 0) + 1,
    candidateId: candidate?.id ?? null,
    candidateRevision: candidate?.revisionNumber ?? null,
    candidateHeadRevision: candidate?.headRevision ?? null,
    repositoryAuthorityId: task.repositoryAuthority?.id ?? null,
    repositoryRevision: task.repositoryAuthority?.selectedRevision ?? null,
    repositoryTargetRef: task.repositoryAuthority?.targetRef ?? null,
    repositoryAuthorityCheckedAt: task.repositoryAuthority?.capturedAt ?? null,
    repositoryCheckoutBranch: task.repositoryAuthority?.checkoutBranch ?? null,
    repositoryAuthoritySource: task.repositoryAuthority?.source ?? null,
    authorizedRunScopes,
    reservedAt,
    ...(repairAuthorizer ?? {}),
  };
}

/**
 * The provider that will execute this attempt, resolved from the stage policy that
 * owns it rather than from the task. This is what lets a task review on one runtime
 * and implement on another while a run still cannot execute on a provider its
 * reservation did not reserve.
 */
export function reservationProviderFor(task, kind, stage) {
  return resolveRunAgentPolicy(task, policyIdForRun(kind, stage)).provider;
}
