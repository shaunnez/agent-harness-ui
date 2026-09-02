import type { NewTaskDraft, RuntimeStatus } from "../domain";
import { DesignPolicyEditor } from "./DesignPolicyEditor";

export function NewTaskDesignFields({
  draft,
  runtimeStatus,
  onChange,
}: {
  draft: NewTaskDraft;
  runtimeStatus: RuntimeStatus | null;
  onChange: (update: NewTaskDraft | ((current: NewTaskDraft) => NewTaskDraft)) => void;
}) {
  const policies = draft.designPolicies;
  const catalog = runtimeStatus?.catalog;
  const settings = runtimeStatus?.settings;

  return (
    <section className={`dialog-design-option ${draft.designRequested ? "selected" : ""}`}>
      <label>
        <input
          type="checkbox"
          checked={draft.designRequested === true}
          onChange={(event) =>
            onChange({
              ...draft,
              designRequested: event.target.checked,
              designPolicies:
                event.target.checked && !policies ? structuredClone(settings?.designPolicies) : policies,
            })
          }
        />
        <span>
          <strong>Generate two design prototypes</strong>
          <small>
            Run Claude Design and Codex Design after Grill, then pause for a human selection before Task Spec.
          </small>
        </span>
      </label>
      {draft.designRequested && policies && catalog && settings ? (
        <div className="dialog-design-policies">
          <DesignPolicyEditor
            label="Claude Design"
            provider="claude"
            value={policies["claude-design"]}
            models={catalog.models}
            allowedModels={settings.allowedModels}
            idPrefix="new-task-claude-design"
            onChange={(policy) =>
              onChange({ ...draft, designPolicies: { ...policies, "claude-design": policy } })
            }
          />
          <DesignPolicyEditor
            label="Codex Design"
            provider="codex"
            value={policies["codex-design"]}
            models={catalog.models}
            allowedModels={settings.allowedModels}
            idPrefix="new-task-codex-design"
            onChange={(policy) =>
              onChange({ ...draft, designPolicies: { ...policies, "codex-design": policy } })
            }
          />
          <small>These exact selections are snapshotted on creation and reused for retries.</small>
        </div>
      ) : null}
    </section>
  );
}
