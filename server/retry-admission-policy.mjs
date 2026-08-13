import {
  failedRepairAuthorizingGate,
  validRetryReservationCandidateBinding,
  validateGlobalRetryIdentities,
} from "./retry-authority-validation.mjs";
import {
  adjacentRepairAuthorizingGate,
  candidateRevisionLineage,
  candidateRevisionProducerEvidence,
  replacedCandidateMatchesReservation,
  targetRefreshesDescendFromReservation,
} from "./candidate-lineage-validation.mjs";
import { PROJECTED_ACTIONS, runActionAdmission } from "./action-policy.mjs";
import {
  CANONICAL_RUN_STAGES,
  CANDIDATE_GATE_STAGES,
  readExecutionProvider,
  resolveGateFreshness,
  stageRunLimitFor,
} from "./run-activity.mjs";
import {
  orderRetrySourceRuns,
  validateRetryRunScopes,
  validPersistedTimestamp,
  validRetryCandidate,
  validRetryReservationKind,
  validRetryRunTuple,
  validRetryWorkflowIdentities,
} from "./retry-reservation-validation.mjs";

export function withActionEligibility(task) {
  return {
    ...task,
    actionEligibility: {
      generatedAt: new Date().toISOString(),
      actions: Object.fromEntries(PROJECTED_ACTIONS.map((action) => [action, actionEligibilityFor(task, action)])),
    },
  };
}

