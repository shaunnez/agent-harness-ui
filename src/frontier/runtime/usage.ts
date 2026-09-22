import type { RuntimeRun, RuntimeUsage, StageId } from "../../domain.ts";
import type { TaskEvidence, TaskSummary } from "./contracts.ts";

export function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
export function sumRecorded(values: Array<number | null | undefined>) {
  const known = values.map(finite).filter((value): value is number => value !== null);
  return {
    value: known.length ? known.reduce((sum, value) => sum + value, 0) : null,
    known: known.length,
    total: values.length,
  };
}
export function usageTotals(values: Array<RuntimeUsage | null | undefined>) {
  const input = sumRecorded(values.map((value) => value?.inputTokens));
  const output = sumRecorded(values.map((value) => value?.outputTokens));
  const cached = sumRecorded(values.map((value) => value?.cachedInputTokens));
  const cost = sumRecorded(values.map((value) => (value?.pricingVersion ? value.cost : null)));
  const credits = sumRecorded(values.map((value) => value?.credits));
  const cacheRate =
    input.value && cached.value != null && input.known === values.length && cached.known === values.length
      ? cached.value / input.value
      : null;
  return { input, output, cached, cost, credits, cacheRate };
}
export function taskWallTime(task: TaskSummary, now: number) {
  if (!task.startedAt) return null;
  const end = task.completedAt ?? task.closure?.closedAt ?? task.archive?.archivedAt;
  if (!end && ["completed", "closed", "archived", "cancelled", "failed", "blocked"].includes(task.status))
    return null;
  const elapsed = (end ? Date.parse(end) : now) - Date.parse(task.startedAt);
  return finite(elapsed);
}
export function runTime(run: RuntimeRun, now: number, active = false) {
  if (finite(run.durationMs) != null) return run.durationMs;
  if (!run.startedAt) return null;
  const end = run.completedAt ? Date.parse(run.completedAt) : active && run.status === "running" ? now : NaN;
  return finite(end - Date.parse(run.startedAt));
}

/** Loaded run pages are a subtotal until the task's complete run history is present. */
export function stageUsage(evidence: TaskEvidence, stage: StageId, now: number) {
  const runs = [...new Map(evidence.runs.items.map((run) => [run.id, run])).values()].filter(
    (run) => run.stage === stage,
  );
  const partialHistory =
    Boolean(evidence.runs.nextCursor) || evidence.runs.items.length < evidence.runs.total;
  return {
    ...usageTotals(runs.map((run) => run.usage)),
    tokens: sumRecorded(runs.map((run) => run.usage?.totalTokens)),
    execution: sumRecorded(
      runs.map((run) => runTime(run, now, evidence.core.activeRunIds?.includes(run.id) ?? false)),
    ),
    runCount: runs.length,
    partialHistory,
  };
}
