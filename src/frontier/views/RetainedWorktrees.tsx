import { useEffect, useRef, useState } from "react";
import type { RuntimeWorktreeInventoryRow } from "../../domain";
import type { FrontierGateway, TaskSummary } from "../runtime/contracts";

export function RetainedWorktrees({
  tasks,
  gateway,
  connected,
  busy,
  error,
  command,
}: {
  tasks: TaskSummary[];
  gateway: FrontierGateway;
  connected: boolean;
  busy: boolean;
  error: string | null;
  command(action: () => Promise<unknown>, then?: () => void): Promise<void>;
}) {
  const [taskId, setTaskId] = useState(tasks[0]?.id ?? "");
  const [rows, setRows] = useState<RuntimeWorktreeInventoryRow[] | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [attempt, retry] = useState(0);
  const [review, setReview] = useState<RuntimeWorktreeInventoryRow | null>(null);
  const currentTask = useRef(taskId);
  currentTask.current = taskId;
  // biome-ignore lint/correctness/useExhaustiveDependencies: The refresh button advances the read epoch.
  useEffect(() => {
    let disposed = false;
    setRows(null);
    setReadError(null);
    setReview(null);
    if (!taskId) return;
    gateway
      .worktrees(taskId)
      .then((value) => {
        if (!disposed) setRows(value);
      })
      .catch((error) => {
        if (!disposed) setReadError(String(error));
      });
    return () => {
      disposed = true;
    };
  }, [gateway, taskId, attempt]);
  const selected = rows?.find((row) => row.id === review?.id);
  const removable =
    selected?.cleanupReady && !selected.retainedRequired && selected.lifecycleState !== "active";
  return (
    <>
      <h2>Retained worktrees</h2>
      <p>
        Temporary isolated Git copies belonging to one task. Required candidate and slice copies remain
        protected by the runtime.
      </p>
      <label className="field">
        Task
        <select value={taskId} onChange={(event) => setTaskId(event.target.value)}>
          {tasks.map((task) => (
            <option key={task.id} value={task.id}>
              {task.id} · {task.title}
            </option>
          ))}
        </select>
      </label>
      {readError && (
        <p role="alert" className="form-error">
          {readError}
        </p>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <button type="button" disabled={!connected || !taskId} onClick={() => retry(attempt + 1)}>
        Refresh inventory
      </button>
      {rows?.map((row) => (
        <div className="retained-copy" key={row.id}>
          <strong>
            {row.label} · {row.lifecycleState}
          </strong>
          <code>{row.worktreePath}</code>
          <small>
            {row.branch} · Head {row.gitHeadRevision?.slice(0, 12) ?? "Not recorded"} ·{" "}
            {row.gitClean === null ? "Cleanliness unknown" : row.gitClean ? "Clean" : "Uncommitted changes"}
          </small>
          <span>
            {row.retainedRequired
              ? "Required by retained task evidence"
              : row.cleanupReady
                ? "Eligible for cleanup"
                : "Retained; cleanup unavailable"}
          </span>
          {row.cleanupReady && !row.retainedRequired && row.lifecycleState !== "active" && (
            <button type="button" disabled={!connected || busy} onClick={() => setReview(row)}>
              Review removal
            </button>
          )}
        </div>
      ))}
      {!rows && !readError && taskId && <p>Loading task-owned copies…</p>}
      {rows?.length === 0 && <p>No retained worktree copies reported for this task.</p>}
      {!tasks.length && <p>No tasks registered.</p>}
      {review && (
        <section className="action-review">
          <h3>Remove this temporary copy?</h3>
          <p>
            {taskId} · {review.id}
          </p>
          <code>{review.worktreePath}</code>
          <p>
            The runtime rechecks eligibility and Git cleanliness before removing the copy. Retained task
            evidence stays available.
          </p>
          <button type="button" onClick={() => setReview(null)}>
            Keep copy
          </button>
          <button
            type="button"
            className="danger"
            disabled={!connected || busy || !removable}
            onClick={() =>
              void command(
                async () => {
                  const next = await gateway.removeWorktree(taskId, review.id);
                  if (currentTask.current === taskId) setRows(next);
                },
                () => setReview(null),
              )
            }
          >
            Remove temporary copy
          </button>
        </section>
      )}
    </>
  );
}
