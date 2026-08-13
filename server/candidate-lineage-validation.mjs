import { CANDIDATE_GATE_STAGES, readExecutionProvider, resolvePersistedRunFreshness } from "./run-activity.mjs";
import {
  validCandidateAssemblyMembership,
  validInitialCandidateProducer,
  validPersistedTimestamp,
  validRetryCandidate,
  validRetryRunTuple,
} from "./retry-reservation-validation.mjs";

export function candidateGateAuthorizerEvidence(task, gateReservation, target, { latestArtifactAt = null } = {}) {
  const gateStageRuns = (task.runs ?? []).filter((run) => run.stage === gateReservation?.stage);
  const reservationRuns = gateStageRuns.filter((run) => run.workflowReservationId === gateReservation?.id);
  const sourceRun = reservationRuns[0] ?? null;
  const sourceArtifacts = sourceRun?.artifactId
    ? (task.artifacts ?? []).filter((artifact) => artifact.id === sourceRun.artifactId)
    : [];
  const sourceArtifact = sourceArtifacts[0] ?? null;
  const freshness = sourceRun
    ? resolvePersistedRunFreshness(
        sourceRun,
        sourceArtifact,
        target,
        gateReservation.stage,
        readExecutionProvider(gateReservation),
      )
    : null;
  // Recorded live (AH-002 dev-review): a completed run whose gate finding was
  // non-blocking (P2/P3) and lacked its own explicit `candidateId`/`candidateRevision`
  // — falling back to the top-level binding, exactly as `parseGateEvidence` allows for
  // a REPAIR verdict — gets classified `missing_binding` by the freshness layer's
  // marker check (`persistedBindingMarkerReason`), not `repair_required`, even though
  // `sourceRun.gateResult?.verdict === "REPAIR"` is independently verified below. Ruling
  // that candidate's own genuine repair need un-authorizable left it permanently stuck
  // once its repair-attempt budget ran out, with no path to grant another. Both codes
  // describe the same completed, content-driven REPAIR verdict; only the diagnosis
  // differs, so both authorize the grant.
  if (
    reservationRuns.length !== 1 ||
    !isHistoricalRepairLineageReason(freshness?.reasonCode) ||
    sourceRun.status !== "completed" ||
    sourceRun.workflowReservationId !== gateReservation.id ||
    sourceRun.workflowAttempt !== gateReservation.workflowAttempt ||
    sourceRun.gateResult?.verdict !== "REPAIR" ||
    !validRetryRunTuple(sourceRun, gateReservation, gateStageRuns) ||
    sourceArtifacts.length !== 1 ||
    sourceArtifact.runId !== sourceRun.id ||
    sourceArtifact.stage !== gateReservation.stage ||
    sourceArtifact.kind !== "markdown" ||
    typeof sourceArtifact.name !== "string" ||
    !sourceArtifact.name.trim() ||
    typeof sourceArtifact.content !== "string" ||
    !sourceArtifact.content.trim() ||
    sourceArtifact.candidateId !== target.candidateId ||
    sourceArtifact.candidateRevision !== target.candidateRevision ||
    JSON.stringify(sourceArtifact.gateResult) !== JSON.stringify(sourceRun.gateResult) ||
    !validDurableRunArtifactEnvelope(sourceRun, sourceArtifact, {
      earliestStartedAt: gateReservation.reservedAt,
      latestCompletedAt: sourceRun.gateResult?.evaluatedAt,
      latestArtifactAt,
    }) ||
    !validPersistedTimestamp(sourceRun.gateResult?.evaluatedAt) ||
    Date.parse(sourceRun.gateResult.evaluatedAt) > Date.parse(sourceArtifact.createdAt)
  ) {
    return null;
  }
  return {
    ...gateReservation,
    sourceArtifactId: sourceArtifact.id,
    sourceRunId: sourceRun.id,
  };
}

function isHistoricalRepairLineageReason(reasonCode) {
  // A failed candidate command still prevents this gate from becoming fresh and the
  // live repair-grant path above continues to reject it. Once a later revision already
  // exists, however, its exact bound REPAIR finding remains the immutable causal
  // authorizer for that historical repair. Losing that lineage would strand the
  // repaired candidate and make an honest rerun impossible. This caller also requires
  // a completed REPAIR verdict, exact binding, linked artifact, and durable timestamps,
  // so command failure is admitted only as retained provenance, never as green proof.
  return ["repair_required", "missing_binding", "command_failure"].includes(reasonCode);
}

