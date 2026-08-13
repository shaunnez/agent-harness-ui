import {
  adjacentRepairAuthorizingGate,
  candidateGateAuthorizerEvidence,
  candidateRevisionLineage,
  candidateRevisionProducerEvidence,
  replacedCandidateMatchesReservation,
  targetRefreshesDescendFromReservation,
  validCandidateProducerReservation,
  validDurableRunArtifactEnvelope,
} from "./candidate-lineage-validation.mjs";
import { CANDIDATE_GATE_STAGES, resolveGateFreshness } from "./run-activity.mjs";
import { validPersistedTimestamp, validRetryReservationKind } from "./retry-reservation-validation.mjs";

export function validateGlobalRetryIdentities(task) {
  const runs = task.runs ?? [];
  const artifacts = task.artifacts ?? [];
  const reservationEntries = Object.entries(task.stageRunReservations ?? {}).filter(
    ([, reservation]) => reservation != null,
  );
  const runIds = runs.map((run) => run?.id);
  const artifactIds = artifacts.map((artifact) => artifact?.id);
  const linkedRunIds = artifacts.map((artifact) => artifact?.runId).filter((runId) => runId != null);
  const claimedArtifactIds = runs.map((run) => run?.artifactId).filter((artifactId) => artifactId != null);
  const reservationIds = reservationEntries.map(([, reservation]) => reservation?.id);
  if (
    runIds.some((id) => typeof id !== "string" || !id.trim()) ||
    new Set(runIds).size !== runIds.length ||
    artifactIds.some((id) => typeof id !== "string" || !id.trim()) ||
    new Set(artifactIds).size !== artifactIds.length ||
    linkedRunIds.some((id) => typeof id !== "string" || !id.trim()) ||
    new Set(linkedRunIds).size !== linkedRunIds.length ||
    claimedArtifactIds.some((id) => typeof id !== "string" || !id.trim()) ||
    new Set(claimedArtifactIds).size !== claimedArtifactIds.length ||
    reservationIds.some((id) => typeof id !== "string" || !id.trim()) ||
    new Set(reservationIds).size !== reservationIds.length ||
    reservationEntries.some(([stage, reservation]) => reservation?.stage !== stage) ||
    artifacts.some(
      (artifact) =>
        artifact?.runId != null &&
        !runs.some((run) => run.id === artifact.runId && run.artifactId === artifact.id),
    ) ||
    runs.some(
      (run) =>
        run?.artifactId != null &&
        !artifacts.some((artifact) => artifact.id === run.artifactId && artifact.runId === run.id),
    )
  ) {
    return "The exhausted workflow has duplicate or inconsistent persisted identities; resolve it before granting a retry.";
  }
  return null;
}

export function validRetryReservationCandidateBinding(
  reservation,
  candidateRequired,
  candidate,
  grantedStage,
  task,
) {
  const reservations = task.stageRunReservations;
  const implementationAttempt = task.attemptsByStage?.implement ?? 0;
  const allNull =
    reservation.candidateId == null &&
    reservation.candidateRevision == null &&
    reservation.candidateHeadRevision == null;
  if (!candidateRequired) return allNull;
  const lineage = candidateRevisionLineage(candidate);
  if (!lineage) return false;
  if (!candidateRevisionProducerEvidence(task, candidate, lineage)) return false;
  if (grantedStage !== "implement" && lineage.sourceReservations.has(reservation.id)) return false;
  const sourceReservation =
    reservation.id === candidate?.sourceWorkflowReservationId &&
    reservation.workflowAttempt === candidate?.sourceWorkflowAttempt;
  if (allNull) {
    return (
      grantedStage === "implement" &&
      sourceReservation &&
      reservation.kind === "implementation" &&
      validCandidateProducerReservation(task, candidate, reservation, lineage, implementationAttempt)
    );
  }
  const completeBinding =
    typeof reservation.candidateId === "string" &&
    reservation.candidateId.trim().length > 0 &&
    Number.isInteger(reservation.candidateRevision) &&
    reservation.candidateRevision > 0 &&
    typeof reservation.candidateHeadRevision === "string" &&
    reservation.candidateHeadRevision.trim().length > 0;
  if (!completeBinding) return false;
  const exactCurrentCandidate =
    reservation.candidateId === candidate?.id &&
    reservation.candidateRevision === candidate?.revisionNumber &&
    reservation.candidateHeadRevision === candidate?.headRevision;
  if (exactCurrentCandidate) {
    if (
      !validPersistedTimestamp(reservation.reservedAt) ||
      Date.parse(reservation.reservedAt) < Date.parse(lineage.currentRevision.createdAt)
    ) {
      return false;
    }
    if (grantedStage === "implement" && reservation.kind === "repair") {
      const originalAuthorizer = failedRepairAuthorizingGate(task, candidate, lineage, reservation);
      if (originalAuthorizer) return true;
      const latestAuthorizer = failedRepairAuthorizingGate(task, candidate, lineage);
      const validNoOp =
        latestAuthorizer &&
        validCompletedNoOpRepairBeforeLaterGate(task, candidate, reservation, lineage, latestAuthorizer);
      return Boolean(latestAuthorizer && validNoOp);
    }
    return validCandidateProducerReservation(
      task,
      candidate,
      reservations?.implement,
      lineage,
      implementationAttempt,
    );
  }
  if (grantedStage !== "implement") {
    if (targetRefreshesDescendFromReservation(lineage, candidate, reservation)) return true;
    if (replacedCandidateMatchesReservation(task, candidate, reservation)) return true;
    if (
      reservation.candidateId !== candidate?.id ||
      reservation.candidateRevision + 1 !== candidate?.revisionNumber
    ) {
      return false;
    }
    return Boolean(
      adjacentRepairAuthorizingGate(
        task,
        candidate,
        reservation,
        reservations?.implement,
        lineage,
        implementationAttempt,
      ),
    );
  }
  if (
    reservation.kind === "repair" &&
    targetRefreshesDescendFromReservation(lineage, candidate, reservation)
  ) {
    return validCandidateProducerReservation(task, candidate, reservation, lineage, implementationAttempt);
  }
  return (
    sourceReservation &&
    ["implementation", "repair"].includes(reservation.kind) &&
    validCandidateProducerReservation(task, candidate, reservation, lineage, implementationAttempt)
  );
}

