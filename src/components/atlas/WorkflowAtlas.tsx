import {
  ArrowRight,
  CaretUp,
  CheckCircle,
  Hand,
  Info,
  Play,
  Robot,
  WarningCircle,
} from "@phosphor-icons/react";
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { type RuntimeTask, type StageId, workflowStages } from "../../domain";
import { PriorityBadge } from "../Primitives";
import { AtlasLegend, InspectorReopen, RecentHandoffs, TaskAtlasInspector } from "./AtlasSupport";
import { formatAtlasTime, getAtlasStatusLabel, getAtlasTaskTone, getTaskColor } from "./atlasModel";
import { PackageWorkbench } from "./PackageWorkbench";
import { WorkflowAtlasCanvas } from "./WorkflowAtlasCanvas";

export type AtlasPreviewState = "live" | "running" | "attention" | "blocked" | "handoff" | "complete";

const atlasPreviewOptions = [
  { id: "live", label: "Live", Icon: Robot },
  { id: "running", label: "Running", Icon: Play },
  { id: "attention", label: "Needs input", Icon: Hand },
  { id: "blocked", label: "Blocked", Icon: WarningCircle },
  { id: "handoff", label: "Handoff", Icon: ArrowRight },
  { id: "complete", label: "Completed", Icon: CheckCircle },
] as const;

