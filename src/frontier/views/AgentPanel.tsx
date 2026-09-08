import { ArrowRight, Clock, FileText, Info, LockSimple, MagnifyingGlass, Robot } from "@phosphor-icons/react";
import { useState } from "react";
import type { RuntimeRun } from "../../domain";
import type { TaskEvidence } from "../runtime/contracts";
import {
  formatCount,
  formatDuration,
  isActiveRun,
  latestRun,
  modelLabel,
  reasoningLabel,
  stageLabels,
} from "../runtime/presentation";
import { Attention } from "../ui/Attention";
import { workAction, workActions } from "../world/worker-behavior";

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
}) {
  const [tab, setTab] = useState("activity");
  const task = evidence.core;
  const active = Boolean(run && isActiveRun(task, run));
  const latest = latestRun(evidence.runs.items, task.activeRunIds);
  const previous = run && latest && run.id !== latest.id;
  const events = evidence.activity.items.filter(
    (event) => !run || event.runId === run.id || (!event.runId && event.stage === run.stage),
  );
  const usage = run?.usage;
  return (
    <aside className="agent-panel panel" aria-label="Watch agent">
      <header className="agent-heading">
        <img src={portrait} alt="Worker role" />
        <div>
          <h1>
            {run?.stage === "dev-review"
              ? "Review agent"
              : run
                ? `${stageLabels[run.stage]} agent`
                : "Task crew"}
          </h1>
          <dl className="inline-metadata">
            <div>
              <dt>Skill</dt>
              <dd>
                <Robot size={15} />
                {run?.role ?? "Not recorded"}
              </dd>
            </div>
            <div>
              <dt>Model</dt>
              <dd>{modelLabel(run?.model)}</dd>
            </div>
            <div>
              <dt>Reasoning</dt>
              <dd>
                {reasoningLabel(run?.reasoning)}
                <LockSimple size={14} />
              </dd>
            </div>
          </dl>
        </div>
      </header>
      <div className="agent-motion-note">
        <strong>
          {!connected
            ? "Connection unknown · worker parked"
            : !active
              ? "Worker parked"
              : !motion
                ? "World motion paused"
                : `${workActions[workAction(run?.stage ?? task.currentStage, run?.role)].label} · role animation`}
        </strong>
        {!active
          ? "This run is not executing. Task attention and the next action remain below."
          : "An illustration of the recorded role. Activity and evidence below show what the agent actually reports."}
      </div>
      {requestedRunId && !run && (
        <p role="status" className="notice">
          Requested run {requestedRunId} is not in the loaded evidence.
          {evidence.runs.nextCursor ? (
            <button type="button" onClick={() => onMore("runs")}>
              Load earlier runs
            </button>
          ) : (
            " No more recorded runs are available."
          )}
        </p>
      )}
      {previous && (
        <p className="notice">
          <Info size={18} />
          Viewing a previous run. Current task attention is shown below.
          {latest && task.activeRunIds?.includes(latest.id) && (
            <button type="button" className="link-button" onClick={() => onRun(latest.id)}>
              View active worker
            </button>
          )}
        </p>
      )}
      <Attention task={task} connected={connected} onAction={onAction} />
      <p className="notice">
        <Info size={20} />
        {!run
          ? "No recorded agent run is available."
          : active && connected
            ? "This worker is executing. Watching does not pause it."
            : run.status === "completed"
              ? `${run.stage === "grill" ? "Question-generation" : "Agent"} run finished. This worker is parked.`
              : `Run ${run.status}. This worker is parked.`}
      </p>
      <div className="tab-bar" role="tablist" aria-label="Agent evidence">
        {["activity", "output", "context"].map((id) => (
          <button type="button" key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
            {id[0]?.toUpperCase()}
            {id.slice(1)}
          </button>
        ))}
      </div>
      <section className="agent-evidence" role="tabpanel" aria-label={tab}>
        {tab === "activity" ? (
          events.length ? (
            <ol className="activity-list">
              {events.map((event) => (
                <li key={event.id}>
                  <time>
                    {new Date(event.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </time>
                  <div>
                    <strong>{event.title}</strong>
                    <p>{event.detail}</p>
                    {!event.runId && <small>Stage activity · not bound to this run</small>}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="quiet">No observed activity is loaded for this run.</p>
          )
        ) : tab === "output" ? (
          <div className="artifact-list">
            {task.artifacts
              .filter((artifact) => !run || artifact.id === run.artifactId)
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
            {run && !run.artifactId && <p className="quiet">This run has no linked output artifact.</p>}
          </div>
        ) : (
          <div>
            <h3>Repository access</h3>
            <p className="repository-path">{task.repositoryPath}</p>
            <p>
              {run?.stage === "implement" || run?.kind === "repair"
                ? "Writes are limited to the isolated candidate worktree."
                : "Read-only investigation or review."}
            </p>
            <p className="quiet">
              Open a retained artifact to inspect its recorded context manifest. Access permission does not
              prove which context the model used.
            </p>
          </div>
        )}
      </section>
      {tab === "activity" && run?.toolCalls.length ? (
        <section className="agent-tools">
          <h3>Observed tools</h3>
          {run.toolCalls.map((tool, index) => (
            <details key={tool.id ?? `${tool.name}:${index}`}>
              <summary>
                {tool.name} · {tool.phase}
                {tool.commandFailed ? " · failed" : ""}
              </summary>
              <pre>{tool.result ?? "No result payload recorded."}</pre>
            </details>
          ))}
        </section>
      ) : null}
      {tab === "activity" && evidence.activity.nextCursor && (
        <button type="button" onClick={() => onMore("activity")}>
          Load earlier activity
        </button>
      )}
      <section className="run-metadata">
        <h3>{active && connected ? "Current execution" : "Recorded execution"}</h3>
        <dl className="inline-metadata">
          <div>
            <dt>Stage</dt>
            <dd>{run ? stageLabels[run.stage] : "Not recorded"}</dd>
          </div>
          <div>
            <dt>Run</dt>
            <dd>{run?.id ?? "Not recorded"}</dd>
          </div>
          {run?.workPackageId && (
            <div>
              <dt>Package</dt>
              <dd>{run.workPackageId}</dd>
            </div>
          )}
        </dl>
        {run && (
          <p>
            <Clock size={15} />
            {run.status === "completed" ? "Finished" : run.status} ·{" "}
            {active
              ? "Started " +
                (run.startedAt ? new Date(run.startedAt).toLocaleTimeString() : "time not recorded")
              : `Recorded runtime ${formatDuration(run.durationMs)}`}
          </p>
        )}
      </section>
      <section className="usage-strip">
        <dl className="inline-metadata">
          <div>
            <dt>Input</dt>
            <dd>{usage ? formatCount(usage.inputTokens) : "—"}</dd>
          </div>
          <div>
            <dt>Cached</dt>
            <dd>{usage ? formatCount(usage.cachedInputTokens) : "—"}</dd>
          </div>
          <div>
            <dt>Output</dt>
            <dd>{usage ? formatCount(usage.outputTokens) : "—"}</dd>
          </div>
          <div>
            <dt>Cache rate</dt>
            <dd>
              {usage?.inputTokens
                ? `${Math.round((usage.cachedInputTokens / usage.inputTokens) * 100)}%`
                : "—"}
            </dd>
          </div>
        </dl>
        <p className="quiet">
          Approx. cost{" "}
          {run?.apiEstimate != null && usage?.pricingVersion
            ? `$${run.apiEstimate.toFixed(run.apiEstimate > 0 && run.apiEstimate < 0.01 ? 4 : 2)} · API-rate estimate · ${usage.pricingVersion}`
            : "— unavailable"}
        </p>
      </section>
      {evidence.runs.items.length > 1 && (
        <label className="run-picker">
          Recorded run
          <select value={run?.id ?? ""} onChange={(event) => onRun(event.target.value)}>
            {evidence.runs.items.map((item) => (
              <option key={item.id} value={item.id}>
                {stageLabels[item.stage]} · {item.status} · {item.id}
              </option>
            ))}
          </select>
        </label>
      )}
      {evidence.runs.nextCursor && (
        <button type="button" onClick={() => onMore("runs")}>
          Load earlier runs
        </button>
      )}
      <button type="button" className="wide-button" onClick={onInspect}>
        <MagnifyingGlass size={20} />
        Inspect task
      </button>
      <small className="quiet">Recorded run policies are read-only.</small>
      <button type="button" className="wide-button" onClick={onPolicies}>
        Configure future task roles
      </button>
    </aside>
  );
}
