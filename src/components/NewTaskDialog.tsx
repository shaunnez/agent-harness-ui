import { FolderOpen, Lightning, Paperclip, Trash, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { EXAMPLE_DESCRIPTION, EXAMPLE_TITLE, type NewTaskDraft, type RuntimeStatus } from "../domain";
import { Button } from "./Primitives";

const initialDraft: NewTaskDraft = {
  title: EXAMPLE_TITLE,
  description: EXAMPLE_DESCRIPTION,
  repositoryPath: "",
  workflow: "investigate",
  priority: "medium",
  attachments: [],
};

function readAttachment(file: File) {
  return new Promise<{ name: string; type: string; size: number; data: string }>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`${file.name} could not be read.`));
    reader.onload = () => resolve({ name: file.name, type: file.type || "application/octet-stream", size: file.size, data: String(reader.result).split(",")[1] ?? "" });
    reader.readAsDataURL(file);
  });
}

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
              Give the work a scannable title and enough context for triage. The configured role
              policies are snapshotted so every agent run records its model and reasoning level.
            </p>
          </div>
          <button type="button" className="icon-button" aria-label="Close new task" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <label className="field">
          <span>Task title <small className="wired-field">Creates persisted task</small></span>
          <input
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            autoFocus
          />
        </label>

        <label className="field">
          <span>Description <small className="wired-field">Sent to every stage</small></span>
          <textarea
            rows={5}
            value={draft.description}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
          />
        </label>

        <label className="field">
          <span>Local repository <small className="wired-field">Validated by backend</small></span>
          <span className="field-with-icon">
            <FolderOpen size={16} />
            <input
              value={draft.repositoryPath}
              onChange={(event) => setDraft({ ...draft, repositoryPath: event.target.value })}
              placeholder="C:\\path\\to\\repository"
              spellCheck={false}
            />
          </span>
          <small>
            Investigation is read-only. Approved implementation runs only in an isolated Git worktree.
          </small>
        </label>

        <fieldset className="segmented-field">
          <legend>Workflow <small className="wired-field">Controls stopping point</small></legend>
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
              <strong>Investigate + implement</strong>
              <small>Human-gated plan, worktree, review, tests, and merge</small>
            </span>
          </label>
        </fieldset>

        <label className="field dialog-priority-field">
          <span>Priority <small className="wired-field">Persisted and shown in task views</small></span>
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

        <div className="dialog-role-policy">
          <span>Agent policy <small className="wired-field">Snapshotted on creation</small></span>
          <div>
            {Object.entries(runtimeStatus?.settings?.stagePolicies ?? {}).map(([role, policy]) => (
              <span key={role}><strong>{role.replaceAll("-", " ")}</strong><code>{policy.model.replace("gpt-5.6-", "")} · {policy.reasoning}</code></span>
            ))}
          </div>
          <small>Change these defaults in Settings. Individual runs retain the exact policy they used.</small>
        </div>

        <div className="field attachment-field">
          <span>Reference artifacts <small className="wired-field">Available to stage agents</small></span>
          <label className="attachment-picker">
            <Paperclip size={17} />
            <span><strong>Attach HTML, images, or ZIP files</strong><small>Up to 6 files, 5 MB each and 6 MB total</small></span>
            <input
              type="file"
              multiple
              accept=".html,.htm,.png,.jpg,.jpeg,.webp,.gif,.zip,text/html,image/*,application/zip"
              onChange={async (event) => {
                setError(null);
                try {
                  const files = [...(event.target.files ?? [])];
                  if (files.length + (draft.attachments?.length ?? 0) > 6) throw new Error("Attach no more than six files.");
                  if (files.some((file) => file.size > 5_000_000)) throw new Error("Each attachment must be 5 MB or smaller.");
                  const next = [...(draft.attachments ?? []), ...(await Promise.all(files.map(readAttachment)))];
                  if (next.reduce((total, file) => total + file.size, 0) > 6_000_000) throw new Error("Attachments must total 6 MB or less.");
                  setDraft({ ...draft, attachments: next });
                } catch (reason) {
                  setError(reason instanceof Error ? reason.message : "The attachment could not be added.");
                } finally {
                  event.target.value = "";
                }
              }}
            />
          </label>
          {draft.attachments?.length ? (
            <ul className="attachment-list">
              {draft.attachments.map((attachment, index) => (
                <li key={`${attachment.name}-${attachment.size}-${attachment.data.slice(0, 16)}`}><span><strong>{attachment.name}</strong><small>{Math.ceil(attachment.size / 1024)} KB</small></span><button type="button" className="icon-button" aria-label={`Remove ${attachment.name}`} onClick={() => setDraft({ ...draft, attachments: draft.attachments?.filter((_, itemIndex) => itemIndex !== index) })}><Trash size={15} /></button></li>
              ))}
            </ul>
          ) : null}
        </div>

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
