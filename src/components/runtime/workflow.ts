import {
  type RuntimeArtifact,
  type RuntimeCandidateGateStage,
  type RuntimeCandidateStageFreshness,
  type RuntimeFreshness,
  type RuntimeTask,
  type StageId,
  type TaskRunState,
  workflowStages,
} from "../../domain";

export const candidateGateStages: RuntimeCandidateGateStage[] = [
  "dev-review",
  "test",
  "final-review",
  "approval",
];

export function isCandidateBoundStage(stageId: StageId): stageId is RuntimeCandidateGateStage {
  return candidateGateStages.includes(stageId as RuntimeCandidateGateStage);
}

export function getCandidateStageFreshness(
  task: RuntimeTask,
  stageId: StageId,
): RuntimeCandidateStageFreshness | null {
  if (!isCandidateBoundStage(stageId)) return null;
  return task.candidateFreshness?.stages[stageId] ?? null;
}

export function getFreshnessMessage(freshness: RuntimeFreshness | null | undefined) {
  return (
    freshness?.message ??
    "Freshness projection is unavailable; this evidence cannot be treated as current. Reload the task before acting."
  );
}

export function getFreshnessLabel(freshness: RuntimeFreshness | null | undefined) {
  if (freshness?.state === "fresh") return "Current evidence";
  if (freshness?.reason === "candidate-revision-mismatch") return "Stale after repair";
  return "Rerun required";
}

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
  const freshness = getCandidateStageFreshness(task, stageId);
  if (freshness?.state !== "stale") return false;
  return Boolean(
    freshness.artifactId || freshness.runId || task.artifacts.some((artifact) => artifact.stage === stageId),
  );
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
  _candidate: RuntimeTask["candidates"][number] | undefined,
) {
  return artifact.freshness?.state === "fresh";
}

export function isStageComplete(task: RuntimeTask, stageId: StageId) {
  if (!isCandidateBoundStage(stageId)) return task.completedStages.includes(stageId);
  return getCandidateStageFreshness(task, stageId)?.state === "fresh";
}

export function getRuntimeStageSummary(task: RuntimeTask, stageId: StageId, artifact?: RuntimeArtifact) {
  const candidate = task.candidates?.at(-1);
  const packages = task.workPackages ?? [];
  const stageFreshness = getCandidateStageFreshness(task, stageId);
  const focusedProjection = task.candidateFreshness?.currentFocusedTest;
  const focused = focusedProjection?.freshness.state === "fresh" ? focusedProjection.evidence : null;
  const completedPackages = packages.filter((item) =>
    ["integrated", "ready_for_integration"].includes(item.status),
  ).length;
  const stageLabel = workflowStages.find((stage) => stage.id === stageId)?.label ?? stageId;
  const waiting = !artifact && !isStageComplete(task, stageId);
  const awaitingApproval =
    stageId === "approval" &&
    task.status === "awaiting-human-approval" &&
    candidate?.status === "awaiting_human_approval" &&
    stageFreshness?.reason === "missing-stage-evidence" &&
    (["dev-review", "test", "final-review"] as RuntimeCandidateGateStage[]).every(
      (stage) => task.candidateFreshness?.stages[stage]?.state === "fresh",
    );
  const stale = stageFreshness?.state === "stale" && !awaitingApproval;
  const staleDetail = stale
    ? `${getFreshnessMessage(stageFreshness)} Superseded evidence remains inspectable for audit.`
    : null;
  const fallback = {
    kicker: `${stageLabel} \u00b7 ${stageId === task.currentStage ? "current execution" : "living artifact"}`,
    title: stale
      ? `${stageLabel} requires rerun`
      : waiting
        ? `${stageLabel} is not ready yet`
        : (artifact?.name ?? stageLabel),
    detail:
      staleDetail ??
      (waiting
        ? "This stage has not produced an authoritative handoff yet. Earlier evidence remains inspectable."
        : "The persisted handoff remains read-only and available to downstream gates."),
  };
  switch (stageId) {
    case "triage":
      return {
        kicker: "Triage \u00b7 routing gate",
        title: artifact
          ? `${task.priority.charAt(0).toUpperCase()}${task.priority.slice(1)} priority \u00b7 ${task.workflow} workflow`
          : fallback.title,
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
          : (task.grillSession?.completionReason ?? fallback.detail),
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
          ? `${packages.length} work packages \u00b7 ${new Set(packages.map((item) => item.batch)).size} batches`
          : fallback.title,
        detail: packages.length
          ? "Each package exposes real dependencies, ownership, verification commands, attempts, and integration readiness."
          : fallback.detail,
      };
    case "implement":
      return {
        kicker: "Implement \u00b7 isolated work packages",
        title: packages.length
          ? `${completedPackages} of ${packages.length} packages qualified`
          : fallback.title,
        detail: candidate
          ? `${candidate.id} revision ${candidate.revisionNumber} is the explicit integration candidate for every downstream gate.`
          : fallback.detail,
      };
    case "dev-review":
      return {
        kicker: "Dev review \u00b7 fresh-context advisor",
        title: stale
          ? fallback.title
          : artifact
            ? `Review retained for ${candidate?.id ?? "candidate"} r${artifact.candidateRevision ?? candidate?.revisionNumber ?? "\u2014"}`
            : fallback.title,
        detail:
          staleDetail ??
          (artifact
            ? "The authoritative review remains in the candidate-bound artifact; prose findings are not converted into synthetic P0\u2013P3 records."
            : fallback.detail),
      };
    case "test": {
      const passed = focused?.rows.filter((row) => row.status === "passed").length ?? 0;
      const failed = focused?.rows.filter((row) => row.status === "failed").length ?? 0;
      return {
        kicker: "Test \u00b7 candidate-bound gate",
        title: stale
          ? fallback.title
          : focused
            ? `${passed} checks passed \u00b7 ${failed} failed`
            : fallback.title,
        detail:
          staleDetail ??
          (focused
            ? "Open any persisted result for its command, assertions, evidence, and failure detail. Gate actions remain in the command bar."
            : fallback.detail),
      };
    }
    case "final-review":
      return {
        kicker: "Final review \u00b7 holdout",
        title: stale
          ? fallback.title
          : artifact
            ? `Independent workflow review retained for ${candidate?.id ?? "candidate"} r${candidate?.revisionNumber ?? "\u2014"}`
            : fallback.title,
        detail:
          staleDetail ??
          (artifact
            ? "Every prior stage is summarized from persisted state, real token usage, and its durable artifact reference."
            : fallback.detail),
      };
    case "approval":
      return {
        kicker: "Human approval \u00b7 exact candidate",
        title: stale
          ? fallback.title
          : candidate?.status === "merged"
            ? `Candidate merged successfully \u00b7 ${candidate.id} r${candidate.revisionNumber}`
            : candidate
              ? `${candidate.id} r${candidate.revisionNumber} awaits approval`
              : fallback.title,
        detail:
          staleDetail ??
          (candidate
            ? `Target ${candidate.baseBranch} \u00b7 fast-forward only \u00b7 reviewed head ${candidate.headRevision?.slice(0, 8) ?? "pending"}.`
            : fallback.detail),
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
