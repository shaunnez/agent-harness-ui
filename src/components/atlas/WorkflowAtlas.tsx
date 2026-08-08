import { Robot, WarningCircle } from "@phosphor-icons/react";
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { type RuntimeTask, type StageId, workflowStages } from "../../domain";
import { PriorityBadge } from "../Primitives";
import { AtlasLegend, InspectorReopen, RecentHandoffs, TaskAtlasInspector } from "./AtlasSupport";
import { formatAtlasTime, getAtlasStatusLabel, getAtlasTaskTone, getTaskColor } from "./atlasModel";
import { PackageWorkbench } from "./PackageWorkbench";
import { WorkflowAtlasCanvas } from "./WorkflowAtlasCanvas";

export function WorkflowAtlas({
  tasks,
  loading = false,
  error = null,
  readOnly = false,
  onOpenTask,
  onViewAllTasks,
}: {
  tasks: RuntimeTask[];
  loading?: boolean;
  error?: string | null;
  readOnly?: boolean;
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
  const selectedTask = visibleTasks.find((task) => task.id === selectedTaskId) ?? visibleTasks[0] ?? null;

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
          <div>
            <p className="eyebrow">Courier roster</p>
            <h2>Active tasks</h2>
          </div>
          <span>{visibleTasks.length}</span>
        </header>
        <div className="atlas-roster__list">
          {visibleTasks.map((task) => {
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
          tasks={visibleTasks}
          selectedTaskId={selectedTask?.id ?? null}
          onSelectTask={selectTask}
          onOpenWorkbench={(taskId) => {
            selectTask(taskId);
            setWorkbenchOpen(true);
          }}
        />
        <div className={`atlas-support-grid ${inspectorOpen ? "" : "atlas-support-grid--summary-closed"}`}>
          <div className="atlas-support-grid__left">
            <AtlasLegend tasks={visibleTasks} selectedTaskId={selectedTask?.id ?? null} />
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
              />
            ) : (
              <InspectorReopen task={selectedTask} onOpen={() => setInspectorOpen(true)} />
            )
          ) : null}
        </div>
      </div>
      {selectedTask ? (
        <PackageWorkbench task={selectedTask} open={workbenchOpen} onClose={() => setWorkbenchOpen(false)} />
      ) : null}
    </section>
  );
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