export function candidateRevisionLineage(candidate) {
  const revisions = candidate?.revisions;
  if (!Array.isArray(revisions) || revisions.length !== candidate.revisionNumber) return null;
  const byNumber = new Map();
  const heads = new Set();
  const sourceReservations = new Set();
  const authorizingReservations = new Set();
  const authorizingRuns = new Set();
  const authorizingArtifacts = new Set();
  for (const revision of revisions) {
    const repairRevision = revision?.number > 1 && revision?.reason === "repair";
    const targetRefreshRevision = revision?.number > 1 && revision?.reason === "target-refresh";
    const hasValidRepairAuthorizer = repairRevision &&
      CANDIDATE_GATE_STAGES.includes(revision.authorizingGateStage) &&
      Number.isInteger(revision.authorizingGateWorkflowAttempt) &&
      revision.authorizingGateWorkflowAttempt > 0 &&
      typeof revision.authorizingGateReservationId === "string" &&
      revision.authorizingGateReservationId.trim().length > 0 &&
      typeof revision.authorizingGateRunId === "string" &&
      revision.authorizingGateRunId.trim().length > 0 &&
      typeof revision.authorizingGateArtifactId === "string" &&
      revision.authorizingGateArtifactId.trim().length > 0 &&
      validPersistedTimestamp(revision.authorizingGateReservedAt);
    const hasNoRepairAuthorizer = !repairRevision && [
      revision?.authorizingGateStage,
      revision?.authorizingGateWorkflowAttempt,
      revision?.authorizingGateReservationId,
      revision?.authorizingGateReservedAt,
      revision?.authorizingGateRunId,
      revision?.authorizingGateArtifactId,
    ].every((value) => value == null);
    if (
      !Number.isInteger(revision?.number) ||
      revision.number < 1 ||
      revision.number > candidate.revisionNumber ||
      byNumber.has(revision.number) ||
      typeof revision.headRevision !== "string" ||
      !revision.headRevision.trim() ||
      heads.has(revision.headRevision) ||
      (revision.number === 1
        ? revision.reason !== "assembly"
        : !["repair", "target-refresh"].includes(revision.reason)) ||
      (!targetRefreshRevision && (
        !Number.isInteger(revision.sourceWorkflowAttempt) ||
        revision.sourceWorkflowAttempt < 1 ||
        typeof revision.sourceWorkflowReservationId !== "string" ||
        !revision.sourceWorkflowReservationId.trim() ||
        sourceReservations.has(revision.sourceWorkflowReservationId) ||
        !validPersistedTimestamp(revision.sourceWorkflowReservedAt)
      )) ||
      (targetRefreshRevision && (
        typeof revision.previousBaseRevision !== "string" ||
        !revision.previousBaseRevision.trim() ||
        typeof revision.baseRevision !== "string" ||
        !revision.baseRevision.trim() ||
        revision.previousBaseRevision === revision.baseRevision ||
        [revision.sourceWorkflowAttempt, revision.sourceWorkflowReservationId, revision.sourceWorkflowReservedAt]
          .some((value) => value != null)
      )) ||
      (!repairRevision && !hasNoRepairAuthorizer) ||
      (repairRevision && !hasValidRepairAuthorizer) ||
      (repairRevision && (
        authorizingReservations.has(revision.authorizingGateReservationId) ||
        authorizingRuns.has(revision.authorizingGateRunId) ||
        authorizingArtifacts.has(revision.authorizingGateArtifactId) ||
        revision.authorizingGateReservationId === revision.sourceWorkflowReservationId
      )) ||
      !validPersistedTimestamp(revision.createdAt)
    ) {
      return null;
    }
    byNumber.set(revision.number, revision);
    heads.add(revision.headRevision);
    if (!targetRefreshRevision) sourceReservations.add(revision.sourceWorkflowReservationId);
    if (repairRevision) {
      authorizingReservations.add(revision.authorizingGateReservationId);
      authorizingRuns.add(revision.authorizingGateRunId);
      authorizingArtifacts.add(revision.authorizingGateArtifactId);
    }
  }
  if ([...authorizingReservations].some((id) => sourceReservations.has(id))) return null;
  let previousAttempt = 0;
  let previousCreatedAt = -Infinity;
  let currentProducerRevision = null;
  for (let number = 1; number <= candidate.revisionNumber; number += 1) {
    const revision = byNumber.get(number);
    if (!revision) return null;
    const createdAt = Date.parse(revision.createdAt);
    if (createdAt <= previousCreatedAt) return null;
    if (
      revision.reason === "target-refresh" &&
      revision.previousHeadRevision != null &&
      revision.previousHeadRevision !== byNumber.get(number - 1)?.headRevision
    ) {
      return null;
    }
    if (revision.reason !== "target-refresh") {
      const sourceReservedAt = Date.parse(revision.sourceWorkflowReservedAt);
      if (
        revision.sourceWorkflowAttempt <= previousAttempt ||
        sourceReservedAt > createdAt ||
        (number > 1 && sourceReservedAt <= previousCreatedAt)
      ) {
        return null;
      }
      previousAttempt = revision.sourceWorkflowAttempt;
      currentProducerRevision = revision;
    }
    previousCreatedAt = createdAt;
  }
  const currentRevision = byNumber.get(candidate.revisionNumber);
  if (
    currentRevision.headRevision !== candidate.headRevision ||
    currentProducerRevision?.sourceWorkflowReservationId !== candidate.sourceWorkflowReservationId ||
    currentProducerRevision?.sourceWorkflowAttempt !== candidate.sourceWorkflowAttempt ||
    (currentRevision.reason === "target-refresh" && currentRevision.baseRevision !== candidate.baseRevision)
  ) {
    return null;
  }
  return {
    authorizingArtifacts,
    authorizingReservations,
    authorizingRuns,
    byNumber,
    currentRevision,
    sourceReservations,
  };
}

