import { ArrowRight, CheckCircle, Info, Plus } from "@phosphor-icons/react";
import { useLayoutEffect, useRef, useState } from "react";
import type { NewTaskDraft, RuntimeProject, RuntimeStatus } from "../../domain";
import { draftPolicies, draftProfile, providerPolicyMatrix } from "../runtime/policies";
import { PolicyChoice, PolicyMatrix } from "./PolicyMatrix";
import { TaskAttachments } from "./TaskAttachments";

export function NewTask({
  projects,
  draft,
  setDraft,
  status,
  error,
  busy,
  connected,
  onCreate,
  onClose,
  onAddProject,
}: {
  projects: RuntimeProject[];
  draft: NewTaskDraft;
  setDraft(value: NewTaskDraft): void;
  status: RuntimeStatus | null;
  error: string | null;
  busy: boolean;
  connected: boolean;
  onCreate(): void;
  onClose(): void;
  onAddProject(): void;
}) {
  const [step, setStep] = useState(0);
  const body = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (step >= 0) body.current?.scrollTo({ top: 0 });
  }, [step]);
  const project = projects.find((item) => item.repositoryPath === draft.repositoryPath && !item.archivedAt);
  const ready = Boolean(draft.title.trim() && draft.description.trim() && project);
  const profile = draftProfile(draft);
  const policies = status?.settings ? draftPolicies(draft, status.settings) : null;
  const designs = draft.designPolicies ?? status?.settings?.designPolicies;
  const savePolicy: Parameters<typeof PolicyMatrix>[0]["onChange"] = (role, policy) =>
    setDraft({ ...draft, rolePolicyOverrides: { ...draft.rolePolicyOverrides, [role]: policy } });
  const resetPolicy = (role: keyof NonNullable<NewTaskDraft["rolePolicyOverrides"]>) => {
    const overrides = { ...draft.rolePolicyOverrides };
    delete overrides[role];
    setDraft({ ...draft, rolePolicyOverrides: overrides });
  };
  const useProvider = (provider: "codex" | "claude") => {
    const matrix = providerPolicyMatrix(provider, profile.selected, status);
    if (matrix) setDraft({ ...draft, rolePolicyOverrides: matrix });
  };
  return (
    <>
      <nav className="form-progress wizard-progress" aria-label="Task setup steps">
        {["Brief", "Agent setup", "Review"].map((label, index) => (
          <button
            type="button"
            key={label}
            className={step === index ? "current" : ""}
            aria-current={step === index ? "step" : undefined}
            disabled={index > step && !ready}
            onClick={() => setStep(index)}
          >
            <span>{index + 1}</span>
            {label}
          </button>
        ))}
      </nav>
      <div ref={body} className={`overlay-body new-task-layout ${step === 1 ? "execution-layout" : ""}`}>
        <section className="form-surface">
          {step === 0 ? (
            <form
              id="new-task-brief"
              onSubmit={(event) => {
                event.preventDefault();
                if (ready) setStep(1);
              }}
            >
              <label className="form-row">
                <span>Project</span>
                <div className="inline-controls">
                  <select
                    required
                    aria-label="Project"
                    value={draft.repositoryPath}
                    onChange={(event) => setDraft({ ...draft, repositoryPath: event.target.value })}
                  >
                    <option value="">Choose a project</option>
                    {projects
                      .filter((item) => !item.archivedAt)
                      .map((item) => (
                        <option key={item.id} value={item.repositoryPath}>
                          {item.name}
                          {item.id.startsWith("suggested:") ? " (suggested)" : ""}
                        </option>
                      ))}
                  </select>
                  <button type="button" className="text-button" onClick={onAddProject}>
                    <Plus size={17} />
                    Add project
                  </button>
                </div>
              </label>
              <label className="form-row">
                <span>Task title</span>
                <input
                  required
                  maxLength={300}
                  value={draft.title}
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                  placeholder="Check drawing revision consistency"
                />
              </label>
              <label className="form-row">
                <span>Description</span>
                <textarea
                  required
                  rows={5}
                  maxLength={20_000}
                  value={draft.description}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                  placeholder="Describe the outcome, constraints and how you’ll judge success"
                />
              </label>
              <div className="form-row">
                <span>Attach files</span>
                <TaskAttachments
                  files={draft.attachments ?? []}
                  onChange={(attachments) => setDraft({ ...draft, attachments })}
                />
              </div>
              <label className="form-row">
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
              <div className="form-row">
                <span>Workflow</span>
                <div className="radio-options">
                  <label>
                    <input
                      type="radio"
                      name="workflow"
                      checked={draft.workflow === "investigate"}
                      onChange={() => setDraft({ ...draft, workflow: "investigate" })}
                    />
                    <span>
                      Investigate only<small>Gather findings and an approved specification.</small>
                    </span>
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="workflow"
                      checked={draft.workflow === "implement"}
                      onChange={() => setDraft({ ...draft, workflow: "implement" })}
                    />
                    <span>
                      Investigate + implement
                      <small>Implement approved changes, verify and deliver through GitHub.</small>
                    </span>
                  </label>
                </div>
              </div>
              <label className="form-row">
                <span>Risk profile</span>
                <div>
                  <select
                    aria-label="Risk profile"
                    value={draft.workflowProfile ?? "auto"}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        workflowProfile: event.target.value as NewTaskDraft["workflowProfile"],
                      })
                    }
                  >
                    <option value="auto">Auto</option>
                    <option value="fast">Fast</option>
                    <option value="standard">Standard</option>
                    <option value="high-risk">High risk</option>
                  </select>
                  <p className="quiet">
                    Resolved now: {profile.selected}. Repository evidence may escalate it.
                  </p>
                </div>
              </label>
              <div className="form-row">
                <span>Optional design</span>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={draft.designRequested ?? false}
                    onChange={(event) => setDraft({ ...draft, designRequested: event.target.checked })}
                  />
                  <span>
                    Generate designs before specification
                    <small>Review and select a design before continuing.</small>
                  </span>
                </label>
              </div>
            </form>
          ) : step === 1 ? (
            <>
              <div className="section-heading">
                <div>
                  <h2>Agent setup</h2>
                  <p className="quiet">{profile.selected} profile · overrides apply to this task only.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setDraft({ ...draft, rolePolicyOverrides: {}, designPolicies: undefined })}
                >
                  Use defaults
                </button>
              </div>
              {policies ? (
                <PolicyMatrix
                  policies={policies}
                  overrides={draft.rolePolicyOverrides}
                  status={status}
                  onChange={savePolicy}
                  onReset={resetPolicy}
                  onUseProvider={useProvider}
                />
              ) : (
                <p role="status">Waiting for the runtime’s role policies…</p>
              )}
              <p className="quiet">
                Scouts share one model policy. The runtime selects only the scout evidence the task needs.
                Repair remains a separate role.
              </p>
              {draft.designRequested && (
                <section className="design-policy-choices">
                  <h3>Design providers</h3>
                  <p className="quiet">
                    These selections are separate from workflow roles and are retained on every design
                    variant.
                  </p>
                  {designs ? (
                    (["codex-design", "claude-design"] as const).map((id) => (
                      <div className="design-policy-row" key={id}>
                        <strong>{id === "codex-design" ? "Codex Design" : "Claude Design"}</strong>
                        <PolicyChoice
                          label={id}
                          status={status}
                          value={{ model: designs[id].model, reasoning: designs[id].reasoning ?? "" }}
                          provider={designs[id].provider}
                          onChange={(value) =>
                            setDraft({
                              ...draft,
                              designPolicies: { ...designs, [id]: { ...designs[id], ...value } },
                            })
                          }
                        />
                      </div>
                    ))
                  ) : (
                    <p>Design policies are unavailable.</p>
                  )}
                </section>
              )}
            </>
          ) : (
            <div className="draft-review">
              <h2>{draft.title}</h2>
              <p className="preserve-lines">{draft.description}</p>
              <dl>
                <dt>Repository</dt>
                <dd>{draft.repositoryPath}</dd>
                <dt>Workflow / priority</dt>
                <dd>
                  {draft.workflow === "implement" ? "Investigate + implement" : "Investigate only"} ·{" "}
                  {draft.priority}
                </dd>
                <dt>Risk profile</dt>
                <dd>
                  {profile.selected} · {profile.reason}
                </dd>
                <dt>Attachments</dt>
                <dd>{draft.attachments?.map((file) => file.name).join(", ") || "None"}</dd>
              </dl>
              <h3>Execution snapshot</h3>
              {policies && (
                <PolicyMatrix
                  policies={policies}
                  overrides={draft.rolePolicyOverrides}
                  status={status}
                  readOnly
                  onChange={savePolicy}
                  onReset={resetPolicy}
                />
              )}
              {draft.designRequested && (
                <p>
                  Design step requested ·{" "}
                  {Object.values(designs ?? {})
                    .map((policy) => `${policy.provider}: ${policy.model} / ${policy.reasoning}`)
                    .join(" · ")}
                </p>
              )}
            </div>
          )}
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
        </section>
        <aside className="mission-briefing">
          <h2>Mission briefing</h2>
          <div className="briefing-project">
            <img src="/assets/mf.ui.project-thumbnail.png" alt="Project base platform" />
            <div>
              <small>Project</small>
              <strong>{project?.name ?? "Choose a project"}</strong>
              <small>Repository</small>
              <span>{project?.repositoryPath.split("/").at(-1) ?? "Not selected"}</span>
            </div>
          </div>
          <h3>Planned workflow</h3>
          <ul className="workflow-checklist">
            {[
              "Gather repository evidence",
              "Resolve questions with you",
              ...(draft.designRequested ? ["Select a generated design"] : []),
              "Approve a specification",
              ...(draft.workflow === "implement"
                ? ["Approve the implementation plan", "Build, review and test", "Approve & raise PR"]
                : []),
            ].map((item) => (
              <li key={item}>
                <CheckCircle size={20} />
                {item}
              </li>
            ))}
          </ul>
          <p className="quiet">
            {draft.workflow === "implement"
              ? "Completion follows the exact approved PR’s merge. Each gate retains its evidence."
              : "Stops after specification approval. No implementation or code changes."}
          </p>
          <p className="notice">
            <Info size={20} />
            Draft only — no agents have started.
          </p>
          <p className="quiet">
            Creating saves the brief and policies. You’ll dispatch the task from its command panel.
          </p>
        </aside>
      </div>
      <footer className="overlay-footer">
        <button type="button" onClick={step ? () => setStep(step - 1) : onClose}>
          {step ? "Back" : "Cancel"}
        </button>
        <button
          type={step === 0 ? "submit" : "button"}
          form={step === 0 ? "new-task-brief" : undefined}
          disabled={!ready || busy || !connected || (step > 0 && !policies)}
          className="primary"
          onClick={step === 2 ? onCreate : step === 1 ? () => setStep(2) : undefined}
        >
          {busy ? "Creating…" : step === 2 ? "Create task" : step === 1 ? "Review task" : "Next: agent setup"}
          <ArrowRight size={19} />
        </button>
      </footer>
    </>
  );
}
