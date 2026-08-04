import type { StageId } from "./domain.ts";
import type { RuntimeTask } from "./domain/runtime.ts";

type StageLimitTask = Pick<
  RuntimeTask,
  "attemptsByStage" | "candidates" | "currentStage" | "stageRunLimit" | "stageRunLimits"
>;

export function getEffectiveRunStage(task: StageLimitTask): StageId {
  return task.candidates?.at(-1)?.status === "repair_required" ? "implement" : task.currentStage;
}

export function getCurrentStageRunLimit(
  task: Pick<RuntimeTask, "currentStage" | "stageRunLimit" | "stageRunLimits">,
): number {
  return task.stageRunLimits?.[task.currentStage] ?? task.stageRunLimit;
}

export function getEffectiveStageRunLimit(task: StageLimitTask): number {
  const stage = getEffectiveRunStage(task);
  return task.stageRunLimits?.[stage] ?? task.stageRunLimit;
}

export function getEffectiveStageRunAttempts(task: StageLimitTask): number {
  return task.attemptsByStage?.[getEffectiveRunStage(task)] ?? 0;
}
