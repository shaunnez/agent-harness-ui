import { POLICY_IDS } from "./model-catalog.mjs";

const ROLE_IDS = new Set(POLICY_IDS);
const WORKFLOW_STAGES = Object.freeze([...POLICY_IDS]);

// These states represent a task whose execution history is closed, being merged,
// or no longer trustworthy. A policy snapshot must not be reopened from any of
// them, even when the selected role has no obvious run of its own.
const LOCKED_TASK_STATUSES = new Set([
  "terminal",
  "completed",
  "closed",
  "archived",
  "cancelled",
  "cancelling",
  "identity-drift",
  "awaiting-pr-merge",
  "awaiting-human-approval",
  "merging",
  "merged-to-target",
]);
const KNOWN_TASK_STATUSES = new Set([
  ...LOCKED_TASK_STATUSES,
  "queued",
  "running",
  "failed",
  "blocked",
  "awaiting-grill",
  "generating-designs",
  "awaiting-design-selection",
  "awaiting-spec-approval",
  "awaiting-plan-approval",
  "awaiting-already-satisfied",
  "ready-for-implementation",
  "ready-for-review",
  "review-retry-required",
  "ready-for-test",
  "ready-for-final-review",
  "repair-required",
  // Kept for records written before the store normalized this state name.
  "awaiting-approval",
]);

const REPAIR_LINEAGE_REASONS = new Set(["repair", "candidate-repair"]);
const IMPLEMENTATION_WORK_PACKAGE_STATUSES = new Set([
  "running",
  "failed",
  "ready_for_integration",
  "integrated",
]);

/**
 * Resolve the server-owned lifecycle frontier for one canonical task role.
 *
 * This function is deliberately pure. It does not inspect settings, the model
 * catalogue, or browser-provided eligibility; those checks are performed by the
 * caller around this single lifecycle decision. Missing or contradictory durable
 * evidence is treated conservatively as ineligible rather than as proof that a
 * role is still future.
 */
export function resolveRolePolicyLifecycleEligibility(task, role) {
  if (!task?.id) {
    return lifecycleDenial(
      "The selected task has no stable identity, so its role-policy lifecycle cannot be verified.",
      ["Evidence: task identity is missing."],
    );
  }
  if (!ROLE_IDS.has(role)) {
    return lifecycleDenial("The requested role is not part of the canonical workflow policy set.", [
      `Requested role: ${String(role)}.`,
    ]);
  }

  const status = typeof task.status === "string" ? task.status : null;
  if (!status) {
    return lifecycleDenial(
      "The task lifecycle is incomplete, so the role-policy mutation is not permitted.",
      ["Evidence: task status is missing."],
    );
  }
  if (!KNOWN_TASK_STATUSES.has(status)) {
    return lifecycleDenial("The task status is unknown, so the role-policy lifecycle cannot be verified.", [
      `Task status: ${status}.`,
    ]);
  }
  if (LOCKED_TASK_STATUSES.has(status)) {
    return lifecycleDenial(
      `The task is ${status}; role policies cannot be changed after the task reaches this state.`,
      [`Task status: ${status}.`],
    );
  }
  if (status === "blocked" && task.blocker?.code === "identity-drift") {
    return lifecycleDenial(
      "The task is blocked by repository identity drift; role policies cannot be changed until it is revalidated.",
      ["Task blocker: identity-drift."],
    );
  }
  if (task.identityDrift === true || task.repositoryAuthorityStatus === "identity-drift") {
    return lifecycleDenial(
      "The task has repository identity drift; role policies cannot be changed until it is revalidated.",
      ["Task authority state: identity-drift."],
    );
  }

  const malformedEvidence = malformedLifecycleEvidence(task);
  if (malformedEvidence) return malformedEvidence;

  if (role === "repair") return repairRoleEligibility(task);

  const evidence = roleEvidence(task, role);
  if (evidence) return evidence;

  // `currentStage` is durable lifecycle evidence that the workflow has reached
  // that stage. Only roles after it remain genuinely future; the current role is
  // frozen even if a malformed or incomplete record has not retained a run yet.
  const currentStage = task.currentStage;
  const currentIndex = WORKFLOW_STAGES.indexOf(currentStage);
  const roleIndex = WORKFLOW_STAGES.indexOf(role);
  if (currentIndex < 0 || roleIndex < 0) {
    return lifecycleDenial(
      "The task workflow stage is unknown, so the role-policy lifecycle cannot be verified.",
      [`Current stage: ${String(currentStage)}.`, `Requested role: ${role}.`],
    );
  }
  if (roleIndex <= currentIndex) {
    return lifecycleDenial(
      `The ${role} stage has been reached or passed; its role policy is no longer mutable.`,
      [`Current stage: ${currentStage}.`, `Requested role stage: ${role}.`],
    );
  }

  return {
    ok: true,
    role,
    lifecycle: "future-or-unstarted",
    evidence: [
      `Role ${role} has no retained execution evidence.`,
      `Current stage: ${currentStage}; the requested role remains future or unstarted.`,
    ],
  };
}

