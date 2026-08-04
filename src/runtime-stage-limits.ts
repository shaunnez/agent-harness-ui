import type { RuntimeTask } from "./domain/runtime";

export function getCurrentStageRunLimit(
  task: Pick<RuntimeTask, "currentStage" | "stageRunLimit" | "stageRunLimits">,
): number {
  return task.stageRunLimits?.[task.currentStage] ?? task.stageRunLimit;
}
