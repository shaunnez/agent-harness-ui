import {
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  Code,
  MagnifyingGlass,
  Robot,
  SlidersHorizontal,
  WarningCircle,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import promptRuntimeSource from "../../server/prompts.mjs?raw";
import {
  formatApproximateCost,
  formatCacheRate,
  formatTokenCount,
  type AgentRoleId,
  type RuntimeEvaluationSummary,
  type RuntimeAgentPolicy,
  type RuntimeSettings,
  type RuntimeStatus,
  type RuntimeTask,
  scoutRoleIds,
  type StageId,
  workflowStages,
} from "../domain";
import { Button, SectionHeader } from "./Primitives";
import { TaskTable } from "./TaskTable";

export function TasksScreen({
  onOpenTask,
  runtimeTasks,
}: {
  onOpenTask: (taskId: string) => void;
  runtimeTasks: RuntimeTask[];
}) {
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [status, setStatus] = useState("open");
  const [stage, setStage] = useState("all");
  const [priority, setPriority] = useState("all");
  const tasks = useMemo(
    () =>
      [...runtimeTasks]
        .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
        .filter((task) => {
          const haystack = [
            task.id,
            task.title,
            task.description,
            task.status,
            task.currentStage,
            task.priority,
            task.repositoryPath,
            ...task.models.map((model) => model.model),
            ...task.artifacts.map((artifact) => artifact.name),
          ]
            .join(" ")
            .toLowerCase();
          const statusMatches =
            status === "all" ||
            (status === "open" && task.status !== "closed") ||
            (status === "attention"
              ? ["failed", "blocked", "cancelled", "repair-required"].includes(task.status)
              : status === "waiting"
                ? task.status.startsWith("awaiting-") || task.status.startsWith("ready-for-")
                : task.status === status);
          return (
            haystack.includes(query.trim().toLowerCase()) &&
            statusMatches &&
            (stage === "all" || task.currentStage === stage) &&
            (priority === "all" || task.priority === priority)
          );
        }),
    [priority, query, runtimeTasks, stage, status],
  );
  const hasFilters = Boolean(query.trim()) || !["all", "open"].includes(status) || stage !== "all" || priority !== "all";

  return (
    <div className="page library-page">
      <SectionHeader
        eyebrow="Agent Harness"
        title="Tasks"
        description="Every persisted task, its current gate, dates, real token usage, cache rate, and approximate API-rate cost."
        action={
          <Button tone={filtersOpen || hasFilters ? "primary" : "secondary"} icon={SlidersHorizontal} onClick={() => setFiltersOpen((value) => !value)}>
            Filters{hasFilters ? " active" : ""}
          </Button>
        }
      />
      <div className="toolbar">
        <MagnifyingGlass size={18} />
        <input
          aria-label="Search tasks"
          placeholder="Search tasks, IDs, models, repositories, or artifacts…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span>{tasks.length} of {runtimeTasks.length} tasks</span>
      </div>
      {filtersOpen ? (
        <div className="task-filters">
          <label>Status<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="open">Open tasks</option><option value="all">All statuses</option><option value="attention">Needs attention</option><option value="waiting">Waiting for action</option><option value="running">Running</option><option value="completed">Completed</option><option value="closed">Closed</option></select></label>
          <label>Stage<select value={stage} onChange={(event) => setStage(event.target.value)}><option value="all">All stages</option>{workflowStages.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label>Priority<select value={priority} onChange={(event) => setPriority(event.target.value)}><option value="all">All priorities</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
          <Button tone="ghost" onClick={() => { setQuery(""); setStatus("open"); setStage("all"); setPriority("all"); }} disabled={!hasFilters}>Clear filters</Button>
        </div>
      ) : null}
      <TaskTable
        tasks={tasks}
        onOpenTask={onOpenTask}
        emptyTitle={hasFilters ? "No tasks match these filters" : "No local tasks yet"}
        emptyCopy={hasFilters ? "Clear one or more filters to broaden the result." : "Create a task to begin a real Evidence Gate workflow."}
      />
    </div>
  );
}

const skillContracts: Record<StageId, { input: string; output: string }> = {
  triage: { input: "Task title, description, workflow, priority, and repository", output: "triage.md with verdict, verified facts, scope, risks, and route" },
  scouts: { input: "Task plus repository and retained triage evidence", output: "repository-scout.md with architecture, files, tests, constraints, and seams" },
  grill: { input: "Repository facts and consequential unresolved product decisions", output: "decision-brief.md plus structured Grill questions and recorded decisions" },
  specification: { input: "Approved evidence and authoritative recorded decisions", output: "task-specification.md with scope, acceptance criteria, tests, and notes" },
  plan: { input: "Approved specification", output: "implementation-plan.md plus dependency-ordered work-package manifest" },
  implement: { input: "Approved spec and plan in an isolated candidate worktree", output: "Committed candidate revision and implementation-candidate.md" },
  "dev-review": { input: "Exact candidate revision plus approved specification and plan", output: "development-review.md with PASS/REPAIR and P0–P3 findings" },
  test: { input: "Exact reviewed candidate revision", output: "test-evidence.md plus candidate-bound focused-test result rows" },
  "final-review": { input: "Exact tested candidate and every retained stage artifact", output: "final-review.md with holdout verdict and human approval brief" },
  approval: { input: "Exact candidate revision and fresh review/test/final gates", output: "Human approval record and fast-forward merge" },
};

function sourceExcerpt(stageId: StageId) {
  const key = stageId.includes("-") ? `"${stageId}"` : stageId;
  const start = promptRuntimeSource.indexOf(`  ${key}: {`);
  if (start < 0) return "This is a deterministic harness stage and has no model prompt definition.";
  const end = promptRuntimeSource.indexOf("\n  },", start);
  return promptRuntimeSource.slice(start, end < 0 ? start + 1_600 : end + 5).trim();
}

function stageUsage(tasks: RuntimeTask[], stageId: AgentRoleId) {
  const artifacts = tasks
    .flatMap((task) => task.artifacts)
    .filter((artifact) => (artifact.agentRole ?? artifact.stage) === stageId);
  const usage = artifacts.reduce(
    (total, artifact) => ({
      inputTokens: total.inputTokens + artifact.usage.inputTokens,
      cachedInputTokens: total.cachedInputTokens + artifact.usage.cachedInputTokens,
      outputTokens: total.outputTokens + artifact.usage.outputTokens,
      totalTokens: total.totalTokens + artifact.usage.totalTokens,
      cost: total.cost + (artifact.usage.cost ?? 0),
    }),
    { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0 },
  );
  return {
    runs: artifacts.length,
    artifacts,
    pricedRuns: artifacts.filter((artifact) => artifact.usage.cost != null).length,
    tokens: usage.totalTokens,
    ...usage,
  };
}

export function SkillsScreen({ runtimeTasks }: { runtimeTasks: RuntimeTask[] }) {
  const [selectedId, setSelectedId] = useState<StageId | null>(null);
  const selected = workflowStages.find((stage) => stage.id === selectedId);
  if (selected) {
    const usage = stageUsage(runtimeTasks, selected.id);
    return (
      <div className="page library-page detail-page">
        <button type="button" className="detail-back" onClick={() => setSelectedId(null)}><ArrowLeft size={16} /> Back to Skills</button>
        <SectionHeader eyebrow="Runtime capability" title={selected.skill} description={`${selected.label} is a workflow-stage contract executed by ${selected.provider === "harness" ? "the deterministic harness" : "the configured Codex runtime"}.`} />
        <div className="detail-metrics detail-metrics--truthful">
          <Metric label="Recorded artifacts" value={String(usage.runs)} />
          <Metric label="Recorded tokens" value={formatTokenCount(usage.tokens)} />
          <Metric label="Approx. API-rate cost" value={usage.pricedRuns ? formatApproximateCost(usage.cost) : "Unavailable"} />
          <Metric label="Source" value="server/prompts.mjs" />
        </div>
        <div className="detail-grid">
          <section className="detail-panel detail-panel--prompt">
            <header><span><h3>Runtime source</h3><p>Read-only excerpt from the JavaScript that builds this stage prompt. It is not invented TypeScript or an editable override.</p></span></header>
            <pre className="runtime-source"><code>{sourceExcerpt(selected.id)}</code></pre>
          </section>
          <aside className="detail-panel detail-contracts">
            <h3>Input / output contract</h3>
            <div><span>Input</span><p>{skillContracts[selected.id].input}</p></div>
            <div><span>Output</span><p>{skillContracts[selected.id].output}</p></div>
            <div><span>Measurement</span><p>Runs and tokens come from persisted artifacts. Cost is an API-rate estimate after cached-input discounts, not the ChatGPT-plan charge.</p></div>
          </aside>
        </div>
      </div>
    );
  }
  return (
    <div className="page library-page">
      <SectionHeader eyebrow="Runtime contracts" title="Skills" description="These are the ten actual workflow-stage capabilities. Metrics are limited to persisted artifacts and reported tokens." />
      <div className="skill-list">
        {workflowStages.map((stage) => {
          const usage = stageUsage(runtimeTasks, stage.id);
          return (
            <button className="skill-row" type="button" key={stage.id} onClick={() => setSelectedId(stage.id)}>
              <Code size={20} />
              <span><strong>{stage.skill}</strong><small>{stage.label} · {stage.provider === "harness" ? "deterministic harness" : "Codex prompt"}</small></span>
              <span className="skill-metric"><strong>{usage.runs}</strong><small>recorded artifacts</small></span>
              <span className="skill-metric"><strong>{formatTokenCount(usage.tokens)}</strong><small>recorded tokens</small></span>
              <ArrowRight size={16} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

const agentRoles: Array<{ id: AgentRoleId; label: string; skill: string; provider: "codex" | "harness" }> = [
  ...workflowStages
    .filter((stage) => stage.id !== "approval")
    .map((stage) => ({ id: stage.id, label: stage.label, skill: stage.skill, provider: "codex" as const })),
  { id: "repair", label: "Candidate repair", skill: "repair-candidate", provider: "codex" },
  ...scoutRoleIds.map((id) => ({ id, label: id.replace(/^scout-/, "").replaceAll("-", " ").replace(/^./, (value) => value.toUpperCase()), skill: id, provider: "codex" as const })),
  { id: "approval", label: "Human approval", skill: "request-approval", provider: "harness" },
];

function rolePolicy(runtimeStatus: RuntimeStatus | null, roleId: AgentRoleId): RuntimeAgentPolicy | null {
  if (roleId === "approval") return null;
  return runtimeStatus?.settings?.stagePolicies?.[roleId.startsWith("scout-") ? "scouts" : roleId] ?? null;
}

export function AgentsScreen({
  runtimeTasks,
  runtimeStatus,
  selectedId,
  onSelect,
}: {
  runtimeTasks: RuntimeTask[];
  runtimeStatus: RuntimeStatus | null;
  selectedId: AgentRoleId | null;
  onSelect: (stageId: AgentRoleId | null) => void;
}) {
  const selected = agentRoles.find((stage) => stage.id === selectedId) ?? null;
  if (selected) {
    const usage = stageUsage(runtimeTasks, selected.id);
    const latestArtifact = [...usage.artifacts].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    const deterministic = selected.provider === "harness";
    const configuredPolicy = rolePolicy(runtimeStatus, selected.id);
    return (
      <div className="page library-page detail-page">
        <button type="button" className="detail-back" onClick={() => onSelect(null)}><ArrowLeft size={16} /> Back to Agents</button>
        <SectionHeader
          eyebrow="Execution role"
          title={`${selected.label} agent`}
          description={deterministic ? "A deterministic human-owned gate with no model context." : `An ephemeral ${selected.skill} run. Each artifact below records its exact model, reasoning, usage, and supplied context.`}
        />
        <div className="detail-metrics detail-metrics--truthful">
          <Metric label="Default policy" value={configuredPolicy ? `${configuredPolicy.model} · ${configuredPolicy.reasoning}` : "Deterministic"} />
          <Metric label="Recorded runs" value={String(usage.runs)} />
          <Metric label="Input / output" value={`${formatTokenCount(usage.inputTokens)} / ${formatTokenCount(usage.outputTokens)}`} />
          <Metric label="Cache rate" value={formatCacheRate(usage)} />
          <Metric label="Approx. cost" value={usage.pricedRuns ? formatApproximateCost(usage.cost) : deterministic ? "$0.00" : "Unavailable"} />
        </div>
        <div className="detail-grid">
          <section className="detail-panel agent-run-history">
            <header><span><h3>Recorded agent runs</h3><p>These are persisted stage artifacts, not a simulated success rate.</p></span></header>
            {usage.artifacts.length ? [...usage.artifacts].reverse().map((artifact) => (
              <article key={artifact.id} className="agent-run-row">
                <div><strong>{artifact.name}</strong><small>{new Date(artifact.createdAt).toLocaleString()} · {artifact.model} · {artifact.reasoning ?? "reasoning not recorded"}</small></div>
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
  return (
    <div className="page library-page">
      <SectionHeader eyebrow="Execution roles" title="Agents" description="Each temporary role has a snapshotted model and reasoning policy. Candidate Repair is a separate quality-critical role; Human Approval is deterministic." />
      <div className="truth-banner"><Robot size={20} /><span><strong>{runtimeStatus?.model ?? "Configured Codex model"} · {runtimeStatus?.reasoning ?? "unknown"} reasoning</strong><small>Current single-provider execution policy. Claude and local model execution are not wired into the harness.</small></span></div>
      <div className="agent-grid agent-grid--roles">
        {agentRoles.map((stage) => {
          const usage = stageUsage(runtimeTasks, stage.id);
          const deterministic = stage.provider === "harness";
          const configuredPolicy = rolePolicy(runtimeStatus, stage.id);
          return (
            <button className="agent-panel" type="button" key={stage.id} onClick={() => onSelect(stage.id)}>
              <div className="agent-panel__head"><span className={`agent-icon agent-icon--${deterministic ? "harness" : "codex"}`}><Robot size={22} /></span><span><strong>{stage.label}</strong><small>{deterministic ? "Harness-owned gate" : "Ephemeral Codex agent run"}</small></span></div>
              <dl>
                <div><dt>Capability</dt><dd>{stage.skill}</dd></div>
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
  onSave: (settings: Pick<RuntimeSettings, "allowedModels" | "defaultModel" | "defaultReasoning" | "stagePolicies">) => Promise<void>;
  onVerifyPricing: () => Promise<void>;
  refreshing: boolean;
}) {
  const claude = runtimeStatus?.providers?.find((provider) => provider.id === "claude");
  const [allowedModels, setAllowedModels] = useState<string[]>([]);
  const [defaultModel, setDefaultModel] = useState("");
  const [defaultReasoning, setDefaultReasoning] = useState("");
  const [stagePolicies, setStagePolicies] = useState<Record<string, RuntimeAgentPolicy>>({});
  const [saving, setSaving] = useState(false);
  const [verifyingPricing, setVerifyingPricing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const settings = runtimeStatus?.settings;
    if (!settings) return;
    setAllowedModels(settings.allowedModels);
    setDefaultModel(settings.defaultModel);
    setDefaultReasoning(settings.defaultReasoning);
    setStagePolicies(settings.stagePolicies ?? {});
  }, [runtimeStatus?.settings]);
  const selectedModel = runtimeStatus?.catalog?.models.find((model) => model.id === defaultModel);
  const pricing = runtimeStatus?.settings?.pricing;
  return (
    <div className="page library-page settings-page">
      <SectionHeader eyebrow="Local orchestration" title="Settings" description="Choose the model allowlist and defaults used for new tasks. Each task snapshots its model and reasoning level so later settings changes do not rewrite history." action={<Button tone="secondary" icon={MagnifyingGlass} onClick={() => void onRefresh()} disabled={refreshing}>{refreshing ? "Searching…" : "Search available models"}</Button>} />
      <section className="settings-section">
        <h3>Allowed models</h3>
        <p className="settings-section__intro">Discovered from the local Codex model catalog{runtimeStatus?.catalog?.fetchedAt ? ` · refreshed ${new Date(runtimeStatus.catalog.fetchedAt).toLocaleString()}` : ""}. Enabling a model makes it selectable on New task.</p>
        <div className="model-allowlist">
          {(runtimeStatus?.catalog?.models ?? []).map((model) => {
            const allowed = allowedModels.includes(model.id);
            const inUse = Object.values(stagePolicies).some((policy) => policy.model === model.id);
            return (
              <label className={allowed ? "model-option model-option--allowed" : "model-option"} key={model.id}>
                <input
                  type="checkbox"
                  checked={allowed}
                  disabled={allowed && inUse}
                  title={allowed && inUse ? "Move every role away from this model before removing it." : undefined}
                  onChange={(event) => {
                    const next = event.target.checked
                      ? [...new Set([...allowedModels, model.id])]
                      : allowedModels.filter((id) => id !== model.id);
                    setAllowedModels(next);
                    if (!next.includes(defaultModel) && next[0]) {
                      const fallback = runtimeStatus?.catalog?.models.find((item) => item.id === next[0]);
                      setDefaultModel(next[0]);
                      setDefaultReasoning(fallback?.defaultReasoning ?? "medium");
                    }
                  }}
                />
                <span><strong>{model.label}</strong><small>{model.description}</small></span>
                <code>{model.id}</code>
              </label>
            );
          })}
        </div>
        <div className="settings-default-grid">
          <label>Default model<select value={defaultModel} onChange={(event) => { const model = runtimeStatus?.catalog?.models.find((item) => item.id === event.target.value); setDefaultModel(event.target.value); setDefaultReasoning(model?.defaultReasoning ?? "medium"); }}>{(runtimeStatus?.catalog?.models ?? []).filter((model) => allowedModels.includes(model.id)).map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</select></label>
          <label>Default reasoning<select value={defaultReasoning} onChange={(event) => setDefaultReasoning(event.target.value)}>{(selectedModel?.reasoningLevels ?? []).map((level) => <option key={level} value={level}>{level}</option>)}</select></label>
          <Button tone="primary" disabled={saving || !allowedModels.length || !defaultModel || !defaultReasoning} onClick={async () => { setError(null); setSaving(true); try { await onSave({ allowedModels, defaultModel, defaultReasoning, stagePolicies }); } catch (reason) { setError(reason instanceof Error ? reason.message : "Settings could not be saved."); } finally { setSaving(false); } }}>{saving ? "Saving…" : "Save model policy"}</Button>
        </div>
        <fieldset className="role-policy-grid">
          <legend className="sr-only">Agent role model policies</legend>
          {agentRoles.filter((role) => role.provider === "codex" && !role.id.startsWith("scout-")).map((role) => {
            const policy = stagePolicies[role.id] ?? { model: defaultModel, reasoning: defaultReasoning };
            const model = runtimeStatus?.catalog?.models.find((item) => item.id === policy.model);
            return (
              <div className="role-policy-row" key={role.id}>
                <span><strong>{role.label}</strong><small>{role.skill}</small></span>
                <label>Model<select value={policy.model} onChange={(event) => { const nextModel = runtimeStatus?.catalog?.models.find((item) => item.id === event.target.value); setStagePolicies((current) => ({ ...current, [role.id]: { model: event.target.value, reasoning: nextModel?.reasoningLevels.includes(policy.reasoning) ? policy.reasoning : nextModel?.defaultReasoning ?? "medium" } })); }}>{(runtimeStatus?.catalog?.models ?? []).filter((item) => allowedModels.includes(item.id)).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
                <label>Reasoning<select value={policy.reasoning} onChange={(event) => setStagePolicies((current) => ({ ...current, [role.id]: { ...policy, reasoning: event.target.value } }))}>{(model?.reasoningLevels ?? [policy.reasoning]).map((level) => <option key={level} value={level}>{level}</option>)}</select></label>
              </div>
            );
          })}
        </fieldset>
        {error ? <p className="dialog-error" role="alert">{error}</p> : null}
      </section>
      <section className="settings-section">
        <h3>Runtime connection</h3>
        <SettingRow title="Authentication" copy="No API key is read or stored" control={<strong>{runtimeStatus?.authenticated ? `${runtimeStatus.authMethod} signed in` : "Not connected"}</strong>} />
        <SettingRow title="Claude" copy={claude?.detail ?? "Discovery runs when the local companion status is refreshed"} control={<span className="capability-gap">{claude?.authenticated ? "Signed in · not executable" : claude?.available ? "Login required" : "Not found"}</span>} />
      </section>
      <section className="settings-section">
        <div className="settings-section__head"><span><h3>Approximate cost rate card</h3><p>Standard short-context API prices per 1M tokens. Calculated task costs are comparison estimates; ChatGPT-plan charges are not exposed.</p></span><Button tone="secondary" disabled={verifyingPricing || !runtimeStatus?.authenticated} onClick={async () => { setError(null); setVerifyingPricing(true); try { await onVerifyPricing(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Pricing could not be verified."); } finally { setVerifyingPricing(false); } }}>{verifyingPricing ? "Agent checking…" : "Verify with agent"}</Button></div>
        <div className="pricing-table">
          <div className="pricing-table__header"><span>Model</span><span>Input</span><span>Cached input</span><span>Cache write</span><span>Output</span></div>
          {(runtimeStatus?.catalog?.models ?? []).filter((model) => allowedModels.includes(model.id)).map((model) => {
            const rate = pricing?.rates?.[model.id]?.short ?? model.pricing?.short;
            return <div className="pricing-table__row" key={model.id}><strong>{model.label}</strong><code>{rate ? `$${rate.input}` : "—"}</code><code>{rate ? `$${rate.cachedInput}` : "—"}</code><code>{rate?.cacheWrite == null ? "—" : `$${rate.cacheWrite}`}</code><code>{rate ? `$${rate.output}` : "—"}</code></div>;
          })}
        </div>
        <small className="settings-pricing-source">{pricing ? `Version ${pricing.version} · ${pricing.verifiedBy} · ${new Date(pricing.verifiedAt).toLocaleString()}` : "Pricing metadata unavailable"}</small>
        {pricing?.creditRates ? (
          <>
            <div className="settings-section__head settings-section__head--nested"><span><h3>ChatGPT work credits</h3><p>Current Codex credit units per 1M tokens. Credits measure plan usage; they are not dollars.</p></span></div>
            <div className="pricing-table pricing-table--credits">
              <div className="pricing-table__header"><span>Model</span><span>Input</span><span>Cached input</span><span>Output</span></div>
              {(runtimeStatus?.catalog?.models ?? []).filter((model) => allowedModels.includes(model.id) && pricing.creditRates?.[model.id]).map((model) => { const rate = pricing.creditRates?.[model.id]; return <div className="pricing-table__row" key={model.id}><strong>{model.label}</strong><code>{rate?.input}</code><code>{rate?.cachedInput}</code><code>{rate?.output}</code></div>; })}
            </div>
            <small className="settings-pricing-source">Source: {pricing.creditSourceUrl ?? "OpenAI ChatGPT pricing"}</small>
          </>
        ) : null}
      </section>
      <section className="settings-section">
        <div className="settings-section__head"><span><h3>Model dogfooding scorecard</h3><p>{evaluationSummary?.methodology ?? "Observational runtime results grouped by exact role, model, and reasoning."} Human quality scores are recorded separately from tokens and cost.</p></span><strong>{evaluationSummary?.evaluatedTasks ?? 0} evaluated tasks</strong></div>
        <div className="evaluation-table">
          <div className="evaluation-table__header"><span>Variant</span><span>Runs</span><span>Cache</span><span>Credits</span><span>API est.</span><span>Quality</span></div>
          {(evaluationSummary?.variants ?? []).slice(0, 20).map((variant) => <div className="evaluation-table__row" key={`${variant.role}:${variant.model}:${variant.reasoning}`}><span><strong>{variant.role}</strong><small>{variant.model} · {variant.reasoning}</small></span><code>{variant.runs}</code><code>{variant.cacheRate == null ? "—" : `${Math.round(variant.cacheRate * 100)}%`}</code><code>{variant.credits == null ? "—" : variant.credits.toFixed(2)}</code><code>{variant.cost == null ? "—" : formatApproximateCost(variant.cost)}</code><code>{variant.averageHumanScore == null ? "Not rated" : `${variant.averageHumanScore.toFixed(1)} / 5`}</code></div>)}
          {!evaluationSummary?.variants?.length ? <div className="evaluation-table__empty">No observed agent runs yet. The scorecard fills from real retained artifacts; it does not use mock success rates.</div> : null}
        </div>
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

function Metric({ label, value }: { label: string; value: string }) {
  return <div><span><CheckCircle size={16} /> {label}</span><strong>{value}</strong></div>;
}

function SettingRow({ title, copy, control }: { title: string; copy: string; control: React.ReactNode }) {
  return <div className="setting-row"><span><strong>{title}</strong><small>{copy}</small></span><div>{control}</div></div>;
}
