import {
  Binoculars,
  BookmarkSimple,
  CaretDown,
  CaretUp,
  ClockCounterClockwise,
  X,
} from "@phosphor-icons/react";
import { useState } from "react";
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

export function CommandDock({
  onBriefing,
  onTask,
  onWatch,
}: {
  onBriefing(): void;
  onTask(id: string): void;
  onWatch(taskId: string, runId: string): void;
}) {
  const context = useCommandWorkspace();
  const [expanded, setExpanded] = useState(true);
  if (!context) return null;
  const { memory, snapshot } = context,
    head = snapshot.workspace;
  const available = Boolean(head?.available && head.sourceId && !snapshot.workspaceError);
  const pending = available && memory.checkpoint && head && head.upper > memory.checkpoint.sequence;
  const known = snapshot.connection === "connected" && !snapshot.workspaceError;
  return (
    <aside className="command-dock" aria-label="Workspace catch-up and watch list">
      <div className="command-dock-controls">
        <button
          type="button"
          className={`panel briefing-entry ${pending ? "has-updates" : ""}`}
          onClick={() => {
            context.briefing.begin();
            onBriefing();
          }}
        >
          <ClockCounterClockwise size={18} />
          While you were away
          {pending && <span className="update-dot" role="img" aria-label="Unreviewed changes" />}
        </button>
        <button
          type="button"
          className="panel"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          <Binoculars size={18} />
          Watch list · {memory.pins.length}/4{expanded ? <CaretUp size={16} /> : <CaretDown size={16} />}
        </button>
      </div>
      {memory.error && (
        <p role="alert" className="pin-error panel">
          {memory.error}
        </p>
      )}
      {expanded && (
        <section className="watch-strip panel" aria-label="Pinned work">
          {!memory.pins.length && (
            <p className="quiet">
              {available
                ? "Pin a task or a recorded run to keep it within reach."
                : (snapshot.workspaceError ?? head?.reason ?? "Connecting to workspace preferences…")}
            </p>
          )}
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
                  <strong title={task?.title}>
                    {pin.taskId}
                    {pin.runId && ` · ${pin.runId}`}
                  </strong>
                  <span>
                    {label}
                    {retired && ` · ${task.status}`}
                  </span>
                  <small>
                    {run
                      ? stageLabels[run.stage]
                      : task
                        ? stageLabels[task.currentStage]
                        : "Stage unavailable"}{" "}
                    ·{" "}
                    {task
                      ? `Updated ${new Date(task.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                      : "Last update unavailable"}
                  </small>
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
        </section>
      )}
    </aside>
  );
}
