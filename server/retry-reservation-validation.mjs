import { SCOUT_NAMES } from "./scouts.mjs";

export function validRetryCandidate(candidate) {
  return (
    typeof candidate?.id === "string" &&
    candidate.id.trim().length > 0 &&
    Number.isInteger(candidate.revisionNumber) &&
    candidate.revisionNumber > 0 &&
    typeof candidate.headRevision === "string" &&
    candidate.headRevision.trim().length > 0
  );
}

export function validPersistedTimestamp(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) && timestamp.toISOString() === value;
}

export function validRetryWorkflowIdentities(stageRuns, reservation, currentAttempts) {
  for (const run of stageRuns) {
    const hasWorkflowAttempt = run.workflowAttempt != null;
    const hasReservationId = run.workflowReservationId != null;
    if (hasWorkflowAttempt !== hasReservationId) return false;
    if (!hasWorkflowAttempt) continue;
    if (
      !Number.isInteger(run.workflowAttempt) ||
      run.workflowAttempt < 1 ||
      run.workflowAttempt > currentAttempts ||
      typeof run.workflowReservationId !== "string" ||
      !run.workflowReservationId.trim()
    ) {
      return false;
    }
    if (!reservation) return false;
    if (run.workflowAttempt === currentAttempts && run.workflowReservationId !== reservation.id) return false;
    if (run.workflowReservationId === reservation.id && run.workflowAttempt !== reservation.workflowAttempt)
      return false;
  }
  return true;
}

export function validRetryReservationKind(stage, kind) {
  const allowed =
    {
      triage: ["investigation"],
      scouts: ["investigation"],
      grill: ["investigation"],
      specification: ["investigation", "specification"],
      plan: ["planning"],
      implement: ["implementation", "repair"],
      "dev-review": ["review"],
      test: ["test"],
      "final-review": ["final-review"],
    }[stage] ?? [];
  return allowed.includes(kind);
}

export function validRetryRunTuple(run, reservation, stageRuns) {
  const expected =
    reservation.kind === "repair"
      ? { kind: "repair", role: "repair", workPackage: "none" }
      : reservation.kind === "implementation"
        ? { kind: "implementation", role: "implement", workPackage: "required" }
        : {
            triage: { kind: "agent", role: "triage", workPackage: "none" },
            scouts:
              Array.isArray(reservation.authorizedRunScopes) && reservation.authorizedRunScopes.length
                ? { kind: "scout", role: "authorized-scout", workPackage: "none" }
                : { kind: "agent", role: "scouts", workPackage: "none" },
            grill: { kind: "agent", role: "grill", workPackage: "none" },
            specification: { kind: "agent", role: "specification", workPackage: "none" },
            plan: { kind: "agent", role: "plan", workPackage: "none" },
            "dev-review": { kind: "review", role: "dev-review", workPackage: "none" },
            test: { kind: "test", role: "test", workPackage: "none" },
            "final-review": { kind: "final-review", role: "final-review", workPackage: "none" },
          }[reservation.stage];
  if (typeof run.id !== "string" || !run.id.trim()) return false;
  if (!expected || run.kind !== expected.kind) return false;
  if (expected.role === "authorized-scout") {
    if (!reservation.authorizedRunScopes.includes(run.role)) return false;
  } else if (run.role !== expected.role) return false;
  if (expected.workPackage === "none" && run.workPackageId != null) return false;
  if (
    expected.workPackage === "required" &&
    (typeof run.workPackageId !== "string" || !run.workPackageId.trim())
  )
    return false;
  if (!Number.isInteger(run.attempt) || run.attempt < 1) return false;
  let scopeAttempt = 0;
  for (const scopedRun of stageRuns) {
    if (
      scopedRun.stage === run.stage &&
      scopedRun.role === run.role &&
      scopedRun.workPackageId === run.workPackageId &&
      scopedRun.candidateId === run.candidateId &&
      scopedRun.candidateRevision === run.candidateRevision
    ) {
      scopeAttempt += 1;
    }
    if (scopedRun.id === run.id) return run.attempt === scopeAttempt;
  }
  return false;
}

