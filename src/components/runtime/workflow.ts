import {
  type RuntimeArtifact,
  type RuntimeTask,
  type StageId,
  type TaskRunState,
  workflowStages,
} from "../../domain";
import type { RuntimeGateFreshness, RuntimeGateStage, RuntimeRunFreshness } from "../../runtime-activity";

export const candidateGateStages: RuntimeGateStage[] = ["dev-review", "test", "final-review"];

const candidateBoundStages: StageId[] = [...candidateGateStages, "approval"];

export const runtimeStageSkills: Record<StageId, string> = {
  triage: "classify-task",
  scouts: "scout-repository",
  grill: "grill-with-docs",
  specification: "build-specification",
  plan: "plan-work-packages",
  implement: "implement-isolated-slices",
  "dev-review": "fresh-context-review",
  test: "verify-candidate",
  "final-review": "holdout-review",
  approval: "approve-fast-forward",
};

export function isStageInvalidatedByRepair(task: RuntimeTask, stageId: StageId) {
  if (!candidateBoundStages.includes(stageId)) return false;
  const hasPriorEvidence =
    task.completedStages.includes(stageId) ||
    task.artifacts.some((artifact) => artifact.stage === stageId) ||
    task.runs?.some((run) => run.stage === stageId) === true;
  return Boolean(hasPriorEvidence && !isStageComplete(task, stageId));
}

/**
 * The stage a live run is actually producing evidence for right now, if any. `task.runs`
 * (not just `task.currentStage`) is the source of truth: a repair's own run.stage is
 * "implement" even though the invalidated gate it is repairing for is further along the
 * workflow, and once that gate's rerun starts, `task.currentStage` moves back to it while
 * the run's stage matches. Consulting the run directly is what lets callers tell "this
 * stage is running right now" apart from "this stage is stale because something else
 * invalidated it" — the two states render identically if only `task.status` is consulted.
 */
export function getActiveRunStage(task: RuntimeTask): StageId | null {
  if (task.status !== "running") return null;
  const runningRun = [...(task.runs ?? [])].reverse().find((run) => run.status === "running");
  if (runningRun) return runningRun.stage;
  return task.activeRunKind ? task.currentStage : null;
}

export function isStageRunning(task: RuntimeTask, stageId: StageId): boolean {
  return getActiveRunStage(task) === stageId;
}

export type StageTemporalState = "past" | "current" | "future";

/**
 * Past, current, and future are not the same thing as "not the active stage" — a stage the
 * task has not reached yet has no run, no artifact, and no completedStages entry, so it must
 * not be presented as retained history the way an already-executed stage is. This reads only
 * the durable evidence the task already carries (completedStages, runs, artifacts,
 * attemptsByStage) rather than inventing new state to answer the question.
 */
export function getStageTemporalState(task: RuntimeTask, stageId: StageId): StageTemporalState {
  if (stageId === task.currentStage) return "current";
  const hasEvidence =
    task.completedStages.includes(stageId) ||
    task.artifacts.some((artifact) => artifact.stage === stageId) ||
    task.runs?.some((run) => run.stage === stageId) === true ||
    (task.attemptsByStage?.[stageId] ?? 0) > 0;
  if (hasEvidence) return "past";
  const currentIndex = workflowStages.findIndex((stage) => stage.id === task.currentStage);
  const stageIndex = workflowStages.findIndex((stage) => stage.id === stageId);
  return stageIndex < currentIndex ? "past" : "future";
}

export const runtimeStageAgents: Record<StageId, string> = {
  triage: "Triage agent",
  scouts: "Repository scout agent",
  grill: "Clarification agent",
  specification: "Task specification agent",
  plan: "Planning agent",
  implement: "Implement agent",
  "dev-review": "Fresh-context review agent",
  test: "Verification agent",
  "final-review": "Holdout review agent",
  approval: "Human approval gate",
};

export function isArtifactFresh(
  artifact: RuntimeArtifact,
  candidate: RuntimeTask["candidates"][number] | undefined,
  freshness?: RuntimeGateFreshness | RuntimeRunFreshness | null,
) {
  const persistedFreshness = freshness ?? artifact.freshness;
  const candidateBound = candidateBoundStages.includes(artifact.stage);
  if (!artifact.candidateId || artifact.candidateRevision == null || !candidate) return !candidateBound;
  if (!persistedFreshness) {
    return artifact.stage === "approval" &&
      artifact.candidateId === candidate.id &&
      artifact.candidateRevision === candidate.revisionNumber;
  }
  if (!persistedFreshness.fresh) return false;
  if (
    persistedFreshness.target?.candidateId !== candidate.id ||
    persistedFreshness.target.candidateRevision !== candidate.revisionNumber
  ) return false;
  return persistedFreshness.sourceArtifactId === artifact.id;
}