// Keep a descriptive short name available to server callers and focused tests,
// while the resolve-prefixed export remains the canonical API name.
export const rolePolicyLifecycleEligibility = resolveRolePolicyLifecycleEligibility;

function repairRoleEligibility(task) {
  if (task.currentStage === "approval") {
    return lifecycleDenial(
      "The workflow has reached Human Approval; the Repair role policy is no longer mutable.",
      ["Current stage: approval."],
    );
  }
  if (!WORKFLOW_STAGES.includes(task.currentStage)) {
    return lifecycleDenial(
      "The task workflow stage is unknown, so the Repair role-policy lifecycle cannot be verified.",
      [`Current stage: ${String(task.currentStage)}.`],
    );
  }
  if (activeRoleFor(task) === "repair") {
    return lifecycleDenial("The Repair role is active and its policy cannot change during execution.", [
      "Active role: repair.",
    ]);
  }

  if (task.automaticRepairCycles > 0) {
    return lifecycleDenial(
      "The Repair role has recorded an automatic repair cycle and its policy is no longer mutable.",
      [`Automatic repair cycles: ${task.automaticRepairCycles}.`],
    );
  }

  const repairRun = (task.runs ?? []).find((run) => isRepairEvidence(run));
  if (repairRun) {
    return lifecycleDenial("The Repair role has already begun work and its policy is no longer mutable.", [
      `Repair run: ${String(repairRun.id ?? "retained evidence")}.`,
      `Repair run status: ${String(repairRun.status ?? "unknown")}.`,
    ]);
  }

  const repairArtifact = (task.artifacts ?? []).find((artifact) => isRepairEvidence(artifact));
  if (repairArtifact) {
    return lifecycleDenial("The Repair role has retained an artifact and its policy is no longer mutable.", [
      `Repair artifact: ${String(repairArtifact.id ?? "retained evidence")}.`,
    ]);
  }

  const lineage = repairLineage(task);
  if (lineage) {
    return lifecycleDenial(
      "The Repair role has retained repair lineage and its policy is no longer mutable.",
      [`Repair lineage: ${String(lineage.id ?? lineage.number ?? "retained evidence")}.`],
    );
  }

  const repairReservation = reservationForRole(task, "repair");
  if (repairReservation) {
    return lifecycleDenial(
      "The Repair role has a retained run reservation and its policy is no longer mutable.",
      [`Repair reservation: ${String(repairReservation.id ?? "retained reservation")}.`],
    );
  }

  return {
    ok: true,
    role: "repair",
    lifecycle: "future",
    evidence: ["Repair has no retained run, artifact, lineage, or active reservation."],
  };
}