function actionEligibilityFor(task, action) {
  const deny = (reason = `Task cannot run ${action} while it is ${task.status}.`) => ({ allowed: false, reason });
  const allow = () => ({ allowed: true, reason: null });
  const candidate = task.candidates?.at(-1);
  const running = task.status === "running" || task.status === "cancelling" ||
    Boolean(task.activeRunKind || task.activeRunReservationId || (task.activeRunIds?.length ?? 0) > 0);
  if (running) return deny("Wait for the active run to finish before starting another workflow action.");
  if (action === "continue-implementation") {
    if (task.workflow !== "investigate" || task.status !== "completed") return deny("Only a completed investigate-only task can continue to implementation.");
    return allow();
  }
  if (action === "reconcile-merge") {
    const retainedPending = task.status === "merging" && task.mergeIntent?.status === "pending";
    const retryableFailure = task.status === "blocked" && task.blocker?.code === "merge-reconciliation" && task.mergeIntent?.status === "failed";
    return retainedPending || retryableFailure ? allow() : deny("This task does not have a retained merge intent that can be reconciled.");
  }
  if (action === "reconcile-pr") {
    const publishing = task.status === "merging" && task.pullRequestIntent?.status === "publishing";
    const open = task.status === "awaiting-pr-merge" && task.pullRequestIntent?.status === "open";
    const retryableFailure = task.status === "blocked" &&
      task.blocker?.code === "pull-request-publication" && task.pullRequestIntent?.status === "failed";
    const closed = task.status === "blocked" &&
      task.blocker?.code === "pull-request-closed" && task.pullRequestIntent?.status === "closed";
    return publishing || open || retryableFailure || closed
      ? allow()
      : deny("This task does not have a retained GitHub PR intent that can be reconciled.");
  }
  if (action === "refresh-candidate") {
    return task.status === "blocked" && task.blocker?.code === "target-diverged"
      ? allow()
      : deny("The task is not blocked by an advanced target branch.");
  }
  if (action === "rebuild-candidate") {
    return task.status === "blocked" && task.blocker?.code === "target-refresh-conflict"
      ? allow()
      : deny("The task is not blocked by a candidate refresh conflict.");
  }
  if (action === "restart-implementation") {
    return task.status === "blocked" && task.blocker?.code === "implementation-target-diverged"
      ? allow()
      : deny("The task is not blocked by target divergence during implementation.");
  }
  if (task.status === "blocked" && task.blocker?.code === "target-diverged") {
    return deny("Refresh the candidate from the current target before running another candidate-bound action.");
  }
  if (action === "grant-retry") {
    if (task.currentStage === "approval") return deny("Human Approval never accepts a stage retry grant.");
    const grant = retryGrantContext(task);
    return grant.error ? deny(grant.error) : allow();
  }
  if (action === "approve-spec") return task.status === "awaiting-spec-approval" ? allow() : deny();
  if (action === "approve-plan") return task.status === "awaiting-plan-approval" ? allow() : deny();
  if (action === "approve-merge") {
    if (task.status !== "awaiting-human-approval" || candidate?.status !== "awaiting_human_approval") return deny();
    const stale = CANDIDATE_GATE_STAGES.find((stage) => {
      const freshness = resolveGateFreshness(task, stage);
      return !freshness?.fresh || freshness.candidateId !== candidate.id || freshness.candidateRevision !== candidate.revisionNumber;
    });
    return stale ? deny(`Approval is blocked until ${stale} is fresh for the exact candidate revision.`) : allow();
  }
  if (action === "open-pr") {
    if (task.status !== "awaiting-human-approval" || candidate?.status !== "awaiting_human_approval") return deny();
    const stale = CANDIDATE_GATE_STAGES.find((stage) => {
      const freshness = resolveGateFreshness(task, stage);
      return !freshness?.fresh || freshness.candidateId !== candidate.id || freshness.candidateRevision !== candidate.revisionNumber;
    });
    return stale ? deny(`PR approval is blocked until ${stale} is fresh for the exact candidate revision.`) : allow();
  }
  if (action === "complete-merged") return task.status === "merged-to-target" ? allow() : deny();
  if (action === "continue-package") {
    const retained = (task.workPackages ?? []).some((workPackage) =>
      workPackage.status === "failed" && workPackage.worktreePath &&
      /run exceeded \d+ seconds|harness stopped while this task was running/i.test(workPackage.error ?? task.error ?? ""));
    return ["failed", "blocked"].includes(task.status) && task.currentStage === "implement" && retained
      ? allow()
      : deny("No retained timed-out implementation package is available to continue.");
  }
  if (action === "retry-test") {
    const verification = [...(candidate?.verificationRuns ?? [])].reverse().find((entry) =>
      (entry.executionKind == null || entry.executionKind === "full-manifest") &&
      entry.candidateId === candidate?.id &&
      entry.candidateRevision === candidate?.revisionNumber &&
      entry.headRevision === candidate?.headRevision &&
      entry.status === "failed" &&
      entry.retryDisposition !== "human-rerun-requested");
    const alreadyRetried = (task.sameCandidateTestRetries ?? []).some((retry) =>
      retry.candidateId === candidate?.id && retry.candidateRevision === candidate?.revisionNumber);
    const latestTest = [...(task.artifacts ?? [])].reverse().find((artifact) =>
      artifact.stage === "test" && artifact.candidateId === candidate?.id && artifact.candidateRevision === candidate?.revisionNumber);
    const candidateDefect = latestTest?.gateResult?.findings?.some((finding) => finding.blocking === true && finding.kind === "candidate-defect");
    return ["repair-required", "failed", "blocked"].includes(task.status) && task.currentStage === "test" &&
      verification && !alreadyRetried && !candidateDefect
      ? allow()
      : deny("The exact candidate is not eligible for a same-revision Test retry.");
  }
  if (action === "plan" && ["failed", "blocked"].includes(task.status) && task.currentStage === "implement") return allow();
  if (action === "plan" && task.status === "awaiting-plan-approval") {
    const latestPlan = task.artifacts?.filter((artifact) => artifact.stage === "plan").at(-1);
    const latestDecision = task.decisions?.at(-1);
    return latestPlan && latestDecision?.createdAt > latestPlan.createdAt
      ? allow()
      : deny("Record the required plan correction as a task decision before revising the plan.");
  }
  const runAdmission = runActionAdmission(task, action);
  if (runAdmission) return {
    allowed: runAdmission.allowed,
    reason: runAdmission.reason,
    mode: runAdmission.mode,
  };
  return deny();
}