export function isStageComplete(task: RuntimeTask, stageId: StageId): boolean {
  if (!candidateBoundStages.includes(stageId)) {
    return task.completedStages.includes(stageId);
  }
  const candidate = task.candidates?.at(-1);
  if (!candidate) return false;
  if (stageId === "approval") {
    return (
      (task.status === "merged-to-target" || task.status === "completed") &&
      candidate.status === "merged" &&
      candidateGateStages.every((gateStage) => isStageComplete(task, gateStage))
    );
  }
  return getRuntimeGateFreshness(task, stageId)?.fresh === true;
}

export function isCandidateGateStage(stageId: StageId): stageId is RuntimeGateStage {
  return candidateGateStages.includes(stageId as RuntimeGateStage);
}

export function isCandidateBoundStage(stageId: StageId) {
  return candidateBoundStages.includes(stageId);
}

/**
 * Read the server-owned projection only when it is explicitly bound to the
 * active candidate tuple. A missing or contradictory projection is not
 * repaired in the UI; it is treated as not fresh.
 */
export function getRuntimeGateFreshness(task: RuntimeTask, stageId: StageId): RuntimeGateFreshness | null {
  if (!isCandidateGateStage(stageId)) return null;
  const candidate = task.candidates?.at(-1);
  const freshness = task.gateFreshness?.[stageId];
  if (!candidate || !freshness) return null;
  if (
    freshness.target?.candidateId !== candidate.id ||
    freshness.target.candidateRevision !== candidate.revisionNumber ||
    freshness.candidateId !== candidate.id ||
    freshness.candidateRevision !== candidate.revisionNumber
  ) {
    return null;
  }
  return freshness;
}

export function getRuntimeArtifactFreshness(task: RuntimeTask, artifact: RuntimeArtifact): RuntimeRunFreshness | null {
  if (!isCandidateGateStage(artifact.stage)) return null;
  const run = task.runs?.find(
    (item) => item.id === artifact.runId || item.artifactId === artifact.id,
  );
  return run?.freshness ?? artifact.freshness ?? getRuntimeGateFreshness(task, artifact.stage);
}

export function getRuntimeFocusedTest(task: RuntimeTask) {
  const freshness = getRuntimeGateFreshness(task, "test");
  const candidate = task.candidates?.at(-1);
  const evidence = freshness?.focusedTest ?? null;
  if (!freshness || !evidence || !candidate) return null;
  if (evidence.candidateId !== candidate.id || evidence.candidateRevision !== candidate.revisionNumber) return null;
  if (freshness.focusedTestRows.some((row) => row.candidateId !== candidate.id || row.candidateRevision !== candidate.revisionNumber)) return null;
  return { ...evidence, rows: freshness.focusedTestRows };
}

/**
 * "No authoritative persisted terminal run summary" covers a candidate-bound gate that
 * has simply never run yet, not one whose evidence went stale. Callers that render
 * "Rerun required" from a freshness object must exclude this code, or a gate the
 * workflow hasn't reached presents as one that needs re-doing.
 */
export function isGateUnattempted(freshness: RuntimeGateFreshness | RuntimeRunFreshness | null | undefined) {
  return freshness?.reasonCode === "missing_authoritative_summary";
}

export function getRuntimeFreshnessLabel(task: RuntimeTask, stageId: RuntimeGateStage) {
  const freshness = getRuntimeGateFreshness(task, stageId);
  if (freshness?.fresh) return "Fresh";
  if (!freshness || isGateUnattempted(freshness)) return "Not started";
  return "Rerun required";
}

export function getRuntimeFreshnessReason(task: RuntimeTask, stageId: RuntimeGateStage) {
  return getRuntimeGateFreshness(task, stageId)?.reasonCopy ??
    "No authoritative persisted terminal run summary is available for this candidate.";
}

