import { createHash } from "node:crypto";
import { now } from "./orchestrator-stage-support.mjs";
import {
  CANDIDATE_GATE_STAGES,
  readExecutionProvider,
  refreshGateFreshness,
  runKindFor,
} from "./run-activity.mjs";

export function repairAuthorizerSnapshot(task, candidate, requestedStage = null) {
  const stage =
    requestedStage ??
    (CANDIDATE_GATE_STAGES.includes(task.currentStage)
      ? task.currentStage
      : task.stageRunReservations?.implement?.authorizingGateStage);
  const freshness = refreshGateFreshness(task)?.[stage] ?? null;
  const sourceRun = freshness?.sourceRunId
    ? (task.runs ?? []).find((run) => run.id === freshness.sourceRunId)
    : null;
  const sourceArtifact = freshness?.sourceArtifactId
    ? (task.artifacts ?? []).find((artifact) => artifact.id === freshness.sourceArtifactId)
    : null;
  const gateReservation = sourceRun?.workflowReservationId ? task.stageRunReservations?.[stage] : null;
  const sourceArtifacts = sourceRun?.artifactId
    ? (task.artifacts ?? []).filter((artifact) => artifact.id === sourceRun.artifactId)
    : [];
  const reservationRuns = gateReservation?.id
    ? (task.runs ?? []).filter((run) => run.workflowReservationId === gateReservation.id)
    : [];
  const timestamps = [
    gateReservation?.reservedAt,
    sourceRun?.startedAt,
    sourceRun?.completedAt,
    sourceRun?.gateResult?.evaluatedAt,
    sourceArtifact?.createdAt,
  ];
  const ordered =
    timestamps.every(isCanonicalTimestamp) &&
    timestamps.every((value, index) => index === 0 || Date.parse(timestamps[index - 1]) <= Date.parse(value));
  if (
    !CANDIDATE_GATE_STAGES.includes(stage) ||
    !candidate ||
    // A completed, exact REPAIR gate may be stale for reasons that still preserve its
    // repair authority. `missing_binding` can describe a non-blocking finding whose
    // identity safely fell back to the exact top-level gate binding. `command_failure`
    // correctly prevents promotion, but must not erase a separate blocking finding and
    // strand a candidate after the evaluation has already moved it to repair-required.
    // Every admitted reason remains guarded below by the exact reservation/run/artifact
    // tuple and by `sourceRun.gateResult.verdict === "REPAIR"`. This authorizes more
    // candidate work only; it never makes the failed gate fresh or promotable.
    !["repair_required", "missing_binding", "command_failure"].includes(freshness?.reasonCode) ||
    freshness.candidateId !== candidate.id ||
    freshness.candidateRevision !== candidate.revisionNumber ||
    !sourceRun ||
    !sourceArtifact ||
    !gateReservation ||
    reservationRuns.length !== 1 ||
    reservationRuns[0].id !== sourceRun.id ||
    sourceArtifacts.length !== 1 ||
    sourceArtifacts[0].id !== sourceArtifact.id ||
    (task.runs ?? []).filter((run) => run.artifactId === sourceArtifact.id).length !== 1 ||
    gateReservation.stage !== stage ||
    gateReservation.kind !== runKindFor(stage, stage) ||
    gateReservation.workflowAttempt !== task.attemptsByStage?.[stage] ||
    gateReservation.id !== sourceRun.workflowReservationId ||
    gateReservation.workflowAttempt !== sourceRun.workflowAttempt ||
    gateReservation.candidateId !== candidate.id ||
    gateReservation.candidateRevision !== candidate.revisionNumber ||
    gateReservation.candidateHeadRevision !== candidate.headRevision ||
    readExecutionProvider(sourceRun) !== readExecutionProvider(gateReservation) ||
    sourceRun.stage !== stage ||
    sourceRun.role !== stage ||
    sourceRun.kind !== runKindFor(stage, stage) ||
    sourceRun.status !== "completed" ||
    sourceRun.workPackageId != null ||
    sourceRun.candidateId !== candidate.id ||
    sourceRun.candidateRevision !== candidate.revisionNumber ||
    sourceRun.candidateHeadRevision !== candidate.headRevision ||
    sourceRun.artifactId !== sourceArtifact.id ||
    sourceRun.gateResult?.verdict !== "REPAIR" ||
    sourceArtifact.runId !== sourceRun.id ||
    sourceArtifact.stage !== stage ||
    sourceArtifact.kind !== "markdown" ||
    typeof sourceArtifact.name !== "string" ||
    !sourceArtifact.name.trim() ||
    typeof sourceArtifact.content !== "string" ||
    !sourceArtifact.content.trim() ||
    sourceArtifact.candidateId !== candidate.id ||
    sourceArtifact.candidateRevision !== candidate.revisionNumber ||
    JSON.stringify(sourceArtifact.gateResult) !== JSON.stringify(sourceRun.gateResult) ||
    !ordered
  ) {
    throw new Error("The candidate repair is missing one exact durable authorizing gate.");
  }
  const snapshot = {
    reservation: {
      id: gateReservation.id,
      stage: gateReservation.stage,
      kind: gateReservation.kind,
      provider: readExecutionProvider(gateReservation),
      workflowAttempt: gateReservation.workflowAttempt,
      candidateId: gateReservation.candidateId,
      candidateRevision: gateReservation.candidateRevision,
      candidateHeadRevision: gateReservation.candidateHeadRevision,
      authorizedRunScopes: gateReservation.authorizedRunScopes,
      reservedAt: gateReservation.reservedAt,
    },
    run: {
      id: sourceRun.id,
      kind: sourceRun.kind,
      provider: readExecutionProvider(sourceRun),
      stage: sourceRun.stage,
      role: sourceRun.role,
      status: sourceRun.status,
      attempt: sourceRun.attempt,
      candidateId: sourceRun.candidateId,
      candidateRevision: sourceRun.candidateRevision,
      candidateHeadRevision: sourceRun.candidateHeadRevision,
      workPackageId: sourceRun.workPackageId,
      workflowAttempt: sourceRun.workflowAttempt,
      workflowReservationId: sourceRun.workflowReservationId,
      startedAt: sourceRun.startedAt,
      completedAt: sourceRun.completedAt,
      artifactId: sourceRun.artifactId,
      gateResult: sourceRun.gateResult,
    },
    artifact: {
      id: sourceArtifact.id,
      stage: sourceArtifact.stage,
      name: sourceArtifact.name,
      kind: sourceArtifact.kind,
      content: sourceArtifact.content,
      createdAt: sourceArtifact.createdAt,
      runId: sourceArtifact.runId,
      candidateId: sourceArtifact.candidateId,
      candidateRevision: sourceArtifact.candidateRevision,
      workPackageId: sourceArtifact.workPackageId,
      gateResult: sourceArtifact.gateResult,
    },
  };
  return {
    authorizingGateStage: stage,
    // Persisted for the same reason the other authorizing-gate fields are: the
    // retry-grant path reconstructs this reservation from candidate-revision lineage
    // long after the reservation itself has been replaced, and without a recorded
    // provider that reconstruction has to guess one.
    authorizingGateProvider: readExecutionProvider(gateReservation),
    authorizingGateWorkflowAttempt: gateReservation.workflowAttempt,
    authorizingGateReservationId: gateReservation.id,
    authorizingGateReservedAt: gateReservation.reservedAt,
    authorizingGateRunId: sourceRun.id,
    authorizingGateArtifactId: sourceArtifact.id,
    authorizingGateArtifactCreatedAt: sourceArtifact.createdAt,
    authorizingGateSnapshotDigest: createHash("sha256").update(JSON.stringify(snapshot)).digest("hex"),
  };
}

