import {
  ArrowCounterClockwise,
  CheckCircle,
  GearSix,
  GlobeHemisphereWest,
  ShieldCheck,
} from "@phosphor-icons/react";
import { useState } from "react";
import { providerRuntimeDefaults } from "../../../server/policy-defaults.mjs";
import type {
  RolePolicyId,
  RuntimeAgentPolicy,
  RuntimeSettings,
  RuntimeStatus,
  WorkflowProfileId,
} from "../../domain";
import { usePanelState } from "../app/panel-state";
import type { FrontierGateway } from "../runtime/contracts";
import { policyRoles, providerPolicyMatrix } from "../runtime/policies";
import { type SettingsInput, settingsInput, settingsIssue } from "../runtime/settings";
import { PolicyChoice, ProviderPresets } from "./PolicyMatrix";

export function ExecutionSettings(props: {
  status: RuntimeStatus | null;
  gateway: FrontierGateway;
  busy: boolean;
  connected: boolean;
  error: string | null;
  command(action: () => Promise<unknown>, then?: () => void): Promise<void>;
  onWorld(): void;
  onRefresh(): void;
}) {
  if (!props.status?.settings)
    return (
      <div className="overlay-body">
        <p>Execution settings have not been retrieved from the runtime.</p>
        <button type="button" onClick={props.onRefresh}>
          Refresh settings
        </button>
        <button type="button" onClick={props.onWorld}>
          Connection help
        </button>
      </div>
    );
  return <SettingsEditor {...props} status={props.status} settings={props.status.settings} />;
}
function SettingsEditor({
  status,
  settings,
  gateway,
  busy,
  connected,
  error,
  command,
  onWorld,
  onRefresh,
}: Parameters<typeof ExecutionSettings>[0] & { status: RuntimeStatus; settings: RuntimeSettings }) {
  const initial = settingsInput(settings);
  const [session, setSession] = usePanelState("settings-draft", {
    baseline: JSON.stringify(initial),
    draft: initial,
  });
  const [profile, setProfile] = usePanelState<WorkflowProfileId>("settings-profile", "standard");
  const [section, setSection] = useState("models");
  const [saved, setSaved] = useState(false);
  const { draft, baseline } = session;
  const incoming = JSON.stringify(initial);
  const changed = JSON.stringify(draft) !== baseline;
  const stale = incoming !== baseline;
  const issue = settingsIssue(draft, status);
  const editingStatus = { ...status, settings: { ...settings, ...draft } };
  const update = (value: SettingsInput) => {
    setSession({ baseline, draft: value });
    setSaved(false);
  };
  function setPolicy(role: RolePolicyId, policy: RuntimeAgentPolicy) {
    const matrices = {
      ...draft.profileStagePolicies,
      [profile]: { ...draft.profileStagePolicies[profile], [role]: policy },
    };
    update({ ...draft, stagePolicies: matrices.standard, profileStagePolicies: matrices });
  }
  function useProvider(provider: "codex" | "claude") {
    const roles = providerPolicyMatrix(provider, profile, editingStatus);
    if (!roles) return;
    const fallback = providerRuntimeDefaults(provider);
    const matrices = { ...draft.profileStagePolicies, [profile]: roles };
    update({
      ...draft,
      defaultModel: fallback.model,
      defaultReasoning: fallback.reasoning,
      stagePolicies: matrices.standard,
      profileStagePolicies: matrices,
    });
  }
  async function save() {
    if (issue || stale) return;
    let next = draft;
    await command(
      async () => {
        next = settingsInput(await gateway.saveSettings(draft));
      },
      () => {
        setSession({ baseline: JSON.stringify(next), draft: next });
        setSaved(true);
      },
    );
  }
  return (
    <div className="overlay-body execution-settings">
      <nav className="settings-nav" aria-label="Settings sections">
        <button
          type="button"
          className={section === "models" ? "selected" : ""}
          onClick={() => setSection("models")}
        >
          <GearSix size={19} />
          Models & workflow
        </button>
        <button
          type="button"
          className={section === "design" ? "selected" : ""}
          onClick={() => setSection("design")}
        >
          <ShieldCheck size={19} />
          Design generation
        </button>
        <button type="button" onClick={onWorld}>
          <GlobeHemisphereWest size={19} />
          World & connection
        </button>
      </nav>
      <div className="settings-editor">
        <header>
          <h2>Execution defaults</h2>
          <p>New tasks copy these settings. Existing task and run policies stay unchanged.</p>
        </header>
        {stale && (
          <p role="alert" className="form-error">
            Runtime defaults changed while this draft was open. Your edits are retained. Load the current
            settings before saving.
          </p>
        )}
        <div className="settings-editor-scroll">
          {section === "models" && (
            <>
              <section className="workflow-card">
                <h3>Models</h3>
                <small>
                  {status.catalog?.source ?? "Catalogue unavailable"}
                  {status.catalog?.fetchedAt
                    ? ` · ${new Date(status.catalog.fetchedAt).toLocaleString()}`
                    : " · No discovery timestamp"}
                </small>
                <div className="settings-model-columns">
                  <div>
                    <h4>Allowed models</h4>
                    {status.catalog?.models.map((model) => (
                      <label className="allowed-model" key={model.id}>
                        <input
                          type="checkbox"
                          checked={draft.allowedModels.includes(model.id)}
                          disabled={busy || (!model.editable && !draft.allowedModels.includes(model.id))}
                          onChange={(event) =>
                            update({
                              ...draft,
                              allowedModels: event.target.checked
                                ? [...draft.allowedModels, model.id]
                                : draft.allowedModels.filter((id) => id !== model.id),
                            })
                          }
                        />
                        <span>
                          {model.label}
                          <small>
                            {model.availability} · {model.provider ?? "Unsupported provider"}
                          </small>
                        </span>
                      </label>
                    ))}
                  </div>
                  <div>
                    <h4>Fallback policy</h4>
                    <div className="policy-selects">
                      <PolicyChoice
                        label="Default"
                        value={{ model: draft.defaultModel, reasoning: draft.defaultReasoning }}
                        status={editingStatus}
                        disabled={busy}
                        onChange={(value) =>
                          update({ ...draft, defaultModel: value.model, defaultReasoning: value.reasoning })
                        }
                      />
                    </div>
                    <p className="quiet">Explicit role policies below take precedence.</p>
                    <button type="button" disabled={busy} onClick={onRefresh}>
                      Refresh catalogue
                    </button>
                  </div>
                </div>
              </section>
              <section className="workflow-card">
                <div className="section-title">
                  <h3>Workflow role defaults</h3>
                  <ProviderPresets status={editingStatus} disabled={busy} onUseProvider={useProvider} />
                  <select
                    aria-label="Policy profile"
                    value={profile}
                    onChange={(event) => setProfile(event.target.value as WorkflowProfileId)}
                  >
                    <option value="fast">Fast</option>
                    <option value="standard">Standard</option>
                    <option value="high-risk">High risk</option>
                  </select>
                </div>
                <table className="policy-matrix">
                  <thead>
                    <tr>
                      <th>Role / skill</th>
                      <th>Model & reasoning</th>
                    </tr>
                  </thead>
                  <tbody>
                    {policyRoles.map((role) => (
                      <tr key={role.id}>
                        <th>
                          <strong>{role.label}</strong>
                          <small>{role.skill}</small>
                        </th>
                        <td>
                          <div className="policy-selects">
                            <PolicyChoice
                              label={`${profile} ${role.label}`}
                              value={
                                draft.profileStagePolicies?.[profile]?.[role.id] ?? {
                                  model: draft.defaultModel,
                                  reasoning: draft.defaultReasoning,
                                }
                              }
                              status={editingStatus}
                              disabled={busy}
                              onChange={(value) => setPolicy(role.id, value)}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
              <section className="workflow-card">
                <h3>Grill interaction</h3>
                <label className="setting-row">
                  <span>
                    <strong>Pause for my answers</strong>
                    <small>
                      Manual is the default. Each task also offers an explicit accept-remaining action.
                    </small>
                  </span>
                  <input
                    type="radio"
                    name="grill-policy"
                    checked={draft.grillPolicy === "manual"}
                    onChange={() => update({ ...draft, grillPolicy: "manual" })}
                  />
                </label>
                <label className="setting-row">
                  <span>
                    <strong>Automatically accept recommendations</strong>
                    <small>
                      Opt in for newly created tasks. The orchestrator records automation provenance.
                    </small>
                  </span>
                  <input
                    type="radio"
                    name="grill-policy"
                    checked={draft.grillPolicy === "auto-accept-recommendations"}
                    onChange={() => update({ ...draft, grillPolicy: "auto-accept-recommendations" })}
                  />
                </label>
              </section>
            </>
          )}
          {section === "design" && (
            <section className="workflow-card">
              <h3>Design generation policies</h3>
              <p>
                Each provider has its own policy, independent of ordinary task roles. Retries preserve the
                policy captured on the task.
              </p>
              {(["claude-design", "codex-design"] as const).map((id) => {
                const policy = draft.designPolicies[id];
                return (
                  <div className="design-policy-default" key={id}>
                    <h4>{id === "claude-design" ? "Claude Design" : "Codex Design"}</h4>
                    <div className="policy-selects">
                      <PolicyChoice
                        label={id}
                        provider={policy.provider}
                        value={{ model: policy.model, reasoning: policy.reasoning ?? "" }}
                        status={editingStatus}
                        disabled={busy}
                        onChange={(value) =>
                          update({
                            ...draft,
                            designPolicies: { ...draft.designPolicies, [id]: { ...policy, ...value } },
                          })
                        }
                      />
                    </div>
                    <small>
                      {status.providers?.find((provider) => provider.id === policy.provider)?.detail ??
                        "Provider execution status not recorded."}
                    </small>
                  </div>
                );
              })}
            </section>
          )}
        </div>
        <footer className="settings-save">
          <div>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            {issue && <p role="status">{issue}</p>}
            {saved ? (
              <p role="status">
                <CheckCircle size={18} /> Defaults saved for new tasks.
              </p>
            ) : (
              <small>{changed ? "Unsaved changes retained in this session" : "No unsaved changes"}</small>
            )}
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setSession({ baseline: incoming, draft: initial });
              setSaved(false);
            }}
          >
            <ArrowCounterClockwise size={18} />
            {stale ? "Load current settings" : "Revert changes"}
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy || !connected || !changed || stale || Boolean(issue)}
            onClick={() => void save()}
          >
            Save defaults
          </button>
        </footer>
      </div>
    </div>
  );
}