function roleEvidence(task, role) {
  if (role === "implement" && Array.isArray(task.candidates) && task.candidates.length > 0) {
    return lifecycleDenial("The Implement role is no longer mutable after an integration candidate exists.", [
      `Integration candidates retained: ${task.candidates.length}.`,
    ]);
  }

  const run = (task.runs ?? []).find((entry) => evidenceBelongsToRole(entry, role));
  if (run) {
    return lifecycleDenial(`The ${role} role has a retained run and its policy is no longer mutable.`, [
      `Role run: ${String(run.id ?? "retained evidence")}.`,
      `Role run status: ${String(run.status ?? "unknown")}.`,
    ]);
  }

  const activeRunIds = Array.isArray(task.activeRunIds) ? task.activeRunIds : [];
  if (activeRunIds.length > 0 && !(task.runs ?? []).some((run) => run && activeRunIds.includes(run.id))) {
    return lifecycleDenial(
      "The task has an active run without attributable role evidence, so the role-policy mutation is not permitted.",
      [`Active run records: ${activeRunIds.length}.`],
    );
  }

  const artifact = (task.artifacts ?? []).find((entry) => evidenceBelongsToRole(entry, role));
  if (artifact) {
    return lifecycleDenial(`The ${role} role has a retained artifact and its policy is no longer mutable.`, [
      `Role artifact: ${String(artifact.id ?? "retained evidence")}.`,
    ]);
  }

  if (Array.isArray(task.completedStages) && task.completedStages.includes(role)) {
    return lifecycleDenial(`The ${role} stage is recorded as passed; its role policy is no longer mutable.`, [
      `Completed stage: ${role}.`,
    ]);
  }
  if (isRecord(task.stageDispositions) && Object.hasOwn(task.stageDispositions, role)) {
    return lifecycleDenial(
      `The ${role} stage has a recorded disposition; its role policy is no longer mutable.`,
      [`Stage disposition recorded: ${role}.`],
    );
  }
  if (Number.isInteger(task.attemptsByStage?.[role]) && task.attemptsByStage[role] > 0) {
    return lifecycleDenial(
      `The ${role} stage has a recorded attempt; its role policy is no longer mutable.`,
      [`Recorded ${role} attempts: ${task.attemptsByStage[role]}.`],
    );
  }

  const reservation = reservationForRole(task, role);
  if (reservation) {
    return lifecycleDenial(
      `The ${role} role has a retained run reservation and its policy is no longer mutable.`,
      [`Role reservation: ${String(reservation.id ?? "retained reservation")}.`],
    );
  }

  if (
    role === "implement" &&
    Array.isArray(task.workPackages) &&
    task.workPackages.some((workPackage) => IMPLEMENTATION_WORK_PACKAGE_STATUSES.has(workPackage?.status))
  ) {
    return lifecycleDenial(
      "The Implement role has retained implementation work and its policy is no longer mutable.",
      ["Implementation work package evidence is retained."],
    );
  }

  const activeRole = activeRoleFor(task);
  if (activeRole === role) {
    return lifecycleDenial(`The ${role} role is active and its policy cannot change during execution.`, [
      `Active role: ${role}.`,
    ]);
  }
  return null;
}

function evidenceBelongsToRole(entry, role) {
  if (!entry || typeof entry !== "object") return false;
  const explicitRole = entry.role ?? entry.agentRole ?? null;
  if (role === "repair") return isRepairEvidence(entry);
  if (entry.kind === "repair" || entry.repairOfRunId != null || entry.repairLineage != null) return false;
  if (explicitRole === role) return true;
  // Specialized scouts and deterministic gate producers still produce evidence
  // for their canonical stage. An explicit canonical role on another stage wins.
  if (ROLE_IDS.has(explicitRole)) return false;
  return entry.stage === role;
}

function isRepairEvidence(entry) {
  if (!entry || typeof entry !== "object") return false;
  return (
    entry.role === "repair" ||
    entry.agentRole === "repair" ||
    entry.kind === "repair" ||
    entry.repairOfRunId != null ||
    entry.repairLineage != null
  );
}

function reservationForRole(task, role) {
  return Object.values(task.stageRunReservations ?? {}).find((reservation) => {
    if (!reservation || typeof reservation !== "object") return false;
    if (role === "repair") return reservation.kind === "repair";
    if (reservation.kind === "repair") return false;
    return reservation.stage === role;
  });
}

function activeRoleFor(task) {
  const activeKind = task.activeRunKind;
  if (!activeKind) return null;
  if (activeKind === "repair") return "repair";
  if (activeKind === "implementation") return "implement";
  if (ROLE_IDS.has(activeKind)) return activeKind;
  return ROLE_IDS.has(task.currentStage) ? task.currentStage : null;
}

