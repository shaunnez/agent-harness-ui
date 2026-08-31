import { Paperclip, Plus, Trash } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { listProjects } from "../api";
import {
  EXAMPLE_DESCRIPTION,
  EXAMPLE_TITLE,
  type NewTaskDraft,
  type RuntimeProject,
  type RuntimeStatus,
} from "../domain";
import { AddProjectDialog } from "./AddProjectDialog";
import { RepositoryContractPanel } from "./RepositoryContractPanel";

export const initialNewTaskDraft: NewTaskDraft = {
  title: "",
  description: "",
  repositoryPath: "",
  workflow: "investigate",
  priority: "medium",
  designRequested: false,
  workflowProfile: "auto",
  experiment: null,
  attachments: [],
};

export interface NewTaskFieldsProps {
  draft: NewTaskDraft;
  defaultRepository: string;
  runtimeStatus: RuntimeStatus | null;
  open: boolean;
  onChange: (update: NewTaskDraft | ((current: NewTaskDraft) => NewTaskDraft)) => void;
}

export function isValidNewTaskDraft(draft: NewTaskDraft) {
  return Boolean(
    draft.title.trim() &&
      draft.description.trim() &&
      draft.repositoryPath.trim() &&
      (!draft.experiment ||
        (draft.experiment.groupId.trim() &&
          draft.experiment.variantId.trim() &&
          draft.experiment.frozenBaseSha.trim() &&
          draft.experiment.acceptanceCriteria.some((item) => item.trim()) &&
          draft.experiment.verificationCommands.some((item) => item.trim()))),
  );
}

