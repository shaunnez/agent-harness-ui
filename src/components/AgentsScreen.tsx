import { ArrowLeft, ArrowRight, Robot } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import {
  formatApproximateCost,
  formatCacheRate,
  formatTokenCount,
  type AgentRoleId,
  type RuntimeAgentPolicy,
  type RuntimeSettings,
  type RuntimeStatus,
  type RuntimeTask,
} from "../domain";
import { AgentPolicyEditor } from "./AgentPolicyEditor";
import { agentRoles, policyIdForRole, rolePolicy, type AgentRoleDefinition } from "./AgentRoles";
import { Metric, stageUsage } from "./LibraryShared";
import { Button, SectionHeader } from "./Primitives";

type RuntimePolicyInput = Pick<RuntimeSettings, "allowedModels" | "defaultModel" | "defaultReasoning" | "stagePolicies">;

export function AgentsScreen({
  runtimeTasks,
  runtimeStatus,
  selectedId,
  onSelect,
  onSave,
}: {
  runtimeTasks: RuntimeTask[];
  runtimeStatus: RuntimeStatus | null;
  selectedId: AgentRoleId | null;
  onSelect: (stageId: AgentRoleId | null) => void;
  onSave: (settings: RuntimePolicyInput) => Promise<RuntimeSettings>;
}) {
  const selected = agentRoles.find((stage) => stage.id === selectedId) ?? null;
  if (selected) {
    return <AgentDetail role={selected} runtimeTasks={runtimeTasks} runtimeStatus={runtimeStatus} onBack={() => onSelect(null)} onSave={onSave} />;
  }
  return (
    <div className="page library-page">
      <SectionHeader eyebrow="Execution roles" title="Agents" description="Each temporary role uses a policy snapshotted when a task is created. Candidate Repair is separate; Human Approval is deterministic." />
      <div className="truth-banner"><Robot size={20} /><span><strong>{runtimeStatus?.model ?? "Configured Codex model"} · {runtimeStatus?.reasoning ?? "unknown"} reasoning</strong><small>Current single-provider execution policy. Claude and local model execution are not wired into the harness.</small></span></div>
      <div className="agent-grid agent-grid--roles">
        {agentRoles.map((role) => {
          const usage = stageUsage(runtimeTasks, role.id);
          const deterministic = role.provider === "harness";
          const configuredPolicy = rolePolicy(runtimeStatus, role.id);
          return (
            <button className="agent-panel" type="button" key={role.id} onClick={() => onSelect(role.id)}>
              <div className="agent-panel__head"><span className={`agent-icon agent-icon--${deterministic ? "harness" : "codex"}`}><Robot size={22} /></span><span><strong>{role.label}</strong><small>{deterministic ? "Harness-owned gate" : "Ephemeral Codex agent run"}</small></span></div>
              <dl>
                <div><dt>Capability</dt><dd>{role.skill}</dd></div>
                <div><dt>Runtime</dt><dd>{deterministic ? "Local harness" : configuredPolicy?.model ?? "Codex (checking)"}</dd></div>
                <div><dt>Reasoning</dt><dd>{deterministic ? "Deterministic" : configuredPolicy?.reasoning ?? "Checking"}</dd></div>
                <div><dt>Observed usage</dt><dd>{usage.runs} runs · {formatTokenCount(usage.inputTokens)} in · {formatTokenCount(usage.outputTokens)} out</dd></div>
                <div><dt>Cache / cost</dt><dd>{formatCacheRate(usage)} cached · {usage.pricedRuns ? formatApproximateCost(usage.cost) : deterministic ? "$0.00" : "Unavailable"}</dd></div>
              </dl>
              <span className="agent-panel__open">Inspect role <ArrowRight size={15} /></span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AgentDetail({
  role,
  runtimeTasks,
  runtimeStatus,
  onBack,
  onSave,
}: {
  role: AgentRoleDefinition;
  runtimeTasks: RuntimeTask[];
  runtimeStatus: RuntimeStatus | null;
  onBack: () => void;
  onSave: (settings: RuntimePolicyInput) => Promise<RuntimeSettings>;
}) {
  const usage = stageUsage(runtimeTasks, role.id);
  const latestArtifact = [...usage.artifacts].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  const deterministic = role.provider === "harness";
  const configuredPolicy = rolePolicy(runtimeStatus, role.id);
  return (
    <div className="page library-page detail-page">
      <button type="button" className="detail-back" onClick={onBack}><ArrowLeft size={16} /> Back to Agents</button>
      <SectionHeader
        eyebrow="Execution role"
        title={`${role.label} agent`}
        description={deterministic ? "A deterministic human-owned gate with no model context." : `An ephemeral ${role.skill} run. Each artifact records its model, reasoning, usage, and supplied context.`}
      />
      <div className="detail-metrics detail-metrics--truthful">
        <Metric label="Default policy" value={configuredPolicy ? `${configuredPolicy.model} · ${configuredPolicy.reasoning}` : "Checking runtime"} />
        <Metric label="Recorded runs" value={String(usage.runs)} />
        <Metric label="Input / output" value={`${formatTokenCount(usage.inputTokens)} / ${formatTokenCount(usage.outputTokens)}`} />
        <Metric label="Cache rate" value={formatCacheRate(usage)} />
        <Metric label="Approx. cost" value={usage.pricedRuns ? formatApproximateCost(usage.cost) : deterministic ? "$0.00" : "Unavailable"} />
      </div>
      {deterministic ? <DeterministicPolicyNotice /> : <AgentPolicyPanel role={role} runtimeStatus={runtimeStatus} onSave={onSave} />}
      <div className="detail-grid">
        <section className="detail-panel agent-run-history">
          <header><span><h3>Recorded agent runs</h3><p>These are persisted stage artifacts, not a simulated success rate.</p></span></header>
          {usage.artifacts.length ? [...usage.artifacts].reverse().map((artifact) => (
            <article key={artifact.id} className="agent-run-row">
              <div><strong>{artifact.name}</strong><small>{new Date(artifact.createdAt).toLocaleString()} · {artifact.model ? `${artifact.model} · ${artifact.reasoning ?? "reasoning not recorded"}` : "harness-generated, no model call"}</small></div>
              <dl>
                <div><dt>Input</dt><dd>{formatTokenCount(artifact.usage.inputTokens)}</dd></div>
                <div><dt>Output</dt><dd>{formatTokenCount(artifact.usage.outputTokens)}</dd></div>
                <div><dt>Cached</dt><dd>{formatCacheRate(artifact.usage)} · {formatTokenCount(artifact.usage.cachedInputTokens)}</dd></div>
                <div><dt>Work credits</dt><dd>{artifact.usage.credits == null ? "—" : artifact.usage.credits.toFixed(3)}</dd></div>
                <div><dt>Approx. cost</dt><dd>{formatApproximateCost(artifact.usage.cost)}</dd></div>
              </dl>
            </article>
          )) : <p>No persisted runs for this role yet.</p>}
        </section>
        <aside className="detail-panel agent-context-panel">
          <h3>Context boundary</h3>
          {latestArtifact?.contextManifest ? (
            <>
              <p>{latestArtifact.contextManifest.policy}</p>
              <div className="agent-context-summary"><span>Rendered prompt</span><strong>~{formatTokenCount(latestArtifact.contextManifest.estimatedPromptTokens)} tokens</strong><small>{latestArtifact.contextManifest.promptCharacters.toLocaleString()} characters before CLI/runtime instructions</small></div>
              <ul>
                {latestArtifact.contextManifest.sources.map((source) => (
                  <li key={`${source.kind}-${source.id}`}><span><strong>{source.label}</strong><small>{source.kind}{source.stage ? ` · ${source.stage}` : ""}{source.truncated ? " · truncated" : ""}</small></span>{source.includedCharacters != null ? <code>{source.includedCharacters.toLocaleString()} chars</code> : <code>{latestArtifact.contextManifest?.repositoryAccess}</code>}</li>
                ))}
              </ul>
              <small>“Supplied” means placed in the prompt or made available through repository access. The runtime cannot prove which supplied text the model semantically relied on.</small>
            </>
          ) : (
            <p>{deterministic ? "No model context is sent for this gate." : "Older runs did not record a context manifest. New runs will show every supplied artifact and access boundary here."}</p>
          )}
        </aside>
      </div>
    </div>
  );
}

function AgentPolicyPanel({
  role,
  runtimeStatus,
  onSave,
}: {
  role: AgentRoleDefinition;
  runtimeStatus: RuntimeStatus | null;
  onSave: (settings: RuntimePolicyInput) => Promise<RuntimeSettings>;
}) {
  const settings = runtimeStatus?.settings;
  const globalDefault: RuntimeAgentPolicy | null = settings ? { model: settings.defaultModel, reasoning: settings.defaultReasoning } : null;
  const policyId = policyIdForRole(role.id);
  const initialPolicy = settings?.stagePolicies?.[policyId] ?? globalDefault;
  const [draft, setDraft] = useState<RuntimeAgentPolicy | null>(initialPolicy);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  useEffect(() => {
    setDraft(settings ? settings.stagePolicies?.[policyId] ?? { model: settings.defaultModel, reasoning: settings.defaultReasoning } : null);
  }, [policyId, settings]);
  const scoutsSharePolicy = role.id.startsWith("scout-");
  if (!settings || !globalDefault || !draft) {
    return <section className="detail-panel agent-policy-panel"><h3>Policy for new tasks</h3><p>Runtime settings are unavailable. Refresh the local companion before editing this role.</p></section>;
  }
  const save = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      await onSave({
        allowedModels: settings.allowedModels,
        defaultModel: settings.defaultModel,
        defaultReasoning: settings.defaultReasoning,
        stagePolicies: { ...settings.stagePolicies, [policyId]: draft },
      });
      setFeedback({ tone: "success", message: "Policy saved. It will be copied only when a new task is created." });
    } catch (error) {
      setFeedback({ tone: "error", message: error instanceof Error ? error.message : "The role policy could not be saved." });
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="detail-panel agent-policy-panel">
      <header>
        <span>
          <h3>Policy for new tasks</h3>
          <p>{scoutsSharePolicy ? "This individual scout edits the shared Repository scouts policy. Per-scout policies are not a backend capability." : "This role writes through the same runtime settings policy used by Settings."}</p>
        </span>
      </header>
      <div className="agent-policy-panel__body">
        <AgentPolicyEditor
          value={draft}
          globalDefault={globalDefault}
          models={runtimeStatus?.catalog?.models ?? []}
          allowedModels={settings.allowedModels}
          idPrefix={`agent-policy-${role.id}`}
          disabled={saving}
          onChange={(policy) => { setDraft(policy); setFeedback(null); }}
          onReset={() => { setDraft(globalDefault); setFeedback({ tone: "success", message: "Global default staged. Save policy to apply it to future tasks." }); }}
        />
        <div className="agent-policy-panel__actions">
          <Button type="button" tone="primary" disabled={saving || !settings.allowedModels.length} onClick={() => void save()}>{saving ? "Saving…" : "Save policy"}</Button>
          <small>Existing tasks keep their snapshotted model and reasoning policy.</small>
          {feedback ? <p className={`agent-policy-feedback agent-policy-feedback--${feedback.tone}`} role={feedback.tone === "error" ? "alert" : "status"}>{feedback.message}</p> : null}
        </div>
      </div>
    </section>
  );
}

function DeterministicPolicyNotice() {
  return (
    <section className="detail-panel agent-policy-panel agent-policy-panel--deterministic">
      <h3>Deterministic gate</h3>
      <p>Human Approval records a human merge decision against a candidate revision. It does not call a model, so model and reasoning controls do not apply.</p>
    </section>
  );
}