export function targetRefreshesDescendFromReservation(lineage, candidate, reservation) {
  if (
    !lineage ||
    reservation?.candidateId !== candidate?.id ||
    !Number.isInteger(reservation?.candidateRevision) ||
    reservation.candidateRevision < 1 ||
    reservation.candidateRevision >= candidate.revisionNumber ||
    !validPersistedTimestamp(reservation.reservedAt)
  ) {
    return false;
  }
  const reservedRevision = lineage.byNumber.get(reservation.candidateRevision);
  if (
    !reservedRevision ||
    reservation.candidateHeadRevision !== reservedRevision.headRevision ||
    Date.parse(reservation.reservedAt) < Date.parse(reservedRevision.createdAt)
  ) {
    return false;
  }
  for (let number = reservation.candidateRevision + 1; number <= candidate.revisionNumber; number += 1) {
    if (lineage.byNumber.get(number)?.reason !== "target-refresh") return false;
  }
  return true;
}

export function replacedCandidateMatchesReservation(task, candidate, reservation) {
  const candidates = task.candidates ?? [];
  const currentIndex = candidates.length - 1;
  const previous = candidates[currentIndex - 1];
  const currentRevision = candidate?.revisions?.[0];
  return currentIndex > 0 &&
    candidates[currentIndex] === candidate &&
    currentRevision?.reason === "assembly" &&
    ["failed", "superseded"].includes(previous?.status) &&
    validRetryCandidate(previous) &&
    reservation?.candidateId === previous.id &&
    reservation.candidateRevision === previous.revisionNumber &&
    reservation.candidateHeadRevision === previous.headRevision &&
    validPersistedTimestamp(reservation.reservedAt) &&
    validPersistedTimestamp(currentRevision.createdAt) &&
    Date.parse(reservation.reservedAt) < Date.parse(currentRevision.createdAt);
}

