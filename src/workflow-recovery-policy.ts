const OWNERSHIP_FAILURE =
  /(?:candidate|retained slice) changed .+, which is outside (?:the )?(?:current )?work package ownership \(/i;
const INVALID_VERIFICATION_PLAN =
  /focused package verification requires at least one repository manifest command id|approved plan does not contain executable work packages/i;

const REPAIR_LIMITS = Object.freeze({
  fast: 1,
  standard: 2,
  "high-risk": 3,
});

type RecoveryTask = {
  runs?: Array<{
    candidateId?: string | null;
    candidateRevision?: number | null;
    kind?: string | null;
    status?: string | null;
  }> | null;
  workflowProfile?: { selected?: string | null } | null;
};

type RecoveryCandidate = {
  id?: string | null;
  revisionNumber?: number | null;
  revisions?: Array<{ reason?: string | null }> | null;
};

export function isWorkPackageOwnershipFailure(error: string | null | undefined): boolean {
  return OWNERSHIP_FAILURE.test(error ?? "");
}

export function isInvalidApprovedPlanFailure(error: string | null | undefined): boolean {
  return isWorkPackageOwnershipFailure(error) || INVALID_VERIFICATION_PLAN.test(error ?? "");
}

export function candidateRepairCount(
  task: RecoveryTask,
  candidate: RecoveryCandidate | null | undefined,
): number {
  const revisionCount = candidate?.revisions?.filter((revision) => revision.reason === "repair").length ?? 0;
  if (!candidate) return revisionCount;
  const completedRunCount =
    task.runs?.filter(
      (run) =>
        run.kind === "repair" &&
        run.status === "completed" &&
        run.candidateId === candidate.id &&
        run.candidateRevision === candidate.revisionNumber,
    ).length ?? 0;
  return Math.max(revisionCount, completedRunCount);
}

export function candidateRepairLimit(task: RecoveryTask): number {
  const selected = task.workflowProfile?.selected ?? "standard";
  return REPAIR_LIMITS[selected as keyof typeof REPAIR_LIMITS] ?? REPAIR_LIMITS.standard;
}

export function candidateRepairCircuitExhausted(
  task: RecoveryTask,
  candidate: RecoveryCandidate | null | undefined,
): boolean {
  return candidateRepairCount(task, candidate) >= candidateRepairLimit(task);
}

export function candidateRepairCircuitReason(
  task: RecoveryTask,
  candidate: RecoveryCandidate | null | undefined,
): string {
  const count = candidateRepairCount(task, candidate);
  const limit = candidateRepairLimit(task);
  const profile = task.workflowProfile?.selected ?? "standard";
  if (profile === "fast") {
    return `Fast tasks permit one automatic candidate-repair cycle. Candidate repair circuit breaker reached ${count}/${limit} repaired revisions. Review the retained findings and correct the implementation plan before creating another candidate.`;
  }
  return `Candidate repair circuit breaker reached ${count}/${limit} repaired revisions for the ${profile} profile. Review the retained findings and correct the implementation plan before creating another candidate.`;
}