export function retryGrantContext(task) {
  const candidate = task.candidates?.at(-1);
  if (
    task.workflowProfile?.selected === "fast" &&
    candidate?.status === "repair_required" &&
    (task.automaticRepairCycles ?? 0) >= 1
  ) {
    return { error: "Fast tasks permit one automatic review-driven candidate repair. A further candidate defect requires human direction, not another repair-loop grant." };
  }
  const grantedStage = candidate?.status === "repair_required" ? "implement" : task.currentStage;
  if (!CANONICAL_RUN_STAGES.includes(grantedStage)) {
    return { error: "The current stage cannot receive a retry grant." };
  }
  const currentAttempts = task.attemptsByStage?.[grantedStage] ?? 0;
  const currentLimit = stageRunLimitFor(task, grantedStage);
  if (currentAttempts > currentLimit) {
    return {
      error: "The recorded attempts exceed this stage's allowance; resolve the inconsistent task state before granting a retry.",
    };
  }
  const exhaustedRepair =
    ["repair-required", "failed"].includes(task.status) &&
    candidate?.status === "repair_required" &&
    currentAttempts >= currentLimit;
  const readyGateTuple = {
    "ready-for-review": { stage: "dev-review", candidateStatus: "ready_for_review" },
    "review-retry-required": { stage: "dev-review", candidateStatus: "review_retry_required" },
    "ready-for-test": { stage: "test", candidateStatus: "ready_for_test" },
    "ready-for-final-review": { stage: "final-review", candidateStatus: "ready_for_final_review" },
  }[task.status] ?? null;
  const exhaustedReadyGate = readyGateTuple != null &&
    task.currentStage === readyGateTuple.stage &&
    candidate?.status === readyGateTuple.candidateStatus &&
    currentAttempts >= currentLimit;
  const exhaustedPlanApproval = task.status === "awaiting-plan-approval" &&
    task.currentStage === "plan" &&
    currentAttempts >= currentLimit;
  const exhaustedBlockedStage = task.status === "blocked" && currentAttempts >= currentLimit;
  if (!exhaustedRepair && !exhaustedReadyGate && !exhaustedPlanApproval && !exhaustedBlockedStage) {
    return { error: "A retry can only be granted to an exhausted blocked, approval, or repair stage." };
  }
  if (task.activeRunKind || task.activeRunReservationId || (task.activeRunIds?.length ?? 0) > 0) {
    return { error: "An active or inconsistent run reservation must be resolved before granting a retry." };
  }
  if ((task.runs ?? []).some((run) => run?.status === "running")) {
    return { error: "An active or inconsistent run history must be resolved before granting a retry." };
  }
  const globalIdentityError = validateGlobalRetryIdentities(task);
  if (globalIdentityError) return { error: globalIdentityError };
  const stageRuns = (task.runs ?? []).filter((run) => run.stage === grantedStage);
  const terminalStatuses = new Set(["completed", "failed", "cancelled", "interrupted", "timed-out", "timed_out", "timeout"]);
  if (stageRuns.some((run) => !terminalStatuses.has(run.status))) {
    return { error: "The exhausted stage contains a non-terminal run; resolve the inconsistent history before granting a retry." };
  }
  if (new Set(stageRuns.map((run) => run.id)).size !== stageRuns.length) {
    return { error: "The exhausted stage has duplicate run identities; resolve the inconsistent task state before granting a retry." };
  }
  const reservation = task.stageRunReservations?.[grantedStage] ?? null;
  const candidateBoundGrant = ["dev-review", "test", "final-review"].includes(grantedStage) ||
    candidate?.status === "repair_required";
  if (candidateBoundGrant && !validRetryCandidate(candidate)) {
    return { error: "The exhausted candidate-bound stage is missing an exact candidate identity; resolve it before granting a retry." };
  }
  if (!reservation || (
    typeof reservation.id !== "string" ||
    !reservation.id.trim() ||
    reservation.stage !== grantedStage ||
    !Number.isInteger(reservation.workflowAttempt) ||
    reservation.workflowAttempt < 1 ||
    reservation.workflowAttempt !== currentAttempts ||
    !validPersistedTimestamp(reservation.reservedAt) ||
    !validRetryReservationCandidateBinding(
      reservation,
      candidateBoundGrant,
      candidate,
      grantedStage,
      task,
    ) ||
    !validRetryReservationKind(grantedStage, reservation.kind)
  )) {
    return { error: "The exhausted stage has an inconsistent workflow reservation; resolve it before granting a retry." };
  }
  if (!validRetryWorkflowIdentities(stageRuns, reservation, currentAttempts)) {
    return { error: "The exhausted stage has partial or orphaned workflow identity; resolve it before granting a retry." };
  }
  const exactReservation = reservation?.workflowAttempt === currentAttempts ? reservation : null;
  const reservationRuns = exactReservation
    ? stageRuns.filter((run) => run.workflowReservationId === exactReservation.id)
    : [];
  if (exactReservation && reservationRuns.some((run) => (
    run.workflowAttempt !== exactReservation.workflowAttempt ||
    run.candidateId !== exactReservation.candidateId ||
    run.candidateRevision !== exactReservation.candidateRevision ||
    run.candidateHeadRevision !== exactReservation.candidateHeadRevision ||
    readExecutionProvider(run) !== readExecutionProvider(exactReservation) ||
    !validRetryRunTuple(run, exactReservation, stageRuns)
  ))) {
    return { error: "The exhausted stage run does not match its workflow reservation; resolve the inconsistent history before granting a retry." };
  }
  if (exactReservation && stageRuns.some((run) => (
    run.workflowAttempt === currentAttempts && run.workflowReservationId !== exactReservation.id
  ))) {
    return { error: "The exhausted workflow attempt contains conflicting run reservations; resolve it before granting a retry." };
  }
  const multiRunScopeError = validateRetryRunScopes(task, exactReservation, reservationRuns);
  if (multiRunScopeError) return { error: multiRunScopeError };
  const sourceRuns = orderRetrySourceRuns(exactReservation, reservationRuns);
  const retrySource = sourceRuns.at(-1) ?? null;
  const sourceRunIds = sourceRuns.map((run) => run.id);
  const lineage = candidateBoundGrant ? candidateRevisionLineage(candidate) : null;
  const adjacentPriorRevision = candidateBoundGrant &&
    candidate?.status !== "repair_required" &&
    reservation.candidateId === candidate?.id &&
    reservation.candidateRevision + 1 === candidate?.revisionNumber;
  const priorTargetRefreshRevision = candidateBoundGrant &&
    candidate?.status !== "repair_required" &&
    targetRefreshesDescendFromReservation(lineage, candidate, reservation);
  const priorReplacedCandidate = candidateBoundGrant &&
    candidate?.status !== "repair_required" &&
    replacedCandidateMatchesReservation(task, candidate, reservation);
  if ((adjacentPriorRevision || priorTargetRefreshRevision || priorReplacedCandidate) && reservationRuns.length !== 1) {
    return { error: "The exhausted stage has an inconsistent workflow reservation; resolve it before granting a retry." };
  }
  const authorizingGate = candidate?.status === "repair_required"
    ? failedRepairAuthorizingGate(task, candidate, lineage)
    : adjacentPriorRevision && !priorTargetRefreshRevision
      ? adjacentRepairAuthorizingGate(
          task,
          candidate,
          reservation,
          task.stageRunReservations?.implement,
          lineage,
          task.attemptsByStage?.implement ?? 0,
        )
      : null;
  if ((candidate?.status === "repair_required" || (adjacentPriorRevision && !priorTargetRefreshRevision)) && !authorizingGate) {
    return { error: "The exhausted candidate repair is missing an exact authorizing gate; resolve the inconsistent history before granting a retry." };
  }
  const authorizingGateRun = authorizingGate?.sourceRunId
    ? (task.runs ?? []).find((run) => run.id === authorizingGate.sourceRunId) ?? null
    : null;
  const authorizingGateArtifact = authorizingGateRun?.artifactId
    ? (task.artifacts ?? []).find((artifact) => artifact.id === authorizingGateRun.artifactId) ?? null
    : null;
  const producerEvidence = lineage ? candidateRevisionProducerEvidence(task, candidate, lineage) : null;
  if (candidateBoundGrant && !producerEvidence) {
    return { error: "The exhausted candidate is missing exact producer evidence; resolve the inconsistent history before granting a retry." };
  }
  const candidateProducerRunIds = producerEvidence?.runs.map((run) => run.id) ?? [];
  const candidateProducerArtifactIds = producerEvidence?.artifacts.map((artifact) => artifact.id) ?? [];
  const candidateAuthorizerRunIds = producerEvidence?.authorizerRuns.map((run) => run.id) ?? [];
  const candidateAuthorizerArtifactIds = producerEvidence?.authorizerArtifacts.map((artifact) => artifact.id) ?? [];
  const candidateAuthorizerReservationIds = producerEvidence?.authorizerReservations.map((entry) => entry.id) ?? [];
  const historySnapshot = JSON.stringify({
    currentStage: task.currentStage,
    activeRunKind: task.activeRunKind ?? null,
    activeRunReservationId: task.activeRunReservationId ?? null,
    activeRunIds: task.activeRunIds ?? [],
    candidate: candidate ?? null,
    authorizingGateArtifact,
    authorizingGateRun,
    attemptsByStage: task.attemptsByStage ?? {},
    candidateProducerArtifacts: producerEvidence?.artifacts ?? [],
    candidateProducerRuns: producerEvidence?.runs ?? [],
    candidateAuthorizerArtifacts: producerEvidence?.authorizerArtifacts ?? [],
    candidateAuthorizerReservations: producerEvidence?.authorizerReservations ?? [],
    candidateAuthorizerRuns: producerEvidence?.authorizerRuns ?? [],
    reservation,
    stageRunReservations: task.stageRunReservations ?? {},
    stageRunLimits: task.stageRunLimits ?? {},
    stageRuns,
    workPackages: task.workPackages ?? [],
    scoutDispatch: task.scoutDispatch ?? null,
  });
  const grantCandidate = candidateBoundGrant ? candidate : null;
  return {
    candidate,
    grantedStage,
    currentAttempts,
    currentLimit,
    taskStatus: task.status,
    candidateId: grantCandidate?.id ?? null,
    candidateRevision: grantCandidate?.revisionNumber ?? null,
    candidateHeadRevision: grantCandidate?.headRevision ?? null,
    candidateStatus: candidate?.status ?? null,
    authorizingGateArtifactId: authorizingGate?.sourceArtifactId ?? null,
    authorizingGateCandidateId: authorizingGate?.candidateId ?? null,
    authorizingGateCandidateRevision: authorizingGate?.candidateRevision ?? null,
    authorizingGateCandidateHeadRevision: authorizingGate?.candidateHeadRevision ?? null,
    authorizingGateKind: authorizingGate?.kind ?? null,
    authorizingGateReservedAt: authorizingGate?.reservedAt ?? null,
    authorizingGateReservationId: authorizingGate?.id ?? null,
    authorizingGateRunId: authorizingGate?.sourceRunId ?? null,
    authorizingGateStage: authorizingGate?.stage ?? null,
    authorizingGateWorkflowAttempt: authorizingGate?.workflowAttempt ?? null,
    candidateAuthorizerArtifactIds,
    candidateAuthorizerReservationIds,
    candidateAuthorizerRunIds,
    candidateProducerArtifactIds,
    candidateProducerRunIds,
    historySnapshot,
    retrySource,
    sourceRunId: retrySource?.id ?? null,
    sourceRunIds,
    sourceRunStatus: retrySource?.status ?? null,
    workflowAttempt: exactReservation?.workflowAttempt ?? currentAttempts,
    workflowCandidateId: exactReservation?.candidateId ?? null,
    workflowCandidateRevision: exactReservation?.candidateRevision ?? null,
    workflowCandidateHeadRevision: exactReservation?.candidateHeadRevision ?? null,
    workflowReservationId: exactReservation?.id ?? null,
    error: null,
  };
}