export function validateRetryRunScopes(task, reservation, reservationRuns) {
  const multiRunStage = reservation?.kind === "implementation" || reservation?.stage === "scouts";
  if (!multiRunStage) {
    if (reservationRuns.length <= 1) return null;
    return "The exhausted workflow reservation has multiple source runs for a singleton stage; resolve the inconsistent history before granting a retry.";
  }
  const authorized = reservation.authorizedRunScopes;
  if (
    !Array.isArray(authorized) ||
    authorized.some((scope) => typeof scope !== "string" || !scope.trim()) ||
    new Set(authorized).size !== authorized.length
  ) {
    return "The exhausted multi-run reservation is missing unique authorized run scopes; resolve the inconsistent history before granting a retry.";
  }
  if (
    reservation.kind === "implementation" &&
    !authorized.length &&
    !validAssemblyOnlyCandidateProducer(task, reservation, reservationRuns)
  ) {
    return "The exhausted Implementation reservation is missing an authorized work-package scope; resolve the inconsistent history before granting a retry.";
  }
  if (
    reservation.kind === "implementation" &&
    authorized.length &&
    !validImplementationScopeSnapshot(task, authorized)
  ) {
    return "The exhausted Implementation reservation does not match the persisted work-package plan; resolve the inconsistent history before granting a retry.";
  }
  if (reservation.stage === "scouts") {
    const selected = (task.scoutDispatch?.selected ?? []).map((scout) => scout?.name);
    if (
      selected.length !== authorized.length ||
      new Set(selected).size !== selected.length ||
      selected.some((scope) => !SCOUT_NAMES.includes(scope)) ||
      selected.some((scope) => !authorized.includes(scope))
    ) {
      return "The exhausted Scout reservation does not match its persisted dispatch; resolve the inconsistent history before granting a retry.";
    }
  }
  const runScopes = reservationRuns.map((run) =>
    reservation.kind === "implementation" ? run.workPackageId : run.role,
  );
  if (
    new Set(runScopes).size !== runScopes.length ||
    runScopes.some((scope) => !authorized.includes(scope))
  ) {
    return "The exhausted multi-run reservation contains duplicate or unauthorized run scopes; resolve the inconsistent history before granting a retry.";
  }
  return null;
}

function validImplementationScopeSnapshot(task, authorizedScopes) {
  const workPackages = task.workPackages ?? [];
  const packageIds = workPackages.map((workPackage) => workPackage?.id);
  const unresolvedPackageIds = workPackages
    .filter((workPackage) => !["ready_for_integration", "integrated"].includes(workPackage?.status))
    .map((workPackage) => workPackage.id);
  return (
    packageIds.length > 0 &&
    packageIds.every((packageId) => typeof packageId === "string" && packageId.trim().length > 0) &&
    packageIds.length === new Set(packageIds).size &&
    authorizedScopes.every((scope) => packageIds.includes(scope)) &&
    unresolvedPackageIds.every((packageId) => authorizedScopes.includes(packageId))
  );
}

export function validInitialCandidateProducer(task, candidate, reservation) {
  if (!task || !validCandidateAssemblyMembership(task, candidate)) return false;
  const authorized = reservation.authorizedRunScopes;
  const packageIds = task.workPackages.map((workPackage) => workPackage.id);
  if (
    !Array.isArray(authorized) ||
    authorized.some((scope) => typeof scope !== "string" || !scope.trim() || !packageIds.includes(scope)) ||
    new Set(authorized).size !== authorized.length
  ) {
    return false;
  }
  const producerRuns = (task.runs ?? []).filter((run) => run.workflowReservationId === reservation.id);
  if (!authorized.length) return producerRuns.length === 0;
  const runScopes = producerRuns.map((run) => run.workPackageId);
  return (
    producerRuns.length === authorized.length &&
    new Set(producerRuns.map((run) => run.id)).size === producerRuns.length &&
    new Set(runScopes).size === runScopes.length &&
    authorized.every((scope) => runScopes.includes(scope)) &&
    producerRuns.every(
      (run) =>
        typeof run.id === "string" &&
        run.id.trim().length > 0 &&
        run.stage === "implement" &&
        run.kind === "implementation" &&
        run.role === "implement" &&
        run.status === "completed" &&
        Number.isInteger(run.attempt) &&
        run.attempt > 0 &&
        run.workflowAttempt === reservation.workflowAttempt &&
        run.candidateId == null &&
        run.candidateRevision == null &&
        run.candidateHeadRevision == null,
    )
  );
}

