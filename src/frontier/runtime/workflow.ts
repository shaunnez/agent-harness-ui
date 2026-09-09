import { deriveNextAction } from "../../components/runtime/runtimeCommandPolicy.ts";
import { getRuntimeGateFreshness, isGateUnattempted } from "../../components/runtime/workflow.ts";
import type { RuntimeArtifact, RuntimeAvailableAction, RuntimeCandidate, StageId } from "../../domain.ts";
import type { CandidateScope, TaskCore, TaskEvidence } from "./contracts.ts";

export const gateStages = ["dev-review", "test", "final-review"] as const;
export function gateView(task: TaskCore, stage: (typeof gateStages)[number]) {
  const verified = getRuntimeGateFreshness(task, stage);
  const retained = task.gateFreshness?.[stage];
  const fresh = verified?.fresh === true;
  const recorded =
    task.completedStages.includes(stage) ||
    (task.attemptsByStage[stage] ?? 0) > 0 ||
    task.artifacts.some((artifact) => artifact.stage === stage);
  const pending = (!retained || isGateUnattempted(retained)) && !recorded;
  const running = task.currentStage === stage && task.activeRunKind && task.activeRunKind !== "repair";
  const failed = task.currentStage === stage && ["failed", "review-retry-required"].includes(task.status);
  return {
    fresh,
    label: fresh
      ? "Fresh"
      : running || verified?.reasonCode === "run_in_progress"
        ? "Running"
        : failed
          ? "Execution failed"
          : pending
            ? "Not started"
            : !retained && recorded
              ? "Verdict unavailable"
              : "Rerun required",
    reason:
      verified?.reasonCopy ??
      (retained
        ? "The retained verdict is not bound to the current candidate revision."
        : "No authoritative verdict retained."),
  };
}
export function stageRecorded(evidence: TaskEvidence, stage: StageId) {
  const task = evidence.core;
  return (
    stage === task.currentStage ||
    Boolean(task.stageDispositions?.[stage]) ||
    task.completedStages.includes(stage) ||
    task.artifacts.some((item) => item.stage === stage) ||
    evidence.runs.items.some((item) => item.stage === stage) ||
    (task.attemptsByStage[stage] ?? 0) > 0
  );
}
export function stageState(task: TaskCore, stage: StageId) {
  const gate =
    stage === "dev-review" || stage === "test" || stage === "final-review" ? gateView(task, stage) : null;
  if (task.stageDispositions?.[stage])
    return task.stageDispositions[stage].status === "not-required" ? "Not required" : "Deterministic";
  if (gate) return gate.label;
  if (stage === task.currentStage) return "Current";
  return task.completedStages.includes(stage) ? "Recorded" : "Earlier evidence";
}
export function candidateScope(candidate?: RuntimeCandidate): CandidateScope | undefined {
  return candidate?.headRevision
    ? {
        candidateId: candidate.id,
        candidateRevision: candidate.revisionNumber,
        candidateHeadRevision: candidate.headRevision,
      }
    : undefined;
}
export function reviewIdentity(task: TaskCore) {
  return JSON.stringify([
    task.id,
    task.status,
    task.currentStage,
    candidateScope(task.candidates.at(-1)),
    task.artifacts.at(-1)?.id,
    task.blocker?.code,
  ]);
}
export function proposedAction(task: TaskCore) {
  const next = deriveNextAction(task);
  if (next?.action === "test" && !executable(task, "test") && executable(task, "retry-test"))
    return {
      ...next,
      action: "retry-test" as const,
      label: "Retry test on same candidate",
      detail: "Repeat the repository verification manifest against the unchanged candidate revision.",
    };
  return next;
}
export function executable(task: TaskCore, action: RuntimeAvailableAction | "run") {
  const eligibility = task.actionEligibility?.actions[action];
  return Boolean(eligibility?.allowed && eligibility.mode !== "preflight-only");
}
export function artifactState(
  artifact: Pick<RuntimeArtifact, "candidateId" | "candidateRevision" | "stage">,
  task: TaskCore,
) {
  const candidate = task.candidates.at(-1);
  if (
    artifact.candidateId &&
    candidate &&
    (artifact.candidateId !== candidate.id || artifact.candidateRevision !== candidate.revisionNumber)
  )
    return "Previous candidate · retained for audit";
  if (gateStages.includes(artifact.stage as (typeof gateStages)[number])) {
    const gate = gateView(task, artifact.stage as (typeof gateStages)[number]);
    if (!gate.fresh) return `${gate.label} · ${gate.reason}`;
  }
  return "Retained evidence";
}
