import { ArrowRight, FileText, GearSix, MagnifyingGlass } from "@phosphor-icons/react";
import { useState } from "react";
import type { RuntimeRun } from "../../domain";
import type { TaskEvidence } from "../runtime/contracts";
import {
  attentionAction,
  attentionFor,
  formatCount,
  formatDuration,
  isActiveRun,
  latestRun,
  modelLabel,
  reasoningLabel,
  runDuration,
  stageLabels,
} from "../runtime/presentation";
import { currentRecordedTool, eventAge, runEvents } from "../runtime/agent-activity";
import { ScrollArea } from "../ui/ScrollArea";
import { ResizeHandles, useWindowSizing, WindowSizeControls } from "../ui/WindowSizing";
import { workAction, workActions } from "../world/worker-behavior";
import { AgentActivity } from "./AgentActivity";

export function AgentPanel({
  evidence,
  run,
  connected,
  onAction,
  onInspect,
  onArtifact,
  onRun,
  onMore,
  onPolicies,
  requestedRunId,
  portrait = "/assets/mf.worker.standard.portrait.r1.png",
  motion = true,
  now = Date.now(),
}: {
  evidence: TaskEvidence;
  run: RuntimeRun | undefined;
  connected: boolean;
  onAction(): void;
  onInspect(): void;
  onArtifact(id: string): void;
  onRun(id: string): void;
  onMore(kind: "runs" | "activity" | "artifacts"): void;
  onPolicies(): void;
  requestedRunId?: string | null;
  portrait?: string;
  motion?: boolean;
  now?: number;
}) {
  const [tab, setTab] = useState("activity");
  const sizing = useWindowSizing("agent");
  const task = evidence.core;
  const active = Boolean(run && isActiveRun(task, run));
  const latest = latestRun(evidence.runs.items, task.activeRunIds);
  const previous = Boolean(run && !active && latest && run.id !== latest.id);
  const events = runEvents(evidence.activity.items, run);
  const exactLatest = [...events].reverse().find((event) => event.runId === run?.id);
  const tool = currentRecordedTool(run, events, active && connected);
  const age = eventAge(exactLatest?.at, now);
  const usage = run?.usage;
  const attention = attentionFor(task);
  const tabs = ["activity", "output", "context"];
  return (
    <aside
      className={`agent-panel panel sized-agent ${sizing.maximised ? "expanded-agent" : ""}`}
      style={sizing.style}
      aria-label="Watch agent"
    >
      <header className="agent-heading">
        <img src={portrait} alt="Worker role" />
        <div className="agent-identity">
          <h1 title={task.title}>
            {task.id} · {run ? stageLabels[run.stage] : "Task crew"}
          </h1>
          <p title={task.title}>{task.title}</p>
          <small>
            {run?.role ?? "Role not recorded"} · {modelLabel(run?.model)} · {reasoningLabel(run?.reasoning)}
            {run?.workPackageId && ` · ${run.workPackageId}`}
          </small>
        </div>
        <WindowSizeControls sizing={sizing} />
      </header>
      <label className="run-picker">
        Recorded run
        <select
          aria-label="Recorded run"
          value={run?.id ?? ""}
          onChange={(event) => onRun(event.target.value)}
        >
          {!run && (
            <option value="">{requestedRunId ? "Requested run not loaded" : "No recorded run"}</option>
          )}
          {evidence.runs.items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.id} · {item.status}
              {task.activeRunIds?.includes(item.id) && item.status === "running" ? " · active" : ""}
            </option>
          ))}
        </select>
        {evidence.runs.nextCursor && (
          <button type="button" onClick={() => onMore("runs")}>
            Earlier runs
          </button>
        )}
      </label>
      <section
        className={`agent-status tone-${connected ? attention.kind : "unavailable"}`}
        aria-label="Task and run state"
      >
        <div>
          <strong>{connected ? attention.label : "Connection lost"}</strong>
          <span>
            {!connected
              ? "Last known run state"
              : active
                ? "Run executing"
                : run
                  ? run.status === "running"
                    ? "Run not confirmed active · parked"
                    : `Run ${run.status} · parked`
                  : "No run loaded"}
            {previous ? " · historical" : ""}
          </span>
        </div>
        <button type="button" className="primary" onClick={onAction}>
          {attentionAction(task)}
          <ArrowRight size={16} />
        </button>
        <small>
          Task: {stageLabels[attention.stage]} · Next:{" "}
          {connected ? (attention.nextActor ?? "No action pending") : "Reconnect"}
        </small>
        {attention.reason && <p>{attention.reason}</p>}
        {run?.error && run.error !== attention.reason && <p>Run detail: {run.error}</p>}
        {!connected && <p>Showing last known evidence; current execution is unconfirmed.</p>}
        {requestedRunId && !run && (
          <p>
            Run {requestedRunId} is not in the loaded evidence.
            {!evidence.runs.nextCursor && " No earlier runs are available."}
          </p>
        )}
        {previous && latest && isActiveRun(task, latest) && (
          <button type="button" className="link-button" onClick={() => onRun(latest.id)}>
            View active worker
          </button>
        )}
      </section>
      <dl className="agent-metrics">
        <div>
          <dt>{active ? "Elapsed" : "Runtime"}</dt>
          <dd>{run ? formatDuration(runDuration(run, now, active)) : "Not recorded"}</dd>
        </div>
        <div>
          <dt>Recorded tokens</dt>
          <dd
            title={
              usage
                ? `Input ${usage.inputTokens} · Cached ${usage.cachedInputTokens} · Output ${usage.outputTokens}`
                : undefined
            }
          >
            {usage ? formatCount(usage.totalTokens) : active ? "Not yet reported" : "Not reported"}
          </dd>
        </div>
        <div>
          <dt>
            Approx. cost
            {run?.apiEstimate != null && usage?.pricingVersion && (
              <small className="estimate-label">API-rate estimate</small>
            )}
          </dt>
          <dd
            title={
              run?.apiEstimate != null && usage?.pricingVersion
                ? `API-rate estimate · ${usage.pricingVersion}. Not an attributable ChatGPT-plan charge.`
                : "No recorded usage with a supported rate card. Attributable ChatGPT-plan charges are unavailable."
            }
          >
            {run?.apiEstimate != null && usage?.pricingVersion
              ? `$${run.apiEstimate.toFixed(4)}`
              : "Unavailable"}
          </dd>
        </div>
        <div>
          <dt>Last event</dt>
          <dd>{age == null ? "Not recorded" : `${formatDuration(age)} ago`}</dd>
        </div>
      </dl>
      <p className="agent-animation-label">
        {!connected || !active
          ? "Worker parked"
          : !motion
            ? "World motion paused"
            : `${workActions[workAction(run?.stage ?? task.currentStage, run?.role)].label} · role animation`}
      </p>
      <div className="agent-latest">
        <small>{tool ? "Current recorded tool" : "Latest recorded activity"}</small>
        <strong>{tool?.name ?? exactLatest?.title ?? "Awaiting a recorded event"}</strong>
      </div>
      <div className="agent-tabs">
        <div className="tab-bar" role="tablist" aria-label="Agent evidence">
          {tabs.map((id) => (
            <button
              type="button"
              key={id}
              id={`agent-tab-${id}`}
              role="tab"
              aria-selected={tab === id}
              aria-controls={`agent-${id}`}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => setTab(id)}
              onKeyDown={(event) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                const index =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? 2
                      : (tabs.indexOf(id) + (event.key === "ArrowRight" ? 1 : 2)) % 3;
                const next = tabs[index] ?? "activity";
                setTab(next);
                document.getElementById(`agent-tab-${next}`)?.focus();
              }}
            >
              {id[0]?.toUpperCase()}
              {id.slice(1)}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Inspect task"
          title="Inspect task"
          onClick={onInspect}
        >
          <MagnifyingGlass size={18} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Configure future task roles"
          title="Configure future task roles"
          onClick={onPolicies}
        >
          <GearSix size={18} />
        </button>
      </div>
      {tab === "activity" ? (
        <AgentActivity
          key={run?.id ?? "unloaded"}
          events={events}
          run={run}
          more={Boolean(evidence.activity.nextCursor)}
          onMore={() => onMore("activity")}
        />
      ) : (
        <ScrollArea className="agent-evidence" label={`Agent ${tab}`}>
          <div role="tabpanel" id={`agent-${tab}`} aria-labelledby={`agent-tab-${tab}`}>
            {tab === "output" ? (
              <div className="artifact-list">
                {task.artifacts
                  .filter((artifact) => run && artifact.id === run.artifactId)
                  .map((artifact) => (
                    <button type="button" key={artifact.id} onClick={() => onArtifact(artifact.id)}>
                      <FileText size={19} />
                      <span>{artifact.name}</span>
                      <ArrowRight size={18} />
                    </button>
                  ))}
                {run?.artifactId && !task.artifacts.some((artifact) => artifact.id === run.artifactId) && (
                  <button type="button" onClick={() => run.artifactId && onArtifact(run.artifactId)}>
                    Open recorded output · {run.artifactId}
                  </button>
                )}
                {!run?.artifactId && <p className="quiet">This run has no linked output artifact.</p>}
              </div>
            ) : (
              <div>
                <h3>Recorded execution</h3>
                <p>
                  {run?.id ?? "No run loaded"} · {run?.status ?? "unavailable"}
                </p>
                <p>
                  Recorded policy: {modelLabel(run?.model)} · {reasoningLabel(run?.reasoning)}. Editing future
                  roles leaves this run unchanged.
                </p>
                <h3>Recorded usage</h3>
                <p>
                  {usage
                    ? `Input ${formatCount(usage.inputTokens)} · Cached ${formatCount(usage.cachedInputTokens)} · Output ${formatCount(usage.outputTokens)} · ${usage.inputTokens ? `${Math.round((usage.cachedInputTokens / usage.inputTokens) * 100)}% cache rate` : "Cache rate unavailable"}`
                    : active
                      ? "Not yet reported"
                      : "Not reported"}
                </p>
                {run?.apiEstimate != null && usage?.pricingVersion ? (
                  <p>
                    Approx. cost ${run.apiEstimate.toFixed(4)} · API-rate estimate · {usage.pricingVersion}.
                    This is not an attributable ChatGPT-plan charge.
                  </p>
                ) : (
                  <p>
                    Approx. cost is unavailable without recorded usage and a supported rate card. Attributable
                    ChatGPT-plan charges are unavailable.
                  </p>
                )}
                <h3>Repository access</h3>
                <p className="repository-path">{task.repositoryPath}</p>
                <p>
                  {run?.stage === "implement" || run?.kind === "repair"
                    ? "Writes are limited to the isolated candidate worktree."
                    : "Read-only investigation or review."}
                </p>
                <p>
                  Open retained output to inspect its context manifest. Repository permission alone does not
                  prove which context the model used.
                </p>
              </div>
            )}
          </div>
        </ScrollArea>
      )}
      <ResizeHandles sizing={sizing} />
    </aside>
  );
}
