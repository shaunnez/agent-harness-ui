import { BookmarkSimple, X } from "@phosphor-icons/react";
import { useCommandWorkspace } from "../app/command-context.tsx";
import { pinKey } from "../app/command-memory.ts";
import { attentionFor, stageLabels } from "../runtime/presentation.ts";

export function PinButton({
  taskId,
  runId = null,
  compact = false,
}: {
  taskId: string;
  runId?: string | null;
  compact?: boolean;
}) {
  const context = useCommandWorkspace();
  if (!context) return null;
  const { memory, snapshot } = context;
  const pin = { taskId, runId },
    selected = memory.pins.some((item) => pinKey(item) === pinKey(pin));
  return (
    <>
      <button
        type="button"
        aria-pressed={selected}
        className={compact ? "icon-button" : undefined}
        aria-label={`${selected ? "Unpin" : "Pin"} ${runId ? "run" : "task"}`}
        disabled={!snapshot.workspace?.available || Boolean(snapshot.workspaceError)}
        title={
          snapshot.workspaceError ?? snapshot.workspace?.reason ?? "Remember this in your local watch list"
        }
        onClick={() => memory.toggle(pin)}
      >
        <BookmarkSimple size={16} weight={selected ? "fill" : "regular"} />
        <span className={compact ? "sr-only" : undefined}>
          {selected ? "Unpin" : "Pin"} {runId ? "run" : "task"}
        </span>
      </button>
      {memory.error && (
        <span role="alert" className="pin-inline-error">
          {memory.error}
        </span>
      )}
    </>
  );
}

export function PinnedWork({
  onTask,
  onWatch,
}: {
  onTask(id: string): void;
  onWatch(taskId: string, runId: string): void;
}) {
  const context = useCommandWorkspace();
  if (!context) return null;
  const { memory, snapshot } = context;
  const known = snapshot.connection === "connected" && !snapshot.workspaceError;
  if (!memory.pins.length) return null;
  return (
    <aside className="pinned-work panel" aria-label="Pinned work">
      <header>
        <strong>Pinned</strong>
        <span className="count">{memory.pins.length}</span>
      </header>
      {memory.error && (
        <p role="alert" className="pin-error panel">
          {memory.error}
        </p>
      )}
      <div className="pinned-rows">
        {memory.pins.map((pin) => {
          const task = snapshot.tasks.find((item) => item.id === pin.taskId),
            project = snapshot.projects.find((item) => item.repositoryPath === task?.repositoryPath);
          const record = snapshot.watchedRuns[pinKey(pin)],
            run = record && "run" in record ? record.run : null;
          const error = record && "error" in record ? record.error : null;
          const retired = task && ["closed", "archived"].includes(task.status);
          const label = !known
            ? "Last known state"
            : !task
              ? "Task unavailable"
              : error
                ? "Last known state · refresh failed"
                : pin.runId
                  ? !record
                    ? "Loading recorded run…"
                    : !run
                      ? "Run no longer retained"
                      : "active" in record && record.active
                        ? "Run executing"
                        : run.status === "running"
                          ? "Run not confirmed active"
                          : `Historical · ${run.status}`
                  : attentionFor(task).label;
          return (
            <article className="watch-pin" key={pinKey(pin)}>
              <div>
                <small>{project?.name ?? "Project unavailable"}</small>
                <strong title={`${task?.title ?? pin.taskId}${pin.runId ? ` · ${pin.runId}` : ""}`}>
                  {pin.taskId} ·{" "}
                  {run ? stageLabels[run.stage] : task ? stageLabels[task.currentStage] : "Stage unavailable"}
                  {pin.runId && ` · ${pin.runId}`}
                </strong>
                <span>
                  {label}
                  {retired && ` · ${task.status}`}
                </span>
              </div>
              <div className="watch-pin-actions">
                <button
                  type="button"
                  disabled={!task}
                  onClick={() => (pin.runId ? onWatch(pin.taskId, pin.runId) : onTask(pin.taskId))}
                >
                  {pin.runId ? "Watch" : "Open"}
                </button>
                <button
                  type="button"
                  aria-label={`Unpin ${pin.taskId}${pin.runId ? ` ${pin.runId}` : ""}`}
                  onClick={() => memory.toggle(pin)}
                >
                  <X size={16} />
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </aside>
  );
}