export function NewTaskFields({
  draft,
  defaultRepository,
  runtimeStatus,
  open,
  onChange,
}: NewTaskFieldsProps) {
  const [projects, setProjects] = useState<RuntimeProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [addProjectOpen, setAddProjectOpen] = useState(false);
  const policyEntries = Object.entries(runtimeStatus?.settings?.stagePolicies ?? {});
  const policySummary = [
    ...policyEntries.reduce((groups, [, policy]) => {
      const label = `${formatModelName(policy.model)} ${formatReasoning(policy.reasoning)}`;
      groups.set(label, (groups.get(label) ?? 0) + 1);
      return groups;
    }, new Map<string, number>()),
  ]
    .map(([label, count]) => `${label} · ${count} role${count === 1 ? "" : "s"}`)
    .join("  /  ");

  const refreshProjects = useCallback(
    async (preferredRepositoryPath?: string) => {
      setProjectsLoading(true);
      setProjectsError(null);
      try {
        const nextProjects = await listProjects();
        setProjects(nextProjects);
        onChange((current) => {
          const preferredPath = preferredRepositoryPath ?? current.repositoryPath ?? defaultRepository;
          const selected =
            nextProjects.find((project) => project.repositoryPath === preferredPath) ?? nextProjects[0];
          return selected && selected.repositoryPath !== current.repositoryPath
            ? { ...current, repositoryPath: selected.repositoryPath }
            : current;
        });
        return nextProjects;
      } catch (reason) {
        setProjectsError(reason instanceof Error ? reason.message : "Projects could not be loaded.");
        throw reason;
      } finally {
        setProjectsLoading(false);
      }
    },
    [defaultRepository, onChange],
  );

  useEffect(() => {
    if (defaultRepository && !draft.repositoryPath) {
      onChange((value) => ({ ...value, repositoryPath: defaultRepository }));
    }
  }, [defaultRepository, draft.repositoryPath, onChange]);

  useEffect(() => {
    if (!open) return;
    void refreshProjects().catch(() => undefined);
  }, [open, refreshProjects]);

  const updateExperiment = (value: Partial<NonNullable<NewTaskDraft["experiment"]>>) => {
    onChange((current) =>
      current.experiment ? { ...current, experiment: { ...current.experiment, ...value } } : current,
    );
  };

  return (
    <>
      <label className="field">
        <span>
          Task title <small className="wired-field">Creates persisted task</small>
        </span>
        <input
          value={draft.title}
          onChange={(event) => onChange({ ...draft, title: event.target.value })}
          placeholder={EXAMPLE_TITLE}
        />
      </label>

      <label className="field">
        <span>
          Description <small className="wired-field">Sent to every stage</small>
        </span>
        <textarea
          rows={5}
          value={draft.description}
          onChange={(event) => onChange({ ...draft, description: event.target.value })}
          placeholder={EXAMPLE_DESCRIPTION}
        />
      </label>

      <div className="field project-field">
        <label htmlFor="new-task-project">
          Project <small className="wired-field">Local repository</small>
        </label>
        <span className="project-picker">
          <select
            id="new-task-project"
            value={draft.repositoryPath}
            onChange={(event) => onChange({ ...draft, repositoryPath: event.target.value })}
            disabled={projectsLoading}
            aria-label="Project"
          >
            {projectsLoading ? <option value="">Loading projects…</option> : null}
            {!projectsLoading && projects.length === 0 ? (
              <option value="">No projects added yet</option>
            ) : null}
            {projects.map((project) => (
              <option key={project.id} value={project.repositoryPath}>
                {project.name} — {project.repositoryPath}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="button project-picker__add"
            aria-label="Add project"
            title="Add project"
            onClick={() => setAddProjectOpen(true)}
          >
            <Plus size={16} weight="bold" />
          </button>
        </span>
        {projectsError ? <small className="project-field__error">{projectsError}</small> : null}
        <small>
          Investigation is read-only. Approved implementation runs only in an isolated Git worktree.
        </small>
      </div>

      <RepositoryContractPanel repositoryPath={open ? draft.repositoryPath : ""} />

      <fieldset className="segmented-field">
        <legend>
          Workflow <small className="wired-field">Controls stopping point</small>
        </legend>
        <label className={draft.workflow === "investigate" ? "selected" : ""}>
          <input
            type="radio"
            name="workflow"
            checked={draft.workflow === "investigate"}
            onChange={() => onChange({ ...draft, workflow: "investigate" })}
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
            onChange={() => onChange({ ...draft, workflow: "implement" })}
          />
          <span>
            <strong>Investigate + implement</strong>
            <small>Human-gated plan, worktree, review, tests, and merge</small>
          </span>
        </label>
      </fieldset>

      <label className="field dialog-priority-field">
        <span>
          Workflow profile <small className="wired-field">Deterministic and inspectable</small>
        </span>
        <select
          value={draft.workflowProfile ?? "auto"}
          onChange={(event) =>
            onChange({
              ...draft,
              workflowProfile: event.target.value as NewTaskDraft["workflowProfile"],
            })
          }
        >
          <option value="auto">Automatic — classify from scope and risk</option>
          <option value="fast">Fast — one narrow low-risk package</option>
          <option value="standard">Standard — normal single-candidate workflow</option>
          <option value="high-risk">High-risk — broad, schema, security, or concurrent work</option>
        </select>
        <small>
          Fast automatically escalates when repository evidence or verification exceeds its limits.
        </small>
      </label>

      <label className={`dialog-design-option ${draft.designRequested ? "selected" : ""}`}>
        <input
          type="checkbox"
          checked={draft.designRequested === true}
          onChange={(event) => onChange({ ...draft, designRequested: event.target.checked })}
        />
        <span>
          <strong>Generate two design prototypes</strong>
          <small>
            Run Claude Design and Codex Design after Grill, then pause for a human selection before Task Spec.
          </small>
        </span>
      </label>

      <label className="field dialog-priority-field">
        <span>
          Priority <small className="wired-field">Persisted and shown in task views</small>
        </span>
        <select
          value={draft.priority}
          onChange={(event) =>
            onChange({ ...draft, priority: event.target.value as NewTaskDraft["priority"] })
          }
        >
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </label>

      <details className="dialog-policy-summary">
        <summary>
          <span>
            <strong>Agent policy</strong>
            <small className="wired-field">Snapshotted on creation</small>
          </span>
          <span>{policySummary || "No editable model policy is available"}</span>
          <small>Show role details</small>
        </summary>
        <ul className="dialog-policy-details" aria-label="Agent role policy details">
          {policyEntries.map(([role, policy]) => (
            <li key={role}>
              <strong>{role.replaceAll("-", " ")}</strong>
              <code>
                {formatModelName(policy.model)} · {formatReasoning(policy.reasoning)}
              </code>
            </li>
          ))}
        </ul>
        <p>Change these defaults in Settings. Every run retains the exact policy it used.</p>
      </details>

      <div className="dialog-role-policy">
        <span>
          Controlled experiment <small className="wired-field">Optional frozen comparison</small>
        </span>
        <label>
          <input
            type="checkbox"
            checked={Boolean(draft.experiment)}
            onChange={(event) =>
              onChange({
                ...draft,
                experiment: event.target.checked
                  ? {
                      groupId: "",
                      variantId: "",
                      frozenBaseSha: "",
                      acceptanceCriteria: [],
                      verificationCommands: [],
                    }
                  : null,
              })
            }
          />
          <strong>Record this task as a controlled variant</strong>
        </label>
        <small>
          Experiment identity, the exact base, task-brief hash, role policies, acceptance criteria, and
          verification commands are snapshotted on creation.
        </small>
      </div>

      {draft.experiment ? (
        <fieldset className="segmented-field">
          <legend>
            Experiment definition <small className="wired-field">Persisted with task</small>
          </legend>
          <label className="field">
            <span>Group ID</span>
            <input
              value={draft.experiment.groupId}
              onChange={(event) => updateExperiment({ groupId: event.target.value })}
            />
          </label>
          <label className="field">
            <span>Variant ID</span>
            <input
              value={draft.experiment.variantId}
              onChange={(event) => updateExperiment({ variantId: event.target.value })}
            />
          </label>
          <label className="field">
            <span>Frozen base commit SHA</span>
            <input
              className="mono"
              spellCheck={false}
              value={draft.experiment.frozenBaseSha}
              onChange={(event) => updateExperiment({ frozenBaseSha: event.target.value })}
            />
          </label>
          <label className="field">
            <span>
              Acceptance criteria <small>One per line</small>
            </span>
            <textarea
              rows={3}
              value={draft.experiment.acceptanceCriteria.join("\n")}
              onChange={(event) =>
                updateExperiment({ acceptanceCriteria: event.target.value.split(/\r?\n/) })
              }
            />
          </label>
          <label className="field">
            <span>
              Verification commands <small>One per line</small>
            </span>
            <textarea
              rows={3}
              className="mono"
              spellCheck={false}
              value={draft.experiment.verificationCommands.join("\n")}
              onChange={(event) =>
                updateExperiment({ verificationCommands: event.target.value.split(/\r?\n/) })
              }
            />
          </label>
        </fieldset>
      ) : null}

      <AttachmentFields draft={draft} onChange={onChange} />

      <AddProjectDialog
        open={addProjectOpen}
        onClose={() => setAddProjectOpen(false)}
        onSaved={async (project) => {
          await refreshProjects(project.repositoryPath);
        }}
      />
    </>
  );
}

function AttachmentFields({ draft, onChange }: Pick<NewTaskFieldsProps, "draft" | "onChange">) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="field attachment-field">
      <span>
        Reference artifacts <small className="wired-field">Available to stage agents</small>
      </span>
      <label className="attachment-picker">
        <Paperclip size={17} />
        <span>
          <strong>Attach HTML, images, or ZIP files</strong>
          <small>Up to 6 files, 5 MB each and 6 MB total</small>
        </span>
        <input
          type="file"
          multiple
          accept=".html,.htm,.png,.jpg,.jpeg,.webp,.gif,.zip,text/html,image/*,application/zip"
          onChange={async (event) => {
            setError(null);
            try {
              const files = [...(event.target.files ?? [])];
              if (files.length + (draft.attachments?.length ?? 0) > 6)
                throw new Error("Attach no more than six files.");
              if (files.some((file) => file.size > 5_000_000))
                throw new Error("Each attachment must be 5 MB or smaller.");
              const next = [...(draft.attachments ?? []), ...(await Promise.all(files.map(readAttachment)))];
              if (next.reduce((total, file) => total + file.size, 0) > 6_000_000)
                throw new Error("Attachments must total 6 MB or less.");
              onChange({ ...draft, attachments: next });
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : "The attachment could not be added.");
            } finally {
              event.target.value = "";
            }
          }}
        />
      </label>
      {error ? <small className="project-field__error">{error}</small> : null}
      {draft.attachments?.length ? (
        <ul className="attachment-list">
          {draft.attachments.map((attachment, index) => (
            <li key={`${attachment.name}-${attachment.size}-${attachment.data.slice(0, 16)}`}>
              <span>
                <strong>{attachment.name}</strong>
                <small>{Math.ceil(attachment.size / 1024)} KB</small>
              </span>
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove ${attachment.name}`}
                onClick={() =>
                  onChange({
                    ...draft,
                    attachments: draft.attachments?.filter((_, itemIndex) => itemIndex !== index),
                  })
                }
              >
                <Trash size={15} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function readAttachment(file: File) {
  return new Promise<{ name: string; type: string; size: number; data: string }>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`${file.name} could not be read.`));
    reader.onload = () =>
      resolve({
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
        data: String(reader.result).split(",")[1] ?? "",
      });
    reader.readAsDataURL(file);
  });
}

function formatModelName(model: string) {
  const short = model.replace(/^gpt-5\.6-/, "");
  return short.charAt(0).toUpperCase() + short.slice(1);
}

function formatReasoning(reasoning: string) {
  if (reasoning.toLowerCase() === "xhigh") return "XHigh";
  return reasoning.charAt(0).toUpperCase() + reasoning.slice(1);
}