export function getRuntimeStageSummary(task: RuntimeTask, stageId: StageId, artifact?: RuntimeArtifact, isRunning = false) {
  const candidate = task.candidates?.at(-1);
  const packages = task.workPackages ?? [];
  const packageBatchCount = new Set(packages.map((item) => item.batch)).size;
  const focused = getRuntimeFocusedTest(task);
  const completedPackages = packages.filter((item) => ["integrated", "ready_for_integration"].includes(item.status)).length;
  const stageLabel = workflowStages.find((stage) => stage.id === stageId)?.label ?? stageId;
  const waiting = !artifact && !isStageComplete(task, stageId);
  const fallback = {
    kicker: `${stageLabel} \u00b7 ${stageId === task.currentStage ? "current execution" : "living artifact"}`,
    title: waiting ? `${stageLabel} is not ready yet` : (artifact?.name ?? stageLabel),
    detail: waiting
      ? "This stage has not produced an authoritative handoff yet. Earlier evidence remains inspectable."
      : "The persisted handoff remains read-only and available to downstream gates.",
  };
  switch (stageId) {
    case "triage":
      return {
        kicker: "Triage \u00b7 routing gate",
        title: artifact ? `${task.priority.charAt(0).toUpperCase()}${task.priority.slice(1)} priority \u00b7 ${task.workflow} workflow` : fallback.title,
        detail: artifact
          ? "Task scope, repository, priority, and workflow are fixed before repository investigation begins."
          : fallback.detail,
      };
    case "scouts":
      return {
        kicker: "Repo scouts \u00b7 evidence gate",
        title: artifact ? "Repository evidence retained" : fallback.title,
        detail: artifact
          ? "The real scout handoff is preserved with its model provenance and token usage; file-level claims remain inside the artifact."
          : fallback.detail,
      };
    case "grill": {
      const unresolved = task.grillSession?.questions.filter((question) => !question.answer) ?? [];
      return {
        kicker: "Grill with docs \u00b7 one question at a time",
        title: unresolved[0]?.question ?? (artifact ? "Decision frontier settled" : fallback.title),
        detail: unresolved[0]
          ? "Repository evidence comes first, followed by one recommended answer and explicit alternatives."
          : task.grillSession?.completionReason ?? fallback.detail,
      };
    }
    case "specification":
      return {
        kicker: "Task specification \u00b7 durable handoff",
        title: artifact ? "Specification ready for downstream use" : fallback.title,
        detail: artifact
          ? "The approved specification is shown as real agent output; acceptance criteria are not re-created outside that artifact."
          : fallback.detail,
      };
    case "plan":
      return {
        kicker: "Implementation plan \u00b7 dependency batches",
        title: packages.length
          ? `${packages.length} work package${packages.length === 1 ? "" : "s"} \u00b7 ${packageBatchCount} batch${packageBatchCount === 1 ? "" : "es"}`
          : fallback.title,
        detail: packages.length
          ? "Each package exposes real dependencies, ownership, verification commands, attempts, and integration readiness."
          : fallback.detail,
      };
    case "implement":
      return {
        kicker: "Implement \u00b7 isolated work packages",
        title: packages.length ? `${completedPackages} of ${packages.length} packages qualified` : fallback.title,
        detail: candidate
          ? `${candidate.id} revision ${candidate.revisionNumber} is the explicit integration candidate for every downstream gate.`
          : fallback.detail,
      };
    case "dev-review":
      return {
        kicker: "Dev review \u00b7 fresh-context advisor",
        title: gateStageTitle("Dev Review", task, "dev-review", candidate, artifact, fallback.title, isRunning),
        detail: gateStageDetail(task, "dev-review", artifact, "The authoritative review remains in the persisted candidate-bound run summary; prose findings remain inside the retained artifact.", isRunning),
      };
    case "test": {
      const passed = focused?.rows.filter((row) => row.status === "passed").length ?? 0;
      const failed = focused?.rows.filter((row) => row.status === "failed").length ?? 0;
      return {
        kicker: "Test \u00b7 candidate-bound gate",
        title: isRunning
          ? "Test is running"
          : getRuntimeGateFreshness(task, "test")?.fresh
            ? `${passed} checks passed \u00b7 ${failed} failed`
            : gateStageTitle("Test", task, "test", candidate, artifact, fallback.title, isRunning),
        detail: isRunning
          ? "A rerun for this stage is in progress; earlier evidence remains inspectable below."
          : getRuntimeGateFreshness(task, "test")?.fresh && focused
            ? "Open any persisted result for its command, assertions, evidence, and failure detail. Gate actions remain in the command bar."
            : gateStageDetail(task, "test", artifact, fallback.detail, isRunning),
      };
    }
    case "final-review":
      return {
        kicker: "Final review \u00b7 holdout",
        title: gateStageTitle("Final Review", task, "final-review", candidate, artifact, fallback.title, isRunning),
        detail: gateStageDetail(task, "final-review", artifact, "Every prior stage is summarized from persisted state, real token usage, and its durable artifact reference.", isRunning),
      };
    case "approval":
      return {
        kicker: "Human approval \u00b7 exact candidate",
        title:
          candidate?.status === "merged"
            ? `Candidate merged successfully \u00b7 ${candidate.id} r${candidate.revisionNumber}`
            : candidate
              ? `${candidate.id} r${candidate.revisionNumber} awaits approval`
              : fallback.title,
        detail: candidate
          ? `Target ${candidate.baseBranch} \u00b7 fast-forward only \u00b7 reviewed head ${candidate.headRevision?.slice(0, 8) ?? "pending"}. ${approvalFreshnessDetail(task)}`
          : fallback.detail,
      };
  }
}