function validCompletedNoOpRepairBeforeLaterGate(task, candidate, reservation, lineage, latestAuthorizer) {
  if (
    !validCandidateProducerReservation(
      task,
      candidate,
      reservation,
      lineage,
      task.attemptsByStage?.implement ?? 0,
    )
  )
    return false;
  const reservationRuns = (task.runs ?? []).filter((run) => run.workflowReservationId === reservation.id);
  const run = reservationRuns[0] ?? null;
  const artifact = run?.artifactId
    ? (task.artifacts ?? []).find((entry) => entry.id === run.artifactId)
    : null;
  const historicalReservation = {
    id: reservation.authorizingGateReservationId,
    stage: reservation.authorizingGateStage,
    kind: reservation.authorizingGateStage === "dev-review" ? "review" : reservation.authorizingGateStage,
    provider: reservation.authorizingGateProvider,
    workflowAttempt: reservation.authorizingGateWorkflowAttempt,
    candidateId: candidate.id,
    candidateRevision: candidate.revisionNumber,
    candidateHeadRevision: candidate.headRevision,
    authorizedRunScopes: [],
    reservedAt: reservation.authorizingGateReservedAt,
  };
  const historicalAuthorizer = candidateGateAuthorizerEvidence(
    task,
    historicalReservation,
    { candidateId: candidate.id, candidateRevision: candidate.revisionNumber },
    { latestArtifactAt: reservation.reservedAt },
  );
  return (
    reservationRuns.length === 1 &&
    run?.stage === "implement" &&
    run.kind === "repair" &&
    run.role === "repair" &&
    run.status === "completed" &&
    run.workPackageId == null &&
    run.workflowAttempt === reservation.workflowAttempt &&
    run.candidateId === candidate.id &&
    run.candidateRevision === candidate.revisionNumber &&
    run.candidateHeadRevision === candidate.headRevision &&
    artifact?.runId === run.id &&
    artifact.stage === "implement" &&
    artifact.kind === "markdown" &&
    artifact.candidateId === candidate.id &&
    artifact.candidateRevision === candidate.revisionNumber &&
    /<no-changes-needed>[\s\S]*<\/no-changes-needed>/i.test(artifact.content ?? "") &&
    validDurableRunArtifactEnvelope(run, artifact, {
      earliestStartedAt: reservation.reservedAt,
      latestCompletedAt: artifact.createdAt,
      latestArtifactAt: latestAuthorizer.reservedAt,
    }) &&
    historicalAuthorizer?.id === reservation.authorizingGateReservationId &&
    historicalAuthorizer.sourceRunId === reservation.authorizingGateRunId &&
    historicalAuthorizer.sourceArtifactId === reservation.authorizingGateArtifactId &&
    Date.parse(latestAuthorizer.reservedAt) > Date.parse(artifact.createdAt)
  );
}

