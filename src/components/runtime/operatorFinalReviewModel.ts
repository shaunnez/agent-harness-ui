import { isModelRunArtifact, resolveScoutUsage, sumArtifactUsage } from "../../artifactPresentation";
import { type RuntimeTask, type StageId, workflowStages } from "../../domain";
import type { OperatorTone } from "./operatorViewModel";
import {
  getRuntimeGateFreshness,
  getRuntimeStageSummary,
  getStageTemporalState,
  isCandidateGateStage,
  isGateUnattempted,
  isStageComplete,
  isStageRunning,
} from "./workflow";

export interface OperatorFinalReviewRow {
  stageId: StageId;
  label: string;
  state: string;
  tone: OperatorTone;
  tokens: number;
  apiEstimate: number | null;
  estimatePartial: boolean;
  outcome: string;
  detail: string;
}

export function buildOperatorFinalReviewRows(task: RuntimeTask): OperatorFinalReviewRow[] {
  const finalReviewIndex = workflowStages.findIndex((stage) => stage.id === "final-review");
  return workflowStages.slice(0, finalReviewIndex).map((stage) => {
    const artifact = findStageArtifact(task, stage.id);
    const running = isStageRunning(task, stage.id);
    const temporalState = getStageTemporalState(task, stage.id);
    const summary = getRuntimeStageSummary(task, stage.id, artifact, running);
    const freshness = isCandidateGateStage(stage.id) ? getRuntimeGateFreshness(task, stage.id) : null;
    const usage = stageUsage(task, stage.id);
    const disposition = task.stageDispositions?.[stage.id];
    const stale = freshness && !freshness.fresh && !isGateUnattempted(freshness);
    const failedCurrentStage =
      stage.id === task.currentStage && ["failed", "blocked", "cancelled"].includes(task.status);
    const state = disposition
      ? "Not required"
      : running
        ? "Running"
        : stale
          ? "Rerun required"
          : failedCurrentStage
            ? humanizeStatus(task.status)
            : isStageComplete(task, stage.id)
              ? freshness
                ? "Fresh"
                : "Complete"
              : temporalState === "future"
                ? "Not started"
                : "Incomplete";
    const tone: OperatorTone =
      stale || failedCurrentStage
        ? "red"
        : running
          ? "blue"
          : isStageComplete(task, stage.id) || disposition
            ? "green"
            : temporalState === "future"
              ? "neutral"
              : "amber";
    return {
      stageId: stage.id,
      label: stage.shortLabel,
      state,
      tone,
      tokens: usage.totalTokens,
      apiEstimate: usage.cost,
      estimatePartial: usage.estimatePartial,
      outcome: disposition?.reason ?? (stale ? freshness.reasonCopy : summary.title),
      detail: stale ? "Prior evidence is retained for audit." : summary.detail,
    };
  });
}

function stageUsage(task: RuntimeTask, stageId: StageId) {
  if (stageId === "scouts") {
    const aggregate = resolveScoutUsage(task).aggregate;
    return {
      totalTokens: aggregate.totalTokens,
      cost: aggregate.cost,
      estimatePartial: aggregate.runs > aggregate.pricedRuns && aggregate.pricedRuns > 0,
    };
  }
  const artifacts = task.artifacts.filter(
    (artifact) => artifact.stage === stageId && isModelRunArtifact(artifact),
  );
  const representedRunIds = new Set(
    artifacts.flatMap((artifact) => (artifact.runId ? [artifact.runId] : [])),
  );
  const runUsage = (task.runs ?? []).flatMap((run) => {
    if (run.stage !== stageId || !run.usage || representedRunIds.has(run.id)) return [];
    return [{ model: run.model, runId: run.id, usage: run.usage }];
  });
  const aggregate = sumArtifactUsage([...artifacts, ...runUsage]);
  return {
    totalTokens: aggregate.totalTokens,
    cost: aggregate.cost,
    estimatePartial: aggregate.runs > aggregate.pricedRuns && aggregate.pricedRuns > 0,
  };
}

function findStageArtifact(task: RuntimeTask, stageId: StageId) {
  if (isCandidateGateStage(stageId)) {
    const sourceArtifactId = getRuntimeGateFreshness(task, stageId)?.sourceArtifactId;
    if (sourceArtifactId) {
      return task.artifacts.find(
        (artifact) => artifact.stage === stageId && artifact.id === sourceArtifactId,
      );
    }
  }
  return [...task.artifacts].reverse().find((artifact) => artifact.stage === stageId);
}

function humanizeStatus(value: string) {
  const text = value.replaceAll("_", " ").replaceAll("-", " ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}
