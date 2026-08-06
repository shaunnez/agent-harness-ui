import { MagnifyingGlass, WarningCircle } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type {
  RuntimeAgentPolicy,
  RuntimeEvaluationSummary,
  RuntimeSettings,
  RuntimeStatus,
} from "../domain";
import { AgentPolicyEditor } from "./AgentPolicyEditor";
import { agentRoles } from "./AgentRoles";
import { EvaluationScorecard } from "./EvaluationScorecard";
import { SettingRow } from "./LibraryShared";
import { Button, SectionHeader } from "./Primitives";
import { connectionStateLabel, providerConnectionState } from "./Shell";

type RuntimePolicyInput = Pick<RuntimeSettings, "allowedModels" | "defaultModel" | "defaultReasoning" | "stagePolicies">;

export function SettingsScreen({
  runtimeStatus,
  evaluationSummary,
  onRefresh,
  onSave,
  onVerifyPricing,
  refreshing,
}: {
  runtimeStatus: RuntimeStatus | null;
  evaluationSummary: RuntimeEvaluationSummary | null;
  onRefresh: () => Promise<void>;
  onSave: (settings: RuntimePolicyInput) => Promise<RuntimeSettings>;
  onVerifyPricing: () => Promise<void>;
  refreshing: boolean;
}) {
  const claude = runtimeStatus?.providers?.find((provider) => provider.id === "claude");
  // Mirrors the fallback Shell.tsx builds when the server has not reported a `providers`
  // array (an older status shape) — without it this row would silently disappear instead
  // of degrading to the same generic reading the sidebar falls back to.
  const codex = runtimeStatus?.providers?.find((provider) => provider.id === "codex") ??
    (runtimeStatus
      ? {
          available: Boolean(runtimeStatus.available),
          authenticated: Boolean(runtimeStatus.authenticated),
          executionEnabled: true,
          detail: runtimeStatus.message,
        }
      : undefined);
  const [allowedModels, setAllowedModels] = useState<string[]>([]);
  const [defaultModel, setDefaultModel] = useState("");
  const [defaultReasoning, setDefaultReasoning] = useState("");
  const [stagePolicies, setStagePolicies] = useState<Record<string, RuntimeAgentPolicy>>({});
  const [saving, setSaving] = useState(false);
  const [verifyingPricing, setVerifyingPricing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  useEffect(() => {
    const settings = runtimeStatus?.settings;
    if (!settings) return;
    setAllowedModels(settings.allowedModels);
    setDefaultModel(settings.defaultModel);
    setDefaultReasoning(settings.defaultReasoning);
    setStagePolicies(settings.stagePolicies ?? {});
  }, [runtimeStatus?.settings]);
  const catalog = runtimeStatus?.catalog?.models ?? [];
  const globalDefault = { model: defaultModel, reasoning: defaultReasoning };
  const save = async () => {
    setError(null);
    setSaveMessage(null);
    setSaving(true);
    try {
      await onSave({ allowedModels, defaultModel, defaultReasoning, stagePolicies });
      setSaveMessage("Model policy saved. New tasks will use these defaults; existing task snapshots are unchanged.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Settings could not be saved.");
    } finally {
      setSaving(false);
    }
  };
  const updateDefault = (policy: RuntimeAgentPolicy) => {
    setDefaultModel(policy.model);
    setDefaultReasoning(policy.reasoning);
    setSaveMessage(null);
  };
  return (
    <div className="page library-page settings-page">
      <SectionHeader eyebrow="Local orchestration" title="Settings" description="Choose the model allowlist and defaults used for new tasks. Each task snapshots its model and reasoning level so later settings changes do not rewrite history." action={<Button tone="secondary" icon={MagnifyingGlass} onClick={() => void onRefresh()} disabled={refreshing}>{refreshing ? "Searching…" : "Search available models"}</Button>} />
      <section className="settings-section">
        <h3>Allowed models</h3>
        <p className="settings-section__intro">Entries identify whether they were discovered locally, retained from configuration, or supplied only as unsupported bundled reference metadata{runtimeStatus?.catalog?.fetchedAt ? ` · refreshed ${new Date(runtimeStatus.catalog.fetchedAt).toLocaleString()}` : ""}. Only discovered models are editable.</p>
        <div className="model-allowlist">
          {catalog.map((model) => {
            const allowed = allowedModels.includes(model.id);
            const inUse = Object.values(stagePolicies).some((policy) => policy.model === model.id);
            return (
              <label className={allowed ? "model-option model-option--allowed" : "model-option"} key={model.id}>
                <input
                  type="checkbox"
                  checked={allowed}
                  disabled={!model.editable || (allowed && inUse)}
                  title={!model.editable ? "This model was not discovered as an editable local capability." : allowed && inUse ? "Move every role away from this model before removing it." : undefined}
                  onChange={(event) => {
                    const next = event.target.checked
                      ? [...new Set([...allowedModels, model.id])]
                      : allowedModels.filter((id) => id !== model.id);
                    setAllowedModels(next);
                    setSaveMessage(null);
                    if (!next.includes(defaultModel) && next[0]) {
                      const fallback = catalog.find((item) => item.id === next[0]);
                      setDefaultModel(next[0]);
                      setDefaultReasoning(fallback?.defaultReasoning ?? "medium");
                    }
                  }}
                />
                <span><strong>{model.label}</strong><small>{model.description} · {model.provenance.replace("-", " ")} · {model.availability}</small></span>
                <code>{model.id}</code>
              </label>
            );
          })}
        </div>
        <div className="settings-default-grid">
          <AgentPolicyEditor
            value={globalDefault}
            models={catalog}
            allowedModels={allowedModels}
            idPrefix="settings-default"
            disabled={saving}
            onChange={updateDefault}
          />
          <Button type="button" tone="primary" disabled={saving || !allowedModels.length || !defaultModel || !defaultReasoning} onClick={() => void save()}>{saving ? "Saving…" : "Save model policy"}</Button>
        </div>
        <fieldset className="role-policy-grid">
          <legend>Role policy overrides</legend>
          <p>All role editors share the same controls as each Agent detail. Scout detail pages intentionally edit this single Repository scouts policy.</p>
          {agentRoles.filter((role) => role.provider === "codex" && !role.id.startsWith("scout-")).map((role) => {
            const policy = stagePolicies[role.id] ?? globalDefault;
            return (
              <div className="role-policy-row" key={role.id}>
                <span><strong>{role.label}</strong><small>{role.skill}</small></span>
                <AgentPolicyEditor
                  value={policy}
                  globalDefault={globalDefault}
                  models={catalog}
                  allowedModels={allowedModels}
                  idPrefix={`settings-role-${role.id}`}
                  disabled={saving}
                  onChange={(nextPolicy) => { setStagePolicies((current) => ({ ...current, [role.id]: nextPolicy })); setSaveMessage(null); }}
                  onReset={() => { setStagePolicies((current) => ({ ...current, [role.id]: globalDefault })); setSaveMessage(null); }}
                />
              </div>
            );
          })}
        </fieldset>
        {saveMessage ? <p className="agent-policy-feedback agent-policy-feedback--success" role="status">{saveMessage}</p> : null}
        {error ? <p className="dialog-error" role="alert">{error}</p> : null}
      </section>
      <section className="settings-section">
        <h3>Runtime connection</h3>
        <SettingRow
          title="Codex"
          copy="No API key is read or stored"
          control={
            <span className={`connection-state connection-state--${providerConnectionState(codex)}`}>
              {connectionStateLabel(providerConnectionState(codex))}
            </span>
          }
        />
        <SettingRow
          title="Claude"
          copy={claude?.detail ?? "Discovery runs when the local companion status is refreshed"}
          control={
            <span className={`connection-state connection-state--${providerConnectionState(claude)}`}>
              {connectionStateLabel(providerConnectionState(claude))}
            </span>
          }
        />
      </section>
      <section className="settings-section">
        <div className="settings-section__head"><span><h3>Approximate cost rate card</h3><p>Standard short-context API prices per 1M tokens. Calculated task costs are comparison estimates; ChatGPT-plan charges are not exposed.</p></span><Button tone="secondary" disabled={verifyingPricing || !runtimeStatus?.authenticated} onClick={async () => { setError(null); setVerifyingPricing(true); try { await onVerifyPricing(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Pricing could not be verified."); } finally { setVerifyingPricing(false); } }}>{verifyingPricing ? "Agent checking…" : "Verify with agent"}</Button></div>
        <div className="pricing-table">
          <div className="pricing-table__header"><span>Model</span><span>Input</span><span>Cached input</span><span>Cache write</span><span>Output</span></div>
          {catalog.filter((model) => allowedModels.includes(model.id)).map((model) => {
            const rate = runtimeStatus?.settings?.pricing?.rates?.[model.id]?.short ?? model.pricing?.short;
            return <div className="pricing-table__row" key={model.id}><strong>{model.label}</strong><code>{rate ? `$${rate.input}` : "—"}</code><code>{rate ? `$${rate.cachedInput}` : "—"}</code><code>{rate?.cacheWrite == null ? "—" : `$${rate.cacheWrite}`}</code><code>{rate ? `$${rate.output}` : "—"}</code></div>;
          })}
        </div>
        <small className="settings-pricing-source">{runtimeStatus?.settings?.pricing ? `Version ${runtimeStatus.settings.pricing.version} · ${runtimeStatus.settings.pricing.verifiedBy} · ${new Date(runtimeStatus.settings.pricing.verifiedAt).toLocaleString()}` : "Pricing metadata unavailable"}</small>
        {runtimeStatus?.settings?.pricing.creditRates ? (
          <>
            <div className="settings-section__head settings-section__head--nested"><span><h3>ChatGPT work credits</h3><p>Current Codex credit units per 1M tokens. Credits measure plan usage; they are not dollars.</p></span></div>
            <div className="pricing-table pricing-table--credits">
              <div className="pricing-table__header"><span>Model</span><span>Input</span><span>Cached input</span><span>Output</span></div>
              {catalog.filter((model) => allowedModels.includes(model.id) && runtimeStatus.settings?.pricing.creditRates?.[model.id]).map((model) => { const rate = runtimeStatus.settings?.pricing.creditRates?.[model.id]; return <div className="pricing-table__row" key={model.id}><strong>{model.label}</strong><code>{rate?.input}</code><code>{rate?.cachedInput}</code><code>{rate?.output}</code></div>; })}
            </div>
            <small className="settings-pricing-source">Source: {runtimeStatus.settings.pricing.creditSourceUrl ?? "OpenAI ChatGPT pricing"}</small>
          </>
        ) : null}
      </section>
      <section className="settings-section">
        <EvaluationScorecard summary={evaluationSummary} />
        <p className="settings-section__intro">Recommended experiment: run the same small, medium, and high-risk task suite against Luna XHigh, Luna Max, and Sol High; blind-score the final patch, then compare gate pass rate, repair count, wall time, cache rate, credits, and API-equivalent cost.</p>
      </section>
      <section className="settings-section">
        <h3>Local environment</h3>
        <SettingRow title="Repository root" copy="Default for new tasks; AGENT_HARNESS_REPOSITORY may override it" control={<code>{runtimeStatus?.suggestedRepository ?? "Checking…"}</code>} />
        <SettingRow title="Codex binary" copy="Discovered by the local companion" control={<code>{runtimeStatus?.binary ?? "Not found"}</code>} />
        <SettingRow title="Worktree policy" copy="Implement and Repair write only inside isolated candidate worktrees" control={<strong>Enforced by backend</strong>} />
      </section>
      <div className="settings-note"><WarningCircle size={18} /><p>The estimate subtracts cached input from ordinary input, applies the cached-input rate, and prices output separately. Cache-write tokens are included only when the CLI reports them.</p></div>
    </div>
  );
}