export function candidateRevisionProducerEvidence(task, candidate, lineage) {
  if (!validCandidateAssemblyMembership(task, candidate)) return null;
  const allRuns = task.runs ?? [];
  const runs = [];
  const artifacts = [];
  const authorizerArtifacts = [];
  const authorizerReservations = [];
  const authorizerRuns = [];
  const packageIds = new Set(task.workPackages.map((workPackage) => workPackage.id));
  for (let number = 1; number <= candidate.revisionNumber; number += 1) {
    const revision = lineage.byNumber.get(number);
    if (revision.reason === "target-refresh") continue;
    const revisionRuns = allRuns.filter((run) => (
      run.workflowReservationId === revision.sourceWorkflowReservationId &&
      run.workflowAttempt === revision.sourceWorkflowAttempt
    ));
    if (number === 1) {
      const runScopes = revisionRuns.map((run) => run.workPackageId);
      const syntheticReservation = {
        id: revision.sourceWorkflowReservationId,
        stage: "implement",
        kind: "implementation",
        workflowAttempt: revision.sourceWorkflowAttempt,
        candidateId: null,
        candidateRevision: null,
        candidateHeadRevision: null,
        authorizedRunScopes: runScopes,
      };
      if (
        new Set(runScopes).size !== runScopes.length ||
        revisionRuns.some((run) => (
          run.stage !== "implement" ||
          run.kind !== "implementation" ||
          run.role !== "implement" ||
          run.status !== "completed" ||
          typeof run.workPackageId !== "string" ||
          !packageIds.has(run.workPackageId) ||
          run.candidateId != null ||
          run.candidateRevision != null ||
          run.candidateHeadRevision != null ||
          !validRetryRunTuple(run, syntheticReservation, allRuns.filter((item) => item.stage === "implement"))
        ))
      ) {
        return null;
      }
      revisionRuns.sort((left, right) => left.workPackageId.localeCompare(right.workPackageId));
    } else {
      const priorRevision = lineage.byNumber.get(number - 1);
      const authorizer = candidateRevisionAuthorizerEvidence(task, candidate, revision, priorRevision);
      if (!authorizer) return null;
      authorizerReservations.push(authorizer.reservation);
      authorizerRuns.push(authorizer.run);
      authorizerArtifacts.push(authorizer.artifact);
      if (revisionRuns.length !== 1) return null;
      const run = revisionRuns[0];
      const syntheticReservation = {
        id: revision.sourceWorkflowReservationId,
        stage: "implement",
        kind: "repair",
        workflowAttempt: revision.sourceWorkflowAttempt,
        candidateId: candidate.id,
        candidateRevision: priorRevision.number,
        candidateHeadRevision: priorRevision.headRevision,
        authorizedRunScopes: [],
      };
      if (
        run.stage !== "implement" ||
        run.kind !== "repair" ||
        run.role !== "repair" ||
        run.status !== "completed" ||
        run.workPackageId != null ||
        run.candidateId !== candidate.id ||
        run.candidateRevision !== priorRevision.number ||
        run.candidateHeadRevision !== priorRevision.headRevision ||
        !validRetryRunTuple(run, syntheticReservation, allRuns.filter((item) => item.stage === "implement"))
      ) {
        return null;
      }
    }
    for (const run of revisionRuns) {
      const artifact = linkedProducerArtifact(task, candidate, revision, run);
      if (!artifact) return null;
      runs.push(run);
      artifacts.push(artifact);
    }
  }
  return {
    artifacts,
    authorizerArtifacts,
    authorizerReservations,
    authorizerRuns,
    runs,
  };
}

function candidateRevisionAuthorizerEvidence(task, candidate, revision, priorRevision) {
  const reservation = {
    id: revision.authorizingGateReservationId,
    stage: revision.authorizingGateStage,
    kind: revision.authorizingGateStage === "dev-review" ? "review" : revision.authorizingGateStage,
    // Recorded on the revision, not assumed. Defaulting this to the default provider
    // would fail every Claude gate that authorized a repair, on a task that never
    // involved Codex at all.
    provider: readExecutionProvider({ provider: revision.authorizingGateProvider }),
    workflowAttempt: revision.authorizingGateWorkflowAttempt,
    candidateId: candidate.id,
    candidateRevision: priorRevision.number,
    candidateHeadRevision: priorRevision.headRevision,
    authorizedRunScopes: [],
    reservedAt: revision.authorizingGateReservedAt,
  };
  if (
    Date.parse(reservation.reservedAt) < Date.parse(priorRevision.createdAt) ||
    Date.parse(reservation.reservedAt) >= Date.parse(revision.sourceWorkflowReservedAt)
  ) {
    return null;
  }
  const authoritativeGate = candidateGateAuthorizerEvidence(
    task,
    reservation,
    { candidateId: candidate.id, candidateRevision: priorRevision.number },
    { latestArtifactAt: revision.sourceWorkflowReservedAt },
  );
  if (
    !authoritativeGate ||
    authoritativeGate.sourceRunId !== revision.authorizingGateRunId ||
    authoritativeGate.sourceArtifactId !== revision.authorizingGateArtifactId
  ) {
    return null;
  }
  const run = (task.runs ?? []).find((item) => item.id === authoritativeGate.sourceRunId);
  const artifact = (task.artifacts ?? []).find((item) => item.id === authoritativeGate.sourceArtifactId);
  return Date.parse(artifact.createdAt) < Date.parse(revision.sourceWorkflowReservedAt)
    ? { artifact, reservation, run }
    : null;
}

