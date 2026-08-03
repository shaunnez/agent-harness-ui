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
  const candidateBound = candidateBoundStages.includes(artifact.stage);
  if (!artifact.candidateId || artifact.candidateRevision == null || !candidate) return !candidateBound;
  if (!freshness) return artifact.candidateId === candidate.id && artifact.candidateRevision === candidate.revisionNumber;
  if (!freshness.fresh) return false;
  if (
    freshness.target?.candidateId !== candidate.id ||
    freshness.target.candidateRevision !== candidate.revisionNumber
  ) return false;
  return freshness.sourceArtifactId === artifact.id;
}

export function isStageComplete(task: RuntimeTask, stageId: StageId): boolean {
  if (!candidateBoundStages.includes(stageId)) {
    return task.completedStages.includes(stageId);
  }
  const candidate = task.candidates?.at(-1);
  if (!candidate) return false;
  if (stageId === "approval") {
    return (
      task.status === "completed" &&
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
  return run?.freshness ?? getRuntimeGateFreshness(task, artifact.stage);
}

export function getRuntimeFocusedTest(task: RuntimeTask) {
  const freshness = getRuntimeGateFreshness(task, "test");
  const candidate = task.candidates?.at(-1);
  const evidence = freshness?.fresh ? freshness.focusedTest : null;
  if (!freshness || !evidence || !candidate) return null;
  if (evidence.candidateId !== candidate.id || evidence.candidateRevision !== candidate.revisionNumber) return null;
  if (freshness.focusedTestRows.some((row) => row.candidateId !== candidate.id || row.candidateRevision !== candidate.revisionNumber)) return null;
  return { ...evidence, rows: freshness.focusedTestRows };
}

export function getRuntimeFreshnessLabel(task: RuntimeTask, stageId: RuntimeGateStage) {
  const freshness = getRuntimeGateFreshness(task, stageId);
  if (freshness?.fresh) return "Fresh";
  return freshness ? "Rerun required" : "Freshness unavailable";
}

export function getRuntimeFreshnessReason(task: RuntimeTask, stageId: RuntimeGateStage) {
  return getRuntimeGateFreshness(task, stageId)?.reasonCopy ??
    "No authoritative persisted terminal run summary is available for this candidate.";
}

export function getRuntimeStageSummary(task: RuntimeTask, stageId: StageId, artifact?: RuntimeArtifact) {
  const candidate = task.candidates?.at(-1);
  const packages = task.workPackages ?? [];
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
        title: packages.length ? `${packages.length} work packages \u00b7 ${new Set(packages.map((item) => item.batch)).size} batches` : fallback.title,
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
        title: gateStageTitle("Dev Review", task, "dev-review", candidate, artifact, fallback.title),
        detail: gateStageDetail(task, "dev-review", artifact, "The authoritative review remains in the persisted candidate-bound run summary; prose findings remain inside the retained artifact."),
      };
    case "test": {
      const passed = focused?.rows.filter((row) => row.status === "passed").length ?? 0;
      const failed = focused?.rows.filter((row) => row.status === "failed").length ?? 0;
      return {
        kicker: "Test \u00b7 candidate-bound gate",
        title: getRuntimeGateFreshness(task, "test")?.fresh
          ? `${passed} checks passed \u00b7 ${failed} failed`
          : gateStageTitle("Test", task, "test", candidate, artifact, fallback.title),
        detail: getRuntimeGateFreshness(task, "test")?.fresh && focused
          ? "Open any persisted result for its command, assertions, evidence, and failure detail. Gate actions remain in the command bar."
          : gateStageDetail(task, "test", artifact, fallback.detail),
      };
    }
    case "final-review":
      return {
        kicker: "Final review \u00b7 holdout",
        title: gateStageTitle("Final Review", task, "final-review", candidate, artifact, fallback.title),
        detail: gateStageDetail(task, "final-review", artifact, "Every prior stage is summarized from persisted state, real token usage, and its durable artifact reference."),
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
) {
  const freshness = getRuntimeGateFreshness(task, stageId);
  if (freshness?.fresh) return `${label} retained for ${candidate?.id ?? "candidate"} r${candidate?.revisionNumber ?? "\u2014"}`;
  if (freshness) return `${label} requires rerun`;
  return artifact ? `${label} evidence retained` : fallback;
}

function gateStageDetail(task: RuntimeTask, stageId: RuntimeGateStage, artifact: RuntimeArtifact | undefined, freshCopy: string) {
  const freshness = getRuntimeGateFreshness(task, stageId);
  if (!freshness) return artifact ? `${freshCopy} Freshness is unavailable until an authoritative persisted run summary is present.` : freshCopy;
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
  if (status === "queued") return "paused";
  if (status === "cancelled" || status === "blocked") return "blocked";
  if (status === "running" || status === "cancelling") return "running";
  if (status === "failed" || status === "completed") return status;
  return "needs-input";
}
