import { Check, CircleNotch, X } from "@phosphor-icons/react";
import type { StageId } from "../../domain";
import { workflowStages } from "../../domain";
import type { RuntimeTaskWorkspaceProps } from "./contracts";
import {
  getStageTemporalState,
  isStageComplete,
  isStageInvalidatedByRepair,
  isStageRunning,
} from "./workflow";

type Props = {
  task: RuntimeTaskWorkspaceProps["task"];
  viewedStageId: StageId;
  onSelect: (stageId: StageId) => void;
};

export function RuntimeStageNavigator({ task, viewedStageId, onSelect }: Props) {
  return (
    <nav className="stage-navigator" aria-label="Workflow stages">
      {workflowStages.map((stage, index) => {
        const invalidated = isStageInvalidatedByRepair(task, stage.id);
        const complete = isStageComplete(task, stage.id) && !invalidated;
        const active = stage.id === task.currentStage;
        const selected = stage.id === viewedStageId;
        const failed = active && (task.status === "failed" || task.status === "blocked");
        const running = isStageRunning(task, stage.id);
        const future = getStageTemporalState(task, stage.id) === "future";
        return (
          <button
            type="button"
            key={stage.id}
            className={`stage-step ${complete ? "stage-step--complete" : ""} ${active ? "stage-step--active" : ""} ${selected ? "stage-step--selected" : ""} ${failed ? "stage-step--failed" : ""} ${invalidated && !running ? "stage-step--stale" : ""} ${running ? "stage-step--running" : ""} ${future ? "stage-step--disabled" : ""}`}
            onClick={() => {
              if (!future) onSelect(stage.id);
            }}
            disabled={future}
            title={future ? "This stage has not started yet." : undefined}
            aria-current={selected ? "step" : undefined}
          >
            <span className="stage-step__node">
              {running ? (
                <CircleNotch size={14} className="is-running spin" />
              ) : complete ? (
                <Check size={14} weight="bold" />
              ) : failed ? (
                <X size={14} weight="bold" />
              ) : (
                index + 1
              )}
            </span>
            <span>
              <strong>{stage.shortLabel}</strong>
              <small>
                {running
                  ? "running"
                  : invalidated
                    ? "rerun required"
                    : task.stageDispositions?.[stage.id]
                      ? task.stageDispositions[stage.id]?.status.replace("-", " ")
                      : active
                        ? task.status === "running"
                          ? "current"
                          : task.status.replace("-", " ")
                        : complete
                          ? "done"
                          : future
                            ? "not started"
                            : "—"}
              </small>
            </span>
          </button>
        );
      })}
    </nav>
  );
}
