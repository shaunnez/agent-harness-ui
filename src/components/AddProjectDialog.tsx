import { FolderOpen, Plus, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createProject } from "../api";
import type { RuntimeProject } from "../domain";
import { Button } from "./Primitives";

export function AddProjectDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (project: RuntimeProject) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [repositoryPath, setRepositoryPath] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setName("");
      setRepositoryPath("");
      setError(null);
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return createPortal(
    <dialog
      ref={dialogRef}
      className="new-task-dialog add-project-dialog"
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      onClose={(event) => {
        event.stopPropagation();
        onClose();
      }}
      aria-labelledby="add-project-title"
    >
      <form
        method="dialog"
        onSubmit={async (event) => {
          event.preventDefault();
          setError(null);
          setPending(true);
          try {
            const project = await createProject({ name, repositoryPath });
            await onSaved(project);
            onClose();
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : "The project could not be added.");
          } finally {
            setPending(false);
          }
        }}
      >
        <header className="dialog-header">
          <div>
            <p className="eyebrow">Project registry</p>
            <h2 id="add-project-title">Add project</h2>
            <p>Give the local repository a clear name so it can be selected when creating tasks.</p>
          </div>
          <button type="button" className="icon-button" aria-label="Close add project" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <label className="field">
          <span>Project name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} autoFocus />
        </label>

        <label className="field">
          <span>
            Local repository path <small className="wired-field">Validated by backend</small>
          </span>
          <span className="field-with-icon">
            <FolderOpen size={16} />
            <input
              value={repositoryPath}
              onChange={(event) => setRepositoryPath(event.target.value)}
              placeholder="/absolute/path/to/repository"
              spellCheck={false}
            />
          </span>
        </label>

        {error ? (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        ) : null}

        <footer className="dialog-footer">
          <div>
            <Button tone="ghost" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button
              tone="primary"
              icon={Plus}
              type="submit"
              disabled={pending || !name.trim() || !repositoryPath.trim()}
            >
              {pending ? "Saving…" : "Add project"}
            </Button>
          </div>
        </footer>
      </form>
    </dialog>,
    document.body,
  );
}
