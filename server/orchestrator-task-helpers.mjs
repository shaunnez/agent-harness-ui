import { getStageMetadata } from "./prompts.mjs";
import { isOwnedFile } from "./structured-output.mjs";

import { activity, now } from "./orchestrator-stage-support.mjs";

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

/**
 * `actor` records who actually approved this gate: a human clicking approve, or a
 * `gatePolicy: "auto-on-clean"` policy advancing the task on its own. Every approval
 * ever recorded carries one — absent values (from before this field existed) are
 * backfilled as human in `migratePersistedTaskState` — so an audit can always answer
 * "did a person see this?" for any approval. See `docs/auto-approve-gates-proposal.md`.
 */
export function recordApproval(task, stage, note, actor = { kind: "human" }) {
  const approvalNote = note.trim().slice(0, 5_000);
  task.approvals ??= [];
  const artifactId =
    [...(task.artifacts ?? [])].reverse().find((artifact) => artifact.stage === stage)?.id ?? null;
  const normalizedActor =
    actor?.kind === "policy" ? { kind: "policy", policy: actor.policy ?? "auto-on-clean" } : { kind: "human" };
  const approval = {
    id: crypto.randomUUID(),
    stage,
    note: approvalNote,
    createdAt: now(),
    artifactId,
    actor: normalizedActor,
  };
  task.approvals.push(approval);
  task.events.push(
    activity(
      stage,
      `${getStageMetadata(stage)?.label ?? stage} approved`,
      approvalNote ||
        (normalizedActor.kind === "policy"
          ? `Approved automatically by policy (${normalizedActor.policy}).`
          : "Approved without an additional note."),
      "success",
      "decision",
      { approvalId: approval.id },
    ),
  );
}

/**
 * "Clean" for specification, per `docs/auto-approve-gates-proposal.md`: the artifact
 * exists, the run that produced it succeeded, and no unresolved Grill decision remains.
 * This is the only notion of "clean" for this gate — nothing else invents a second one.
 */
export function specificationCleanliness(task) {
  const artifact = [...(task.artifacts ?? [])].reverse().find((item) => item.stage === "specification");
  if (!artifact) return { clean: false, reason: "No specification artifact has been recorded yet." };
  const run = artifact.runId ? (task.runs ?? []).find((item) => item.id === artifact.runId) : null;
  if (run && run.status !== "completed") {
    return {
      clean: false,
      reason: `The specification run did not complete successfully (status: ${run.status}).`,
    };
  }
  const unresolved = (task.grillSession?.questions ?? []).filter((question) => !question.answer);
  if (unresolved.length) {
    return {
      clean: false,
      reason: `${unresolved.length} Grill question${unresolved.length === 1 ? "" : "s"} remain unanswered.`,
    };
  }
  return { clean: true, reason: null };
}

/**
 * Auto-approve the specification gate when `task.gatePolicy.specification` is
 * `"auto-on-clean"` and the stage is clean. Reuses `approveSpecification`'s own code
 * path — the same one a human approval goes through — via the injected callback, so a
 * policy approval and a human approval can never diverge in what they do. When the
 * gate is not clean, the task parks exactly as it does today and the event log
 * explains why the policy did not apply.
 */
export async function maybeAutoApproveSpecification(store, id, approveSpecification) {
  if (typeof approveSpecification !== "function") return false;
  const task = await store.get(id);
  if (task?.status !== "awaiting-spec-approval" || task.gatePolicy?.specification !== "auto-on-clean") {
    return false;
  }
  const { clean, reason } = specificationCleanliness(task);
  if (!clean) {
    await store.update(id, (draft) => {
      draft.events.push(
        activity("specification", "Automatic specification approval did not apply", reason, "warning", "decision"),
      );
    });
    return false;
  }
  await approveSpecification(id, "", { kind: "policy", policy: "auto-on-clean" });
  return true;
}

/**
 * Auto-approve the plan gate when `task.gatePolicy.plan` is `"auto-on-clean"`.
 * "Clean" for plan is deliberately not re-derived here: `approvePlan` already runs
 * `blockStalePlan` and `_assertExecutablePlan` (plus the fast-profile checks) before it
 * commits the transition, so this simply attempts the same call a human approval makes
 * and treats any thrown error as "not clean" — the task parks exactly as it does today,
 * with an additional event explaining that the policy did not apply.
 */
export async function maybeAutoApprovePlan(store, id, approvePlan) {
  if (typeof approvePlan !== "function") return false;
  const task = await store.get(id);
  if (task?.status !== "awaiting-plan-approval" || task.gatePolicy?.plan !== "auto-on-clean") {
    return false;
  }
  try {
    await approvePlan(id, "", { kind: "policy", policy: "auto-on-clean" });
    return true;
  } catch (error) {
    await store.update(id, (draft) => {
      draft.events.push(activity("plan", "Automatic plan approval did not apply", error.message, "warning", "decision"));
    });
    return false;
  }
}

export function stageForRun(kind, currentStage) {
  return {
    investigation: ["triage", "scouts", "grill", "specification"].includes(currentStage)
      ? currentStage
      : "triage",
    specification: "specification",
    planning: "plan",
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