export function failedRepairAuthorizingGate(task, candidate, lineage, repairReservation = null) {
  if (!lineage) return null;
  const reservations = task.stageRunReservations;
  const attemptsByStage = task.attemptsByStage;
  const gateStages = new Set(["dev-review", "test", "final-review"]);
  const retainedGates = Object.values(reservations ?? {}).filter((reservation) =>
    gateStages.has(reservation?.stage),
  );
  if (repairReservation && retainedGates.some((reservation) => reservation?.id === repairReservation.id))
    return null;
  const retainedGateIds = retainedGates.map((reservation) => reservation?.id);
  if (
    retainedGateIds.some((id) => typeof id !== "string" || !id.trim()) ||
    new Set(retainedGateIds).size !== retainedGateIds.length ||
    retainedGateIds.some((id) => lineage.sourceReservations.has(id))
  ) {
    return null;
  }
  const requestedGateStage = CANDIDATE_GATE_STAGES.includes(task.currentStage)
    ? task.currentStage
    : task.stageRunReservations?.implement?.authorizingGateStage;
  const exactCandidateGates = retainedGates.filter(
    (reservation) =>
      reservation?.candidateId === candidate.id &&
      reservation?.candidateRevision === candidate.revisionNumber &&
      reservation?.candidateHeadRevision === candidate.headRevision,
  );
  if (!exactCandidateGates.length) return null;
  const candidateCreatedAt = Date.parse(lineage.currentRevision.createdAt);
  let authorizingGate = null;
  for (const gateReservation of exactCandidateGates) {
    if (
      typeof gateReservation.id !== "string" ||
      !gateReservation.id.trim() ||
      !validPersistedTimestamp(gateReservation.reservedAt) ||
      !validRetryReservationKind(gateReservation.stage, gateReservation.kind) ||
      !Number.isInteger(gateReservation.workflowAttempt) ||
      gateReservation.workflowAttempt < 1 ||
      gateReservation.workflowAttempt !== attemptsByStage?.[gateReservation.stage] ||
      reservations?.[gateReservation.stage] !== gateReservation
    ) {
      return null;
    }
    const gateReservedAt = Date.parse(gateReservation.reservedAt);
    if (gateReservedAt < candidateCreatedAt) return null;
    if (gateReservation.stage === requestedGateStage) {
      if (authorizingGate) return null;
      authorizingGate = gateReservation;
    }
  }
  // `task.currentStage` is not a stable stand-in for "the gate stage this repair
  // answers": a failed repair attempt moves it to "implement" (repair is an implement
  // run), even though the candidate is still repair-required against whichever gate
  // stage actually failed. `repairAuthorizerSnapshot` already resolves this correctly
  // — falling back to the implement reservation's own recorded `authorizingGateStage`
  // whenever `currentStage` is not itself a candidate-gate stage — and this check must
  // agree with it, or every repair attempt after the first exhausts the stage with no
  // way to grant another: recorded live on AH-002, whose second repair attempt failed
  // (an unrelated, real empty-diff bug now fixed separately) and left `currentStage`
  // at "implement" while the authorizing dev-review reservation never moved.
  if (authorizingGate?.stage !== requestedGateStage) return null;
  const authoritativeGate = candidateGateAuthorizerEvidence(
    task,
    authorizingGate,
    { candidateId: candidate.id, candidateRevision: candidate.revisionNumber },
    { latestArtifactAt: repairReservation?.reservedAt ?? null },
  );
  const currentFreshness = resolveGateFreshness(task, authorizingGate.stage);
  // Same reasoning as `candidateGateAuthorizerEvidence`'s own reasonCode check just
  // above: a REPAIR verdict whose only complaint is a non-blocking finding's inherited
  // (non-explicit) binding is classified `missing_binding` by the freshness marker
  // check, not `repair_required`, even though it is the same authoritative gate.
  if (
    !authoritativeGate ||
    !["repair_required", "missing_binding"].includes(currentFreshness?.reasonCode) ||
    currentFreshness.sourceRunId !== authoritativeGate.sourceRunId ||
    currentFreshness.sourceArtifactId !== authoritativeGate.sourceArtifactId
  ) {
    return null;
  }
  if (!repairReservation) return authoritativeGate;
  const sourceArtifact = (task.artifacts ?? []).find(
    (artifact) => artifact.id === authoritativeGate.sourceArtifactId,
  );
  return repairReservation.workflowAttempt > candidate.sourceWorkflowAttempt &&
    !lineage.sourceReservations.has(repairReservation.id) &&
    Date.parse(repairReservation.reservedAt) > Date.parse(authorizingGate.reservedAt) &&
    Date.parse(repairReservation.reservedAt) > Date.parse(sourceArtifact.createdAt)
    ? authoritativeGate
    : null;
}