function linkedProducerArtifact(task, candidate, revision, run) {
  if (typeof run.artifactId !== "string" || !run.artifactId.trim()) return null;
  const matching = (task.artifacts ?? []).filter((artifact) => artifact.id === run.artifactId);
  if (matching.length !== 1) return null;
  const artifact = matching[0];
  const initialRevision = revision.number === 1;
  return artifact.runId === run.id &&
    artifact.stage === "implement" &&
    artifact.kind === "markdown" &&
    typeof artifact.name === "string" &&
    artifact.name.trim().length > 0 &&
    typeof artifact.content === "string" &&
    artifact.content.trim().length > 0 &&
    artifact.candidateId === (initialRevision ? null : candidate.id) &&
    artifact.candidateRevision === (initialRevision ? null : revision.number) &&
    artifact.workPackageId === (initialRevision ? run.workPackageId : null) &&
    validDurableRunArtifactEnvelope(run, artifact, {
      earliestStartedAt: revision.sourceWorkflowReservedAt,
      latestCompletedAt: null,
      latestArtifactAt: revision.createdAt,
    })
    ? artifact
    : null;
}

export function validDurableRunArtifactEnvelope(run, artifact, {
  earliestStartedAt,
  latestCompletedAt,
  latestArtifactAt,
}) {
  if (
    !validPersistedTimestamp(run?.startedAt) ||
    !validPersistedTimestamp(run?.completedAt) ||
    !validPersistedTimestamp(artifact?.createdAt)
  ) {
    return false;
  }
  const startedAt = Date.parse(run.startedAt);
  const completedAt = Date.parse(run.completedAt);
  const artifactAt = Date.parse(artifact.createdAt);
  return startedAt <= completedAt &&
    completedAt <= artifactAt &&
    (earliestStartedAt == null || (
      validPersistedTimestamp(earliestStartedAt) && Date.parse(earliestStartedAt) <= startedAt
    )) &&
    (latestCompletedAt == null || (
      validPersistedTimestamp(latestCompletedAt) && completedAt <= Date.parse(latestCompletedAt)
    )) &&
    (latestArtifactAt == null || (
      validPersistedTimestamp(latestArtifactAt) && artifactAt <= Date.parse(latestArtifactAt)
    ));
}