export function WorkflowAtlas({
  tasks,
  loading = false,
  error = null,
  readOnly = false,
  previewState = "live",
  previewTransitionKey = 0,
  onOpenTask,
  onViewAllTasks,
}: {
  tasks: RuntimeTask[];
  loading?: boolean;
  error?: string | null;
  readOnly?: boolean;
  previewState?: AtlasPreviewState;
  previewTransitionKey?: number;
  onOpenTask: (taskId: string, stageId?: StageId) => void;
  onViewAllTasks?: () => void;
}) {
  const visibleTasks = useMemo(
    () =>
      [...tasks].sort(
        (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
      ),
    [tasks],
  );
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(visibleTasks[0]?.id ?? null);
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [supportOpen, setSupportOpen] = useState(false);
  const displayedTasks = useMemo(
    () =>
      visibleTasks.map((task) =>
        task.id === (selectedTaskId ?? visibleTasks[0]?.id) ? taskForAtlasPreview(task, previewState) : task,
      ),
    [previewState, selectedTaskId, visibleTasks],
  );
  const selectedTask = displayedTasks.find((task) => task.id === selectedTaskId) ?? displayedTasks[0] ?? null;

  useEffect(() => {
    if (!visibleTasks.length) setSelectedTaskId(null);
    else if (!visibleTasks.some((task) => task.id === selectedTaskId))
      setSelectedTaskId(visibleTasks[0]?.id ?? null);
  }, [selectedTaskId, visibleTasks]);

  const selectTask = (taskId: string) => {
    setSelectedTaskId(taskId);
    setInspectorOpen(true);
  };

  if (loading && !visibleTasks.length)
    return (
      <AtlasEmpty
        title="Loading workflow atlas…"
        copy="Reading persisted task state from the local companion."
      />
    );
  if (error && !visibleTasks.length)
    return <AtlasEmpty title="Workflow atlas unavailable" copy={error} tone="danger" />;
  if (!visibleTasks.length)
    return (
      <AtlasEmpty
        title="No tasks on the atlas"
        copy="Create a task to launch its courier into the ten-stage workflow."
      />
    );

  return (
    <section className="workflow-atlas" aria-label="Workflow atlas">
      <aside className="atlas-roster" aria-label="Tasks on the workflow atlas">
        <header>
          <h2>Active tasks</h2>
          <span>{visibleTasks.length}</span>
        </header>
        <div className="atlas-roster__list">
          {displayedTasks.map((task) => {
            const tone = getAtlasTaskTone(task);
            const stage = workflowStages.find((item) => item.id === task.currentStage);
            return (
              <button
                type="button"
                key={task.id}
                className={`atlas-task-card atlas-task-card--${tone} ${task.id === selectedTask?.id ? "atlas-task-card--selected" : ""}`}
                style={{ "--task-color": getTaskColor(task.id) } as CSSProperties}
                onClick={() => selectTask(task.id)}
                aria-pressed={task.id === selectedTask?.id}
              >
                <span className="atlas-task-card__top">
                  <i aria-hidden />
                  <strong className="mono">{task.id}</strong>
                  <PriorityBadge priority={task.priority} />
                </span>
                <span className="atlas-task-card__title">{task.title}</span>
                <span className="atlas-task-card__stage">{stage?.shortLabel ?? task.currentStage}</span>
                <span className="atlas-task-card__state">{getAtlasStatusLabel(task)}</span>
                {tone === "blocked" ? (
                  <span className="atlas-task-card__block">
                    <WarningCircle weight="fill" />
                    {task.error ?? "Repair evidence required"}
                  </span>
                ) : null}
                <span className="atlas-task-card__meta">
                  <span>{formatAtlasTime(task.updatedAt)}</span>
                  <span>
                    {task.candidates.at(-1)
                      ? `${task.candidates.at(-1)?.id} r${task.candidates.at(-1)?.revisionNumber}`
                      : "No candidate"}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="atlas-roster__view-all"
          onClick={onViewAllTasks}
          disabled={!onViewAllTasks}
        >
          View all tasks <ArrowRight size={16} weight="bold" />
        </button>
      </aside>

      <div className="atlas-main">
        <header className="atlas-world__header">
          <span>
            <strong>Investigation</strong>
            <small>Triage → implementation plan</small>
          </span>
          <span>
            <strong>Delivery</strong>
            <small>Build → human approval</small>
          </span>
        </header>
        <WorkflowAtlasCanvas
          tasks={displayedTasks}
          selectedTaskId={selectedTask?.id ?? null}
          previewTransitionKey={previewTransitionKey}
          trackPersistedTransitions={previewState === "live"}
          onSelectTask={selectTask}
          onOpenWorkbench={(taskId) => {
            selectTask(taskId);
            setWorkbenchOpen(true);
          }}
        />
        <section
          className={`atlas-support-drawer ${supportOpen ? "atlas-support-drawer--open" : ""}`}
          aria-label="Atlas details"
        >
          <button
            type="button"
            className="atlas-support-drawer__toggle"
            aria-expanded={supportOpen}
            aria-controls="atlas-support-panel"
            onClick={() => setSupportOpen((open) => !open)}
          >
            <span className="atlas-support-drawer__label">
              <Info size={17} weight="fill" />
              <span>
                <strong>Atlas details</strong>
                <small>Legend · recent handoffs · selected task</small>
              </span>
            </span>
            <span className="atlas-support-drawer__action">
              {supportOpen ? "Hide" : "Show"}
              <CaretUp size={17} weight="bold" aria-hidden />
            </span>
          </button>
          <div
            id="atlas-support-panel"
            className={`atlas-support-grid ${inspectorOpen ? "" : "atlas-support-grid--summary-closed"}`}
            aria-hidden={!supportOpen}
            inert={supportOpen ? undefined : true}
          >
            <div className="atlas-support-grid__left">
              <AtlasLegend tasks={displayedTasks} selectedTaskId={selectedTask?.id ?? null} />
              <RecentHandoffs
                tasks={visibleTasks}
                onOpenTask={onOpenTask}
                onViewAll={onViewAllTasks}
                readOnly={readOnly}
              />
            </div>
            {selectedTask ? (
              inspectorOpen ? (
                <TaskAtlasInspector
                  task={selectedTask}
                  onOpenTask={onOpenTask}
                  onOpenWorkbench={() => setWorkbenchOpen(true)}
                  onClose={() => setInspectorOpen(false)}
                  readOnly={readOnly}
                  previewing={previewState !== "live"}
                />
              ) : (
                <InspectorReopen task={selectedTask} onOpen={() => setInspectorOpen(true)} />
              )
            ) : null}
          </div>
        </section>
      </div>
      {selectedTask ? (
        <PackageWorkbench task={selectedTask} open={workbenchOpen} onClose={() => setWorkbenchOpen(false)} />
      ) : null}
    </section>
  );
}

export function AtlasStatePreview({
  value,
  onChange,
}: {
  value: AtlasPreviewState;
  onChange: (state: AtlasPreviewState) => void;
}) {
  return (
    <div className="atlas-state-preview-wrap">
      <fieldset className="atlas-state-preview">
        <legend>Preview state</legend>
        {atlasPreviewOptions.map(({ id, label, Icon }) => (
          <button
            type="button"
            key={id}
            className={value === id ? "is-selected" : ""}
            onClick={() => onChange(id)}
            aria-pressed={value === id}
            title={id === "live" ? "Show persisted task state" : `Preview ${label.toLowerCase()} state`}
          >
            <Icon size={13} weight={value === id ? "fill" : "regular"} />
            {label}
          </button>
        ))}
      </fieldset>
      {value === "live" ? null : (
        <span
          className="atlas-state-preview__notice"
          title="Visual preview only; persisted task data is unchanged"
        >
          Preview only
        </span>
      )}
    </div>
  );
}

function taskForAtlasPreview(task: RuntimeTask, state: AtlasPreviewState): RuntimeTask {
  if (state === "live") return task;
  if (state === "running" || state === "handoff") {
    return {
      ...task,
      currentStage: "implement",
      status: "running",
      error: null,
      completedStages: ["triage", "scouts", "grill", "specification", "plan"],
      workPackages: task.workPackages.map((item, index) => ({
        ...item,
        status: index === 0 ? "running" : item.status,
      })),
    };
  }
  if (state === "attention") {
    return {
      ...task,
      currentStage: "approval",
      status: "awaiting-human-approval",
      error: null,
      completedStages: workflowStages.slice(0, -1).map((stage) => stage.id),
    };
  }
  if (state === "blocked") {
    return {
      ...task,
      currentStage: "dev-review",
      status: "blocked",
      error: task.error ?? "Preview only: persisted blocking evidence and the repair action appear here.",
      completedStages: workflowStages.slice(0, 6).map((stage) => stage.id),
    };
  }
  return {
    ...task,
    currentStage: "approval",
    status: "completed",
    error: null,
    completedStages: workflowStages.map((stage) => stage.id),
  };
}

function AtlasEmpty({
  title,
  copy,
  tone = "default",
}: {
  title: string;
  copy: string;
  tone?: "default" | "danger";
}) {
  return (
    <section className={`atlas-empty atlas-empty--${tone}`}>
      <Robot size={30} />
      <h2>{title}</h2>
      <p>{copy}</p>
    </section>
  );
}
