import { Archive, ArrowLeft, Pause, Prohibit, X } from "@phosphor-icons/react";
import { workflowStages } from "../../domain";
import {
  getEffectiveRunStage,
  getEffectiveStageRunAttempts,
  getEffectiveStageRunLimit,
} from "../../runtime-stage-limits";
import { Button, PriorityBadge, StateBadge } from "../Primitives";
import type { RuntimeTaskWorkspaceProps } from "./contracts";
import { toTaskRunState } from "./workflow";

type Props = Pick<
  RuntimeTaskWorkspaceProps,
  "task" | "readOnlyPreview" | "onBack" | "onCancel" | "onCloseTask" | "onArchiveTask"
> & {
  viewMode: "operator" | "evidence";
  onViewModeChange: (viewMode: "operator" | "evidence") => void;
};

export function RuntimeTaskHeader({
  task,
  readOnlyPreview = false,
  onBack,
  onCancel,
  onCloseTask,
  onArchiveTask,
  viewMode,
  onViewModeChange,
}: Props) {
  const currentIndex = Math.max(
    0,
    workflowStages.findIndex((stage) => stage.id === task.currentStage),
  );
  const currentStageRunLimit = getEffectiveStageRunLimit(task);
  const currentStageRunAttempts = getEffectiveStageRunAttempts(task);
  const effectiveRunStage = getEffectiveRunStage(task);
  const stageRunLabel = effectiveRunStage === task.currentStage ? "Stage" : "Implement repair";
  const repoName = task.repositoryPath.split(/[\\/]/).filter(Boolean).at(-1) ?? task.repositoryPath;
  const state = toTaskRunState(task.status);
  const mergeReconciliationPending =
    task.status === "merging" ||
    task.status === "awaiting-pr-merge" ||
    task.mergeIntent?.status === "pending" ||
    ["publishing", "open"].includes(task.pullRequestIntent?.status ?? "");

  const archiveTask = async () => {
    if (
      !window.confirm(
        `Archive ${task.id}? It leaves the command centre and task list, and its clean worktrees are removed. Anything with uncommitted work is left in place.`,
      )
    )
      return;
    await onArchiveTask();
  };

  const closeTask = async () => {
    const supersededBy = window.prompt(
      "Optional superseding task ID. Leave blank to close this task as not needed.",
      "",
    );
    if (supersededBy === null) return;
    const replacement = supersededBy.trim();
    await onCloseTask(
      replacement ? "superseded" : "not-needed",
      "Closed from the universal task inspector.",
      replacement || undefined,
    );
  };

  return (
    <header className="task-header">
      <button
        type="button"
        className="icon-button task-header__back"
        onClick={onBack}
        aria-label="Back to tasks"
      >
        <ArrowLeft size={18} />
      </button>
      <div className="task-title-block">
        <span className="mono task-id">{task.id}</span>
        <h1>{task.title}</h1>
      </div>
      <PriorityBadge priority={task.priority} />
      <div className="task-header__meta">
        <StateBadge
          state={state}
          label={
            task.status === "awaiting-pr-merge"
              ? "Awaiting PR merge"
              : state === "failed"
                ? `${workflowStages[currentIndex]?.label ?? "Stage"} failed`
                : undefined
          }
        />
        <span>
          <small>Repository</small>
          <strong>{repoName}</strong>
        </span>
        <span>
          <small>Stage</small>
          <strong>{currentIndex + 1} / 10</strong>
        </span>
        <span>
          <small>{stageRunLabel} attempts</small>
          <strong>
            {currentStageRunAttempts} / {currentStageRunLimit}
          </strong>
        </span>
      </div>
      <fieldset className="operator-view-toggle runtime-view-toggle">
        <legend className="sr-only">Workspace detail level</legend>
        <button
          type="button"
          className={viewMode === "operator" ? "is-selected" : ""}
          aria-pressed={viewMode === "operator"}
          onClick={() => onViewModeChange("operator")}
        >
          Operator
        </button>
        <button
          type="button"
          className={viewMode === "evidence" ? "is-selected" : ""}
          aria-pressed={viewMode === "evidence"}
          onClick={() => onViewModeChange("evidence")}
        >
          Evidence
        </button>
      </fieldset>
      <fieldset className="task-header__actions">
        <legend className="sr-only">Global task controls</legend>
        <Button
          tone="secondary"
          compact
          icon={Prohibit}
          disabled={
            readOnlyPreview ||
            ["running", "cancelling"].includes(task.status) ||
            task.status === "closed" ||
            task.status === "awaiting-already-satisfied" ||
            mergeReconciliationPending
          }
          title={
            mergeReconciliationPending
              ? "Wait for the pending GitHub PR lifecycle before closing this task."
              : task.status === "awaiting-already-satisfied"
                ? "Use Close — already implemented after reviewing the revision-bound evidence."
                : ["running", "cancelling"].includes(task.status)
                  ? "Wait for the active process tree to terminate before closing this task."
                  : task.status === "closed"
                    ? "This task is already closed."
                    : "Close as not needed or record the superseding task."
          }
          onClick={() => void closeTask()}
        >
          Close task
        </Button>
        <Button
          tone="secondary"
          compact
          icon={Archive}
          disabled={
            readOnlyPreview ||
            ["running", "cancelling"].includes(task.status) ||
            task.status === "archived" ||
            mergeReconciliationPending
          }
          title={
            mergeReconciliationPending
              ? "Wait for the pending GitHub PR lifecycle before archiving this task."
              : ["running", "cancelling"].includes(task.status)
                ? "Wait for the active process tree to terminate before archiving this task."
                : task.status === "archived"
                  ? "This task is already archived."
                  : "Hide this task from the command centre and task list, and reclaim its worktrees."
          }
          onClick={() => void archiveTask()}
        >
          Archive
        </Button>
        <Button
          tone="secondary"
          compact
          icon={Pause}
          disabled
          title="Pause is not supported by the current local runtime contract."
        >
          Pause
        </Button>
        <Button
          tone="danger"
          compact
          icon={X}
          disabled={readOnlyPreview || task.status !== "running"}
          title={
            task.status === "cancelling"
              ? "Process-tree termination is already in progress"
              : task.status === "running"
                ? "Cancel the active Codex run"
                : "No active run to cancel"
          }
          onClick={() => void onCancel()}
        >
          Cancel
        </Button>
      </fieldset>
    </header>
  );
}