function gateStageTitle(
  label: string,
  task: RuntimeTask,
  stageId: RuntimeGateStage,
  candidate: RuntimeTask["candidates"][number] | undefined,
  artifact: RuntimeArtifact | undefined,
  fallback: string,
  isRunning = false,
) {
  // A rerun in flight always wins over the stale/fresh copy below: the gate is neither
  // "fresh" nor genuinely "requires rerun" while its own rerun is already underway.
  if (isRunning) return `${label} is running`;
  const freshness = getRuntimeGateFreshness(task, stageId);
  if (freshness?.fresh) return `${label} retained for ${candidate?.id ?? "candidate"} r${candidate?.revisionNumber ?? "\u2014"}`;
  if (freshness && !isGateUnattempted(freshness)) return `${label} requires rerun`;
  return artifact ? `${label} evidence retained` : fallback;
}

function gateStageDetail(task: RuntimeTask, stageId: RuntimeGateStage, artifact: RuntimeArtifact | undefined, freshCopy: string, isRunning = false) {
  if (isRunning) return "A rerun for this stage is in progress; earlier evidence remains inspectable below.";
  const freshness = getRuntimeGateFreshness(task, stageId);
  if (!freshness || isGateUnattempted(freshness)) return artifact ? `${freshCopy} Freshness is unavailable until an authoritative persisted run summary is present.` : freshCopy;
  if (!freshness.fresh) return `Rerun required: ${freshness.reasonCopy}`;
  return freshCopy;
}

function approvalFreshnessDetail(task: RuntimeTask) {
  const stale = candidateGateStages
    .map((stageId) => ({ stageId, freshness: getRuntimeGateFreshness(task, stageId) }))
    .find(({ freshness }) => !freshness?.fresh);
  if (!stale) return "All candidate-bound gates are fresh.";
  return `Approval blocked: ${stale.freshness?.reasonCopy ?? "No authoritative persisted freshness is available for this gate."}`;
}


export function toTaskRunState(status: RuntimeTask["status"]): TaskRunState {
  if (status === "closed") return "closed";
  if (status === "archived") return "archived";
  if (status === "queued") return "paused";
  if (status === "cancelled" || status === "blocked") return "blocked";
  if (status === "running" || status === "cancelling") return "running";
  if (status === "merged-to-target") return "merged-to-target";
  if (status === "failed" || status === "completed") return status;
  return "needs-input";
}

export interface MergePromotionDetails {
  candidateId: string;
  candidateRevision: number;
  headRevision: string;
  targetRef: string;
  targetBranch: string;
  promoteCommand: string;
}

/**
 * Read-only projection of the merge that landed on the recorded target ref.
 * The returned command is for the operator to copy elsewhere; nothing here
 * executes it or offers a second merge path.
 */
export function getMergePromotionDetails(
  task: RuntimeTask,
  candidate: RuntimeTask["candidates"][number] | undefined,
): MergePromotionDetails | null {
  if (task.status !== "merged-to-target") return null;
  if (candidate?.status !== "merged" || !candidate.headRevision) return null;
  const targetRef = task.mergeIntent?.targetRef ?? (candidate.baseBranch ? `refs/heads/${candidate.baseBranch}` : null);
  if (!targetRef) return null;
  const targetBranch = targetRef.replace(/^refs\/heads\//, "");
  return {
    candidateId: candidate.id,
    candidateRevision: candidate.revisionNumber,
    headRevision: candidate.headRevision,
    targetRef,
    targetBranch,
    promoteCommand: `git push origin ${candidate.headRevision}:${targetBranch}`,
  };
}