function repairLineage(task) {
  const retained = [
    ...(Array.isArray(task.repairLineage) ? task.repairLineage : []),
    ...(Array.isArray(task.repairHistory) ? task.repairHistory : []),
    ...(Array.isArray(task.candidates)
      ? task.candidates.flatMap((candidate) =>
          Array.isArray(candidate?.revisions) ? candidate.revisions : [],
        )
      : []),
  ];
  return retained.find(
    (entry) =>
      REPAIR_LINEAGE_REASONS.has(entry?.reason) || entry?.kind === "repair" || entry?.repairOfRunId != null,
  );
}

function lifecycleDenial(reason, evidence = []) {
  return {
    ok: false,
    status: 409,
    code: "ineligible",
    reason,
    evidence: [reason, ...evidence].filter((item, index, all) => item && all.indexOf(item) === index),
  };
}

function malformedLifecycleEvidence(task) {
  for (const field of [
    "runs",
    "artifacts",
    "candidates",
    "completedStages",
    "workPackages",
    "activeRunIds",
    "repairLineage",
    "repairHistory",
  ]) {
    if (task[field] !== undefined && !Array.isArray(task[field])) {
      return lifecycleDenial(
        "The task lifecycle evidence is malformed, so the role-policy mutation is not permitted.",
        [`Malformed evidence field: ${field}.`],
      );
    }
  }
  for (const field of ["runs", "artifacts", "candidates", "workPackages", "repairLineage", "repairHistory"]) {
    if (task[field]?.some((entry) => !isRecord(entry))) {
      return lifecycleDenial(
        "The task lifecycle evidence is malformed, so the role-policy mutation is not permitted.",
        [`Malformed evidence entry: ${field}.`],
      );
    }
  }
  for (const candidate of task.candidates ?? []) {
    if (candidate.revisions !== undefined && !Array.isArray(candidate.revisions)) {
      return lifecycleDenial(
        "The task lifecycle evidence is malformed, so the role-policy mutation is not permitted.",
        ["Malformed evidence field: candidate.revisions."],
      );
    }
    if (candidate.revisions?.some((revision) => !isRecord(revision))) {
      return lifecycleDenial(
        "The task lifecycle evidence is malformed, so the role-policy mutation is not permitted.",
        ["Malformed evidence entry: candidate.revisions."],
      );
    }
  }
  for (const field of ["completedStages", "activeRunIds"]) {
    if (task[field]?.some((entry) => typeof entry !== "string")) {
      return lifecycleDenial(
        "The task lifecycle evidence is malformed, so the role-policy mutation is not permitted.",
        [`Malformed evidence entry: ${field}.`],
      );
    }
  }
  for (const field of ["attemptsByStage", "stageDispositions", "stageRunReservations"]) {
    if (task[field] !== undefined && !isRecord(task[field])) {
      return lifecycleDenial(
        "The task lifecycle evidence is malformed, so the role-policy mutation is not permitted.",
        [`Malformed evidence field: ${field}.`],
      );
    }
  }
  if (
    task.automaticRepairCycles !== undefined &&
    (!Number.isInteger(task.automaticRepairCycles) || task.automaticRepairCycles < 0)
  ) {
    return lifecycleDenial(
      "The task lifecycle evidence is malformed, so the role-policy mutation is not permitted.",
      ["Malformed evidence field: automaticRepairCycles."],
    );
  }
  for (const [stage, attempts] of Object.entries(task.attemptsByStage ?? {})) {
    if (ROLE_IDS.has(stage) && (!Number.isInteger(attempts) || attempts < 0)) {
      return lifecycleDenial(
        "The task lifecycle evidence is malformed, so the role-policy mutation is not permitted.",
        [`Malformed attempt count: ${stage}.`],
      );
    }
  }
  if (Object.values(task.stageRunReservations ?? {}).some((reservation) => !isRecord(reservation))) {
    return lifecycleDenial(
      "The task lifecycle evidence is malformed, so the role-policy mutation is not permitted.",
      ["Malformed evidence entry: stageRunReservations."],
    );
  }
  return null;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