export function validCandidateProducerReservation(task, candidate, producerReservation, lineage, implementationAttempt) {
  if (!producerReservation || !validPersistedTimestamp(producerReservation.reservedAt)) return false;
  const currentRevision = lineage.currentRevision;
  if (producerReservation.workflowAttempt !== implementationAttempt || producerReservation.stage !== "implement") {
    return false;
  }
  const producerReservedAt = Date.parse(producerReservation.reservedAt);
  const currentCreatedAt = Date.parse(currentRevision.createdAt);
  const latestImplementedRevision = currentRevision.reason === "target-refresh"
    ? [...lineage.byNumber.values()].reverse().find((revision) => revision.reason !== "target-refresh")
    : currentRevision;
  const noOpBoundRevision = Number.isInteger(producerReservation.candidateRevision)
    ? lineage.byNumber.get(producerReservation.candidateRevision)
    : null;
  const noOpStillCurrent = noOpBoundRevision?.number === currentRevision.number || (
    noOpBoundRevision &&
    producerReservedAt <= currentCreatedAt &&
    [...lineage.byNumber.values()].every((revision) => (
      revision.number <= noOpBoundRevision.number || revision.reason === "target-refresh"
    ))
  );
  // A no-op repair (its own `<no-changes-needed>` marker, verified by `commit` — see
  // `#runRepair`) leaves the candidate at its *existing* revision by design: nothing
  // about the revision's true provenance changed, so the most recent implement
  // reservation can legitimately be a repair *of* the current revision without being
  // (or needing to equal) the reservation that originally produced it. Requiring an
  // exact identity match here would treat every such no-op repair as if it had
  // corrupted the candidate's lineage, when the lineage never moved at all.
  if (
    noOpBoundRevision &&
    noOpStillCurrent &&
    producerReservation.kind === "repair" &&
    producerReservation.candidateId === candidate.id &&
    producerReservation.candidateHeadRevision === noOpBoundRevision.headRevision &&
    producerReservedAt > Date.parse(noOpBoundRevision.createdAt)
  ) {
    return true;
  }
  // A target refresh is mechanical lineage: it changes the candidate base and head,
  // but it does not create a new implementation producer. Retry authority therefore
  // remains bound to the newest preceding assembly/repair reservation. Without this
  // lookup, a genuine defect found after refresh can never receive a human-granted
  // repair once the Implement allowance is exhausted—the refresh revision correctly
  // has no sourceWorkflowReservationId of its own.
  const producerRevision = latestImplementedRevision;
  if (!producerRevision) return false;
  if (
    producerReservation.id !== producerRevision.sourceWorkflowReservationId ||
    producerReservation.workflowAttempt !== producerRevision.sourceWorkflowAttempt ||
    producerReservation.reservedAt !== producerRevision.sourceWorkflowReservedAt
  ) {
    return false;
  }
  if (producerRevision.number === 1) {
    return producerReservation.kind === "implementation" &&
      producerReservation.candidateId == null &&
      producerReservation.candidateRevision == null &&
      producerReservation.candidateHeadRevision == null &&
      producerReservedAt <= Date.parse(producerRevision.createdAt) &&
      validInitialCandidateProducer(task, candidate, producerReservation);
  }
  const priorRevision = lineage.byNumber.get(producerRevision.number - 1);
  return producerReservation.kind === "repair" &&
    producerReservation.candidateId === candidate.id &&
    producerReservation.candidateRevision === priorRevision.number &&
    producerReservation.candidateHeadRevision === priorRevision.headRevision &&
    producerReservedAt > Date.parse(priorRevision.createdAt) &&
    producerReservedAt <= Date.parse(producerRevision.createdAt);
}

export function adjacentRepairAuthorizingGate(task, candidate, priorReservation, repairReservation, lineage, implementationAttempt) {
  if (!validCandidateProducerReservation(task, candidate, repairReservation, lineage, implementationAttempt)) return false;
  const currentRevision = lineage.currentRevision;
  const priorRevision = lineage.byNumber.get(currentRevision.number - 1);
  const priorCreatedAt = Date.parse(priorRevision?.createdAt);
  const currentCreatedAt = Date.parse(currentRevision?.createdAt);
  const priorReservedAt = Date.parse(priorReservation?.reservedAt);
  const repairReservedAt = Date.parse(repairReservation?.reservedAt);
  const validLineage = priorReservation.candidateRevision + 1 === candidate.revisionNumber &&
    priorReservation.candidateId === candidate.id &&
    priorRevision?.headRevision === priorReservation.candidateHeadRevision &&
    priorReservation.id !== repairReservation.id &&
    priorReservedAt >= priorCreatedAt &&
    priorReservedAt < currentCreatedAt &&
    repairReservedAt > priorReservedAt &&
    repairReservedAt <= currentCreatedAt;
  if (!validLineage) return null;
  // The exhausted gate does not have to be the gate that authorized this repair.
  // A later Test or Final Review can request a new revision after Development Review
  // has already consumed its allowance; every earlier candidate-bound gate is then
  // stale and must rerun. The prior reservation above remains the exact retry source,
  // while the current revision's own recorded authorizer proves why the adjacent
  // revision exists. Keeping those identities distinct avoids both stranding the task
  // and pretending the prior gate authorized a repair that it did not request.
  const revisionAuthorizer = candidateRevisionAuthorizerEvidence(
    task,
    candidate,
    currentRevision,
    priorRevision,
  );
  if (!revisionAuthorizer || Date.parse(revisionAuthorizer.artifact.createdAt) >= repairReservedAt) return null;
  return {
    ...revisionAuthorizer.reservation,
    sourceArtifactId: revisionAuthorizer.artifact.id,
    sourceRunId: revisionAuthorizer.run.id,
  };
}