export function retainQualificationFailuresForImplementationRetry(task, grantedStage) {
  if (grantedStage !== "implement") return;
  for (const workPackage of task.workPackages ?? []) {
    const latestVerification = [...(workPackage.verificationRuns ?? [])].reverse().find((verification) => (
      verification.headRevision === workPackage.headRevision
    ));
    if (
      workPackage.status !== "failed" ||
      typeof workPackage.error !== "string" ||
      !/did not qualify/i.test(workPackage.error) ||
      typeof workPackage.branch !== "string" ||
      !workPackage.branch.trim() ||
      typeof workPackage.worktreePath !== "string" ||
      !workPackage.worktreePath.trim() ||
      typeof workPackage.baseRevision !== "string" ||
      !workPackage.baseRevision.trim() ||
      typeof workPackage.headRevision !== "string" ||
      !workPackage.headRevision.trim() ||
      !Array.isArray(workPackage.files) ||
      !workPackage.files.length ||
      latestVerification?.status !== "failed"
    ) {
      continue;
    }
    workPackage.retainedContinuation = {
      requestedAt: new Date().toISOString(),
      files: [...workPackage.files],
      outsideOwnership: [],
      qualificationFailure: workPackage.error,
    };
    workPackage.retainedForRequalification = false;
    workPackage.retainedReplacementReason = null;
  }
}

