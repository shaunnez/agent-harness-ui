import { activity, now } from "./orchestrator-stage-support.mjs";
import { getStageMetadata } from "./prompts.mjs";
import { isOwnedFile } from "./structured-output.mjs";

export function applyStageRunReservation(task, reservation) {
  task.stageRun += 1;
  task.attemptsByStage ??= {};
  task.attemptsByStage[reservation.stage] = reservation.workflowAttempt;
  task.stageRunReservations ??= {};
  task.stageRunReservations[reservation.stage] = reservation;
  task.activeRunReservationId = reservation.id;
}

export function requireActiveRunReservation(task, kind, stage) {
  const reservation = task.stageRunReservations?.[stage] ?? null;
  if (
    !reservation ||
    reservation.id !== task.activeRunReservationId ||
    reservation.kind !== kind ||
    reservation.stage !== stage ||
    reservation.workflowAttempt !== task.attemptsByStage?.[stage]
  ) {
    throw new Error(`The active ${stage} workflow reservation is inconsistent.`);
  }
  return reservation;
}

export function recordApproval(task, stage, note) {
  const approvalNote = note.trim().slice(0, 5_000);
  task.approvals ??= [];
  const artifactId =
    [...(task.artifacts ?? [])].reverse().find((artifact) => artifact.stage === stage)?.id ?? null;
  const approval = { id: crypto.randomUUID(), stage, note: approvalNote, createdAt: now(), artifactId };
  task.approvals.push(approval);
  task.events.push(
    activity(
      stage,
      `${getStageMetadata(stage)?.label ?? stage} approved`,
      approvalNote || "Approved without an additional note.",
      "success",
      "decision",
      { approvalId: approval.id },
    ),
  );
}

export function stageForRun(kind, currentStage) {
  return {
    investigation: ["triage", "scouts", "synthesis", "grill", "specification"].includes(currentStage)
      ? currentStage
      : "triage",
    specification: "specification",
    planning: ["plan", "plan-review"].includes(currentStage) ? currentStage : "plan",
    implementation: "implement",
    repair: "implement",
    review: "dev-review",
    test: "test",
    "final-review": "final-review",
  }[kind];
}

export function labelForRun(kind) {
  return {
    investigation: "Investigation workflow",
    specification: "Specification synthesis",
    planning: "Planning gate",
    implementation: "Implementation candidate",
    repair: "Candidate repair",
    review: "Development review",
    test: "Focused test gate",
    "final-review": "Final holdout review",
  }[kind];
}

export function runDetail(kind) {
  if (kind === "implementation" || kind === "repair")
    return "Using the local ChatGPT-authenticated Codex CLI inside an isolated Git worktree.";
  return "Using the local ChatGPT-authenticated Codex CLI with retained workflow context.";
}

/**
 * The implementation prompt's escape hatch for a work package whose goal is already
 * met: the agent makes no edits and reports why instead of the harness treating an
 * empty diff as a stuck or broken run. Only trusted when the worktree is actually
 * clean — see the call site in `_runWorkPackage` — so a model that emits the marker
 * without believing it (or while having actually changed something) still goes
 * through the ordinary commit path instead of skipping evidence.
 */
export function parseNoChangesNeeded(text) {
  const match = String(text ?? "").match(/<no-changes-needed>\s*([\s\S]*?)\s*<\/no-changes-needed>/i);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    return typeof parsed?.reason === "string" && parsed.reason.trim() ? parsed : null;
  } catch {
    return null;
  }
}

export function retainedSliceCanBeRequalified(prior, revised) {
  if (
    prior?.status !== "failed" ||
    !prior.headRevision ||
    !prior.worktreePath ||
    !prior.branch ||
    !prior.baseRevision ||
    !Array.isArray(prior.files) ||
    !/(?:repository manifest command id|did not qualify)/i.test(prior.error ?? "") ||
    !revised.verificationCommandIds?.length
  ) {
    return false;
  }
  const priorOwnedPaths = [...(prior.ownedPaths ?? [])].sort();
  const revisedOwnedPaths = [...(revised.ownedPaths ?? [])].sort();
  return priorOwnedPaths.every((priorPath) => isOwnedFile(priorPath, revisedOwnedPaths));
}

export function dependencyClosure(workPackage, packages, seen = new Set()) {
  for (const dependencyId of workPackage.dependencies) {
    if (seen.has(dependencyId)) continue;
    seen.add(dependencyId);
    const dependency = packages.find((item) => item.id === dependencyId);
    if (dependency) dependencyClosure(dependency, packages, seen);
  }
  return [...seen];
}
