import { Lightning, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { NewTaskDraft, RuntimeStatus } from "../domain";
import { initialNewTaskDraft, isValidNewTaskDraft, NewTaskFields } from "./NewTaskFields";
import { Button } from "./Primitives";

export function NewTaskDialog({
  open,
  defaultRepository,
  runtimeStatus,
  onClose,
  onStart,
  captureOnly = false,
  onCaptureDraft,
}: {
  open: boolean;
  defaultRepository: string;
  runtimeStatus: RuntimeStatus | null;
  onClose: () => void;
  onStart: (draft: NewTaskDraft) => Promise<void>;
  captureOnly?: boolean;
  onCaptureDraft?: (draft: NewTaskDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState<NewTaskDraft>(() => ({ ...initialNewTaskDraft, attachments: [] }));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const closeDialog = () => onClose();
  const submitLabel = captureOnly ? "Use draft for proposal" : "Start task";

  return (
    <dialog
      ref={dialogRef}
      className="new-task-dialog"
      onCancel={closeDialog}
      onClose={closeDialog}
      aria-labelledby="new-task-title"
    >
      <form
        method="dialog"
        onSubmit={async (event) => {
          event.preventDefault();
          setError(null);
          setPending(true);
          try {
            if (captureOnly) {
              if (!onCaptureDraft) throw new Error("A task draft capture handler is not configured.");
              await onCaptureDraft(draft);
            } else await onStart(draft);
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : "The task could not be prepared.");
          } finally {
            setPending(false);
          }
        }}
      >
        <header className="dialog-header">
          <div>
            <p className="eyebrow">{captureOnly ? "Governed action proposal" : "Deterministic workflow"}</p>
            <h2 id="new-task-title">New task</h2>
            <p>
              {captureOnly
                ? "Review the complete draft before it is attached to the companion proposal. Confirmation is still required before anything is sent."
                : "Give the work a scannable title and enough context for triage. The configured role policies are snapshotted so every agent run records its model and reasoning level."}
            </p>
          </div>
          <button type="button" className="icon-button" aria-label="Close new task" onClick={closeDialog}>
            <X size={18} />
          </button>
        </header>

        <NewTaskFields
          draft={draft}
          defaultRepository={defaultRepository}
          runtimeStatus={runtimeStatus}
          open={open}
          onChange={setDraft}
        />

        {error ? (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        ) : null}
        <footer className="dialog-footer">
          <div>
            <Button tone="ghost" type="button" onClick={closeDialog}>
              Cancel
            </Button>
            <Button
              tone="primary"
              icon={Lightning}
              type="submit"
              disabled={
                pending || !runtimeStatus?.authenticated || !isValidNewTaskDraft(draft, runtimeStatus)
              }
            >
              {pending ? (captureOnly ? "Capturing…" : "Creating…") : submitLabel}
            </Button>
          </div>
        </footer>
      </form>
    </dialog>
  );
}
