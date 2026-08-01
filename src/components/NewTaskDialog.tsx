import { Lightning, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { EXAMPLE_DESCRIPTION, EXAMPLE_TITLE, type NewTaskDraft } from "../domain";
import { Button } from "./Primitives";

const initialDraft: NewTaskDraft = {
  title: EXAMPLE_TITLE,
  description: EXAMPLE_DESCRIPTION,
  workflow: "implement",
  priority: "medium",
};

export function NewTaskDialog({
  open,
  onClose,
  onStart,
}: {
  open: boolean;
  onClose: () => void;
  onStart: (draft: NewTaskDraft) => void;
}) {
  const [draft, setDraft] = useState(initialDraft);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

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
        onSubmit={(event) => {
          event.preventDefault();
          onStart(draft);
        }}
      >
        <header className="dialog-header">
          <div>
            <p className="eyebrow">Deterministic workflow</p>
            <h2 id="new-task-title">New task</h2>
            <p>Give the work a scannable title and enough context for triage. Agents choose models later.</p>
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
              onChange={() => setDraft({ ...draft, workflow: "implement" })}
            />
            <span>
              <strong>Investigate + Implement</strong>
              <small>Run the full approval workflow</small>
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
            <span className="connection-dot" /> Model assignment is owned by each agent profile
          </span>
          <div>
            <Button tone="ghost" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button
              tone="primary"
              icon={Lightning}
              type="submit"
              disabled={!draft.title.trim() || !draft.description.trim()}
            >
              Start task
            </Button>
          </div>
        </footer>
      </form>
    </dialog>
  );
}
