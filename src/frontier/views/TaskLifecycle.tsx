import { Archive, PauseCircle, XCircle } from "@phosphor-icons/react";
import { useState } from "react";
import type { FrontierGateway, TaskCore } from "../runtime/contracts";
import { isExecuting } from "../runtime/presentation";

export function TaskLifecycle({
  task,
  gateway,
  busy,
  connected,
  error,
  command,
  onDone,
}: {
  task: TaskCore;
  gateway: FrontierGateway;
  busy: boolean;
  connected: boolean;
  error: string | null;
  command(action: () => Promise<unknown>, then?: () => void): Promise<void>;
  onDone(): void;
}) {
  const [action, setAction] = useState<"cancel" | "close" | "archive" | null>(null);
  const [reason, setReason] = useState<"not-needed" | "superseded" | "duplicate">("not-needed");
  const [note, setNote] = useState("");
  const [replacement, setReplacement] = useState("");
  const running = isExecuting(task) || task.status === "running" || task.status === "cancelling";
  const publication =
    task.mergeIntent?.status === "pending" ||
    ["publishing", "open"].includes(task.pullRequestIntent?.status ?? "") ||
    ["merging", "awaiting-pr-merge"].includes(task.status);
  const allowed =
    action === "cancel"
      ? running && task.status !== "cancelling"
      : !running &&
        !publication &&
        task.status !== "archived" &&
        (action !== "close" || !["closed", "awaiting-already-satisfied"].includes(task.status));
  return (
    <div className="overlay-body lifecycle-body">
      <small>{task.id}</small>
      <h2>{task.title}</h2>
      <p className="quiet">Current state: {task.status.replaceAll("-", " ")}</p>
      <div className="lifecycle-options">
        {[
          {
            id: "cancel" as const,
            label: "Cancel active run",
            detail: "Stops current execution and retains its output. This does not complete the task.",
            Icon: PauseCircle,
            disabled: !running || task.status === "cancelling",
          },
          {
            id: "close" as const,
            label: "Close task",
            detail:
              "Record why this work is no longer needed or which task replaces it. Evidence is retained.",
            Icon: XCircle,
            disabled:
              running ||
              publication ||
              ["closed", "archived", "awaiting-already-satisfied"].includes(task.status),
          },
          {
            id: "archive" as const,
            label: "Archive task",
            detail:
              "Moves the task into the archive. Safely removable temporary worktrees are reclaimed; uncommitted work is retained.",
            Icon: Archive,
            disabled: running || publication || task.status === "archived",
          },
        ].map(({ id, label, detail, Icon, disabled }) => (
          <button
            type="button"
            key={id}
            disabled={disabled || busy}
            aria-pressed={action === id}
            onClick={() => setAction(id)}
          >
            <Icon size={26} />
            <span>
              <strong>{label}</strong>
              <small>{detail}</small>
            </span>
          </button>
        ))}
      </div>
      {publication && (
        <p className="notice">
          This task is waiting on its GitHub delivery lifecycle. Resolve that state before closing or
          archiving.
        </p>
      )}
      {task.status === "awaiting-already-satisfied" && (
        <p className="notice">
          Review the candidate-bound evidence in the plan panel to close work already implemented.
        </p>
      )}
      {action && (
        <section className="policy-confirmation">
          <h3>
            Review {action} · {task.id}
          </h3>
          {action === "close" && (
            <>
              <label className="form-row">
                <span>Closure reason</span>
                <select value={reason} onChange={(event) => setReason(event.target.value as typeof reason)}>
                  <option value="not-needed">No longer needed</option>
                  <option value="superseded">Superseded</option>
                  <option value="duplicate">Duplicate</option>
                </select>
              </label>
              {reason === "superseded" && (
                <label className="form-row">
                  <span>Replacement task ID</span>
                  <input
                    value={replacement}
                    onChange={(event) => setReplacement(event.target.value)}
                    maxLength={80}
                  />
                </label>
              )}
            </>
          )}
          {action !== "cancel" && (
            <label className="form-row">
              <span>Note</span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={2000}
                rows={3}
              />
            </label>
          )}
          <div className="inline-controls">
            <button
              type="button"
              className="primary"
              disabled={
                busy ||
                !connected ||
                !allowed ||
                (action === "close" && reason === "superseded" && !replacement.trim())
              }
              onClick={() =>
                void command(
                  () =>
                    action === "cancel"
                      ? gateway.cancel(task.id)
                      : action === "archive"
                        ? gateway.archiveTask(task.id, note)
                        : gateway.closeTask(task.id, { reason, note, supersededBy: replacement }),
                  onDone,
                )
              }
            >
              {busy
                ? "Applying…"
                : action === "cancel"
                  ? "Confirm cancellation"
                  : action === "archive"
                    ? "Archive task"
                    : "Close task"}
            </button>
            <button type="button" disabled={busy} onClick={() => setAction(null)}>
              Keep task
            </button>
          </div>
        </section>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {task.archive && (
        <div className="repository-readiness">
          <h3>Archive record</h3>
          <p>
            Archived {new Date(task.archive.archivedAt).toLocaleString()} from {task.archive.previousStatus}.
          </p>
          <p>{task.archive.note}</p>
          <p className="quiet">
            {task.archive.removedWorktrees.length} worktrees removed · {task.archive.retainedWorktrees.length}{" "}
            retained
          </p>
          {task.archive.retainedWorktrees.map((path) => (
            <p className="repository-path" key={path}>
              {path}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
