import {
  type RuntimeArtifact,
  type RuntimeTask,
  type StageId,
  type TaskRunState,
  workflowStages,
} from "../../domain";

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
  if (!["dev-review", "test", "final-review", "approval"].includes(stageId)) return false;
  const hasPriorEvidence =
    task.completedStages.includes(stageId) || task.artifacts.some((artifact) => artifact.stage === stageId);
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
) {
  const candidateBound = ["dev-review", "test", "final-review", "approval"].includes(artifact.stage);
  if (!artifact.candidateId || artifact.candidateRevision == null || !candidate) return !candidateBound;
  return artifact.candidateId === candidate.id && artifact.candidateRevision === candidate.revisionNumber;
}

export function isStageComplete(task: RuntimeTask, stageId: StageId) {
  if (!["dev-review", "test", "final-review", "approval"].includes(stageId)) {
    return task.completedStages.includes(stageId);
  }
  const candidate = task.candidates?.at(-1);
  if (!candidate) return false;
  if (stageId === "approval") {
    return task.status === "completed" && candidate.status === "merged";
  }
  return task.artifacts.some(
    (artifact) =>
      artifact.stage === stageId &&
      artifact.candidateId === candidate.id &&
      artifact.candidateRevision === candidate.revisionNumber &&
      artifact.gateResult?.candidateId === candidate.id &&
      artifact.gateResult?.candidateRevision === candidate.revisionNumber &&
      artifact.gateResult?.verdict === "PASS" &&
      (artifact.gateResult.blockingReasons?.length ?? 0) === 0,
  );
}

export function getRuntimeStageSummary(task: RuntimeTask, stageId: StageId, artifact?: RuntimeArtifact) {
  const candidate = task.candidates?.at(-1);
  const packages = task.workPackages ?? [];
  const focused = [...task.artifacts].reverse().find(
    (item) =>
      item.stage === "test" &&
      item.focusedTest &&
      item.candidateId === candidate?.id &&
      item.candidateRevision === candidate?.revisionNumber,
  )?.focusedTest;
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
        title: artifact ? `Review retained for ${candidate?.id ?? "candidate"} r${artifact.candidateRevision ?? candidate?.revisionNumber ?? "\u2014"}` : fallback.title,
        detail: artifact
          ? "The authoritative review remains in the candidate-bound artifact; prose findings are not converted into synthetic P0\u2013P3 records."
          : fallback.detail,
      };
    case "test": {
      const passed = focused?.rows.filter((row) => row.status === "passed").length ?? 0;
      const failed = focused?.rows.filter((row) => row.status === "failed").length ?? 0;
      return {
        kicker: "Test \u00b7 candidate-bound gate",
        title: focused ? `${passed} checks passed \u00b7 ${failed} failed` : fallback.title,
        detail: focused
          ? "Open any persisted result for its command, assertions, evidence, and failure detail. Gate actions remain in the command bar."
          : fallback.detail,
      };
    }
    case "final-review":
      return {
        kicker: "Final review \u00b7 holdout",
        title: artifact ? `Independent workflow review retained for ${candidate?.id ?? "candidate"} r${candidate?.revisionNumber ?? "\u2014"}` : fallback.title,
        detail: artifact
          ? "Every prior stage is summarized from persisted state, real token usage, and its durable artifact reference."
          : fallback.detail,
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
          ? `Target ${candidate.baseBranch} \u00b7 fast-forward only \u00b7 reviewed head ${candidate.headRevision?.slice(0, 8) ?? "pending"}.`
          : fallback.detail,
      };
  }
}


export function toTaskRunState(status: RuntimeTask["status"]): TaskRunState {
  if (status === "closed") return "closed";
  if (status === "queued") return "paused";
  if (status === "cancelled" || status === "blocked") return "blocked";
  if (status === "running" || status === "cancelling") return "running";
  if (status === "failed" || status === "completed") return status;
  return "needs-input";
}