export function validCandidateAssemblyMembership(task, candidate) {
  const workPackages = task.workPackages ?? [];
  const members = candidate?.members ?? [];
  // `headRevision === null` is a legitimate outcome: a work package whose verification
  // already confirmed its goal was met commits nothing (see `allowNoChanges` in
  // git-worktree.mjs). Only a non-null revision must be a real, non-empty commit hash;
  // multiple work packages are allowed to independently be no-ops.
  const validHeadRevision = (value) =>
    value === null || (typeof value === "string" && value.trim().length > 0);
  const committedHeadRevisions = workPackages
    .map((workPackage) => workPackage.headRevision)
    .filter((value) => value !== null);
  if (
    !workPackages.length ||
    !workPackages.every(
      (workPackage) =>
        workPackage.status === "integrated" &&
        typeof workPackage.id === "string" &&
        workPackage.id.trim().length > 0 &&
        validHeadRevision(workPackage.headRevision) &&
        Number.isInteger(workPackage.batch) &&
        workPackage.batch > 0,
    ) ||
    new Set(workPackages.map((workPackage) => workPackage.id)).size !== workPackages.length ||
    // Two *committed* packages must never share a revision; any number of no-ops may
    // all be null at once.
    new Set(committedHeadRevisions).size !== committedHeadRevisions.length
  ) {
    return false;
  }
  const orderedPackages = [...workPackages].sort(
    (left, right) => left.batch - right.batch || left.id.localeCompare(right.id),
  );
  return (
    members.length === orderedPackages.length &&
    members.every(
      (member, index) =>
        member?.packageId === orderedPackages[index].id &&
        member?.headRevision === orderedPackages[index].headRevision &&
        member?.order === index + 1,
    )
  );
}

function validAssemblyOnlyCandidateProducer(task, reservation, reservationRuns) {
  if (reservationRuns.length > 0) return false;
  const candidate = task.candidates?.at(-1);
  const currentRevision = candidate?.revisions?.find(
    (revision) => revision.number === candidate?.revisionNumber,
  );
  return (
    candidate?.status === "repair_required" &&
    candidate.revisionNumber === 1 &&
    candidate.sourceWorkflowAttempt === reservation.workflowAttempt &&
    candidate.sourceWorkflowReservationId === reservation.id &&
    currentRevision?.reason === "assembly" &&
    currentRevision.sourceWorkflowAttempt === reservation.workflowAttempt &&
    currentRevision.sourceWorkflowReservationId === reservation.id &&
    currentRevision.sourceWorkflowReservedAt === reservation.reservedAt &&
    reservation.candidateId == null &&
    reservation.candidateRevision == null &&
    reservation.candidateHeadRevision == null &&
    validCandidateAssemblyMembership(task, candidate)
  );
}

export function orderRetrySourceRuns(reservation, runs) {
  const authorized = reservation?.authorizedRunScopes;
  if (!Array.isArray(authorized) || !authorized.length || runs.length <= 1) return runs;
  return [...runs].sort((left, right) => {
    const leftScope = reservation.kind === "implementation" ? left.workPackageId : left.role;
    const rightScope = reservation.kind === "implementation" ? right.workPackageId : right.role;
    return authorized.indexOf(leftScope) - authorized.indexOf(rightScope);
  });
}
