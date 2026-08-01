import { FolderOpen, Lightning, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { EXAMPLE_DESCRIPTION, EXAMPLE_TITLE, type NewTaskDraft, type RuntimeStatus } from "../domain";
import { Button } from "./Primitives";

const initialDraft: NewTaskDraft = {
  title: EXAMPLE_TITLE,
  description: EXAMPLE_DESCRIPTION,
  repositoryPath: "",
  workflow: "investigate",
  priority: "medium",
};

export function NewTaskDialog({
  open,
  defaultRepository,
  runtimeStatus,
  onClose,
  onStart,
}: {
  open: boolean;
  defaultRepository: string;
  runtimeStatus: RuntimeStatus | null;
  onClose: () => void;
  onStart: (draft: NewTaskDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState(initialDraft);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (defaultRepository && !draft.repositoryPath) {
      setDraft((value) => ({ ...value, repositoryPath: defaultRepository }));
    }
  }, [defaultRepository, draft.repositoryPath]);

  return (
    <dialog
      ref={dialogRef}
      className="new-task-dialog"
      onCancel={onClose}
      onClose={onClose}
      aria-labelledby="new-task-title"
    >
      <form
        method="dialog"
        onSubmit={async (event) => {
          event.preventDefault();
          setError(null);
          setPending(true);
          try {
            await onStart(draft);
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : "The task could not be started.");
          } finally {
            setPending(false);
          }
        }}
      >
        <header className="dialog-header">
          <div>
            <p className="eyebrow">Deterministic workflow</p>
            <h2 id="new-task-title">New task</h2>
            <p>
              Give the work a scannable title and enough context for triage. This cut uses
              {` ${runtimeStatus?.model?.toUpperCase() ?? "GPT"}`} through your ChatGPT plan.
            </p>
          </div>
          <button type="button" className="icon-button" aria-label="Close new task" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <label className="field">
          <span>Task title</span>
          <input
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            autoFocus
          />
        </label>

        <label className="field">
          <span>Description</span>
          <textarea
            rows={5}
            value={draft.description}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
          />
        </label>

        <label className="field">
          <span>Local repository</span>
          <span className="field-with-icon">
            <FolderOpen size={16} />
            <input
              value={draft.repositoryPath}
              onChange={(event) => setDraft({ ...draft, repositoryPath: event.target.value })}
              placeholder="C:\\path\\to\\repository"
              spellCheck={false}
            />
          </span>
          <small>The first slice is read-only: agents may inspect this folder but cannot change it.</small>
        </label>

        <fieldset className="segmented-field">
          <legend>Workflow</legend>
          <label className={draft.workflow === "investigate" ? "selected" : ""}>
            <input
              type="radio"
              name="workflow"
              checked={draft.workflow === "investigate"}
              onChange={() => setDraft({ ...draft, workflow: "investigate" })}
            />
            <span>
              <strong>Investigate only</strong>
              <small>Evidence and specification, no patch</small>
            </span>
          </label>
          <label className={draft.workflow === "implement" ? "selected" : ""}>
            <input
              type="radio"
              name="workflow"
              checked={draft.workflow === "implement"}
              disabled
              onChange={() => setDraft({ ...draft, workflow: "implement" })}
            />
            <span>
              <strong>Investigate + Implement · next</strong>
              <small>Implementation stages remain a design preview</small>
            </span>
          </label>
        </fieldset>

        <label className="field dialog-priority-field">
          <span>Priority</span>
          <select
            value={draft.priority}
            onChange={(event) =>
              setDraft({ ...draft, priority: event.target.value as NewTaskDraft["priority"] })
            }
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>

        <footer className="dialog-footer">
          <span>
            <span
              className={`connection-dot ${runtimeStatus?.authenticated ? "" : "connection-dot--danger"}`}
            />
            {runtimeStatus?.authenticated
              ? `Codex connected with ${runtimeStatus.authMethod}`
              : "Local Codex login is required"}
          </span>
          <div>
            <Button tone="ghost" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button
              tone="primary"
              icon={Lightning}
              type="submit"
              disabled={
                pending ||
                !runtimeStatus?.authenticated ||
                !draft.title.trim() ||
                !draft.description.trim() ||
                !draft.repositoryPath.trim()
              }
            >
              {pending ? "Creating…" : "Start task"}
            </Button>
          </div>
        </footer>
        {error ? (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </dialog>
  );
}