export function sameRetryGrantContext(expected, current) {
  if (expected.error || current.error) return false;
  return [
    "grantedStage",
    "currentAttempts",
    "currentLimit",
    "taskStatus",
    "candidateId",
    "candidateRevision",
    "candidateHeadRevision",
    "candidateStatus",
    "authorizingGateArtifactId",
    "authorizingGateCandidateId",
    "authorizingGateCandidateRevision",
    "authorizingGateCandidateHeadRevision",
    "authorizingGateKind",
    "authorizingGateReservedAt",
    "authorizingGateReservationId",
    "authorizingGateRunId",
    "authorizingGateStage",
    "authorizingGateWorkflowAttempt",
    "historySnapshot",
    "sourceRunId",
    "sourceRunStatus",
    "workflowAttempt",
    "workflowCandidateId",
    "workflowCandidateRevision",
    "workflowCandidateHeadRevision",
    "workflowReservationId",
  ].every((field) => expected[field] === current[field]) &&
    JSON.stringify(expected.sourceRunIds) === JSON.stringify(current.sourceRunIds) &&
    JSON.stringify(expected.candidateAuthorizerArtifactIds) === JSON.stringify(current.candidateAuthorizerArtifactIds) &&
    JSON.stringify(expected.candidateAuthorizerReservationIds) === JSON.stringify(current.candidateAuthorizerReservationIds) &&
    JSON.stringify(expected.candidateAuthorizerRunIds) === JSON.stringify(current.candidateAuthorizerRunIds) &&
    JSON.stringify(expected.candidateProducerArtifactIds) === JSON.stringify(current.candidateProducerArtifactIds) &&
    JSON.stringify(expected.candidateProducerRunIds) === JSON.stringify(current.candidateProducerRunIds);
}
