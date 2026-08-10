import { ArrowClockwise, ArrowRight, CheckCircle, Circle, CircleNotch, XCircle } from "@phosphor-icons/react";
import { type RuntimeTaskSummary, runtimeTaskToRecentTask, workflowStages } from "../domain";
import { ModelStack, PriorityBadge, StateBadge } from "./Primitives";

export function TaskTable({
  tasks,
  onOpenTask,
  emptyTitle = "No tasks persisted",
  emptyCopy = "Create a task to begin a real local workflow.",
  onSeeAll,
}: {
  tasks: RuntimeTaskSummary[];
  onOpenTask: (taskId: string) => void;
  emptyTitle?: string;
  emptyCopy?: string;
  onSeeAll?: () => void;
}) {
  const rows = tasks.map(runtimeTaskToRecentTask);
  return (
    <div className="task-table task-table--shared">
      <div className="task-table__header">
        <span>Task</span>
        <span>Status</span>
        <span>Stage</span>
        <span>Started</span>
        <span>Ended / updated</span>
        <span>Input</span>
        <span>Output</span>
        <span>Cache</span>
        <span>Approx. cost</span>
        <span>Model</span>
      </div>
      {rows.map((task) => {
        const runtimeTask = tasks.find((item) => item.id === task.id);
        if (!runtimeTask) return null;
        return (
        <button className="task-table__row" type="button" key={task.id} onClick={() => onOpenTask(task.id)}>
          <span className="task-table__title">
            <span className="task-title-line">
              <span className="mono">{task.id}</span>
              <PriorityBadge priority={task.priority.toLowerCase() as "low" | "medium" | "high"} />
            </span>
            <strong>{task.title}</strong>
          </span>
          <StateBadge
            state={
              task.status === "Running"
                ? "running"
                : task.status === "Blocked"
                  ? "blocked"
                  : task.status === "Completed"
                    ? "completed"
                    : task.status === "Closed"
                      ? "closed"
                      : task.status === "Continued"
                        ? "continued"
                      : task.status === "Archived"
                        ? "archived"
                        : "needs-input"
            }
          />
          <span className="task-table__stage"><strong>{task.stage}</strong><StageProgress task={runtimeTask} /></span>
          <time>{task.startedAt}</time>
          <time>{task.endedAt === "—" ? task.updatedAt : task.endedAt}</time>
          <span className="task-table__usage" title={`${task.uncachedInputTokens ?? "—"} uncached input · ${task.cachedTokens ?? "—"} cached input`}>
            <strong className="mono">{task.inputTokens ?? task.tokens}</strong>
            <small>{task.uncachedInputTokens ?? "—"} uncached</small>
          </span>
          <span className="mono">{task.outputTokens ?? "—"}</span>
          <span className="task-table__usage" title={`${task.cachedTokens ?? "—"} cached input tokens`}>
            <strong className="mono text-green">{task.cacheRate ?? "—"}</strong>
            <small>{task.cachedTokens ?? "—"} cached</small>
          </span>
          <span className="task-table__cost" title={`${runtimeTask.usage.credits == null ? "Work credits unavailable" : `${runtimeTask.usage.credits.toFixed(3)} ChatGPT work credits`} · API-rate estimate after cached-input discounts. Your ChatGPT-plan session does not report an attributable dollar charge.`}>
            {task.cost}
            <small>{runtimeTask.usage.credits == null ? "API-rate estimate" : `${runtimeTask.usage.credits.toFixed(2)} credits`}</small>
          </span>
          <ModelStack models={task.models} compact />
        </button>
        );
      })}
      {!rows.length ? (
        <div className="task-table__empty">
          <strong>{emptyTitle}</strong>
          <small>{emptyCopy}</small>
        </div>
      ) : null}
      {onSeeAll ? (
        <button type="button" className="task-table__see-all" onClick={onSeeAll}>
          <span>See all tasks</span>
          <ArrowRight size={16} />
        </button>
      ) : null}
    </div>
  );
}

function StageProgress({ task }: { task: RuntimeTaskSummary }) {
  return (
    <span className="task-table__stage-icons" role="img" aria-label={`Stage progress: ${task.completedStages.length} complete; current stage ${task.currentStage}`}>
      {workflowStages.map((stage) => {
        const complete = task.completedStages.includes(stage.id);
        const active = task.currentStage === stage.id;
        const failed = active && ["failed", "blocked", "repair-required"].includes(task.status);
        const persistedRunActive = ["running", "cancelling"].includes(task.status) &&
          (task.activeRunIds?.length ?? 0) > 0;
        const repairing = active && persistedRunActive && task.activeRunKind === "repair";
        if (repairing) return <ArrowClockwise key={stage.id} size={13} className="is-running" />;
        if (failed) return <XCircle key={stage.id} size={13} className="is-failed" weight="fill" />;
        if (complete) return <CheckCircle key={stage.id} size={13} className="is-complete" weight="fill" />;
        if (active && persistedRunActive) return <CircleNotch key={stage.id} size={13} className="is-running spin" />;
        return <Circle key={stage.id} size={13} />;
      })}
    </span>
  );
}