export function assertRepairAuthorizerUnchanged(task, candidate, repairReservation) {
  const current = repairAuthorizerSnapshot(task, candidate, repairReservation.authorizingGateStage);
  if (
    !sameRepairAuthorizerSnapshot(repairReservation, current) ||
    Date.parse(current.authorizingGateArtifactCreatedAt) >= Date.parse(repairReservation.reservedAt)
  ) {
    throw new Error("The repair authorizing gate changed after its workflow reservation.");
  }
}

export function sameRepairAuthorizerSnapshot(expected, current) {
  return [
    "authorizingGateStage",
    "authorizingGateProvider",
    "authorizingGateWorkflowAttempt",
    "authorizingGateReservationId",
    "authorizingGateReservedAt",
    "authorizingGateRunId",
    "authorizingGateArtifactId",
    "authorizingGateArtifactCreatedAt",
    "authorizingGateSnapshotDigest",
  ].every((field) => expected?.[field] === current?.[field]);
}

export function isCanonicalTimestamp(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

export function timestampAfter(value) {
  const current = now();
  if (!isCanonicalTimestamp(value) || Date.parse(current) > Date.parse(value)) return current;
  return new Date(Date.parse(value) + 1).toISOString();
}

export function sameRepairReservationAuthority(expected, current) {
  return [
    "id",
    "workflowAttempt",
    "reservedAt",
    "candidateId",
    "candidateRevision",
    "candidateHeadRevision",
    "provider",
    "authorizingGateStage",
    "authorizingGateProvider",
    "authorizingGateWorkflowAttempt",
    "authorizingGateReservationId",
    "authorizingGateReservedAt",
    "authorizingGateRunId",
    "authorizingGateArtifactId",
    "authorizingGateArtifactCreatedAt",
    "authorizingGateSnapshotDigest",
  ].every((field) => expected?.[field] === current?.[field]);
}
