import {
  ArrowLeft,
  ArrowSquareOut,
  Check,
  CheckCircle,
  CircleNotch,
  FileCode,
  Play,
  Robot,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import {
  formatTokenCount,
  type RuntimeArtifact,
  type RuntimeEvent,
  type RuntimeTask,
  type StageId,
  type TaskRunState,
  workflowStages,
} from "../domain";
import { Button, PriorityBadge, StateBadge } from "./Primitives";

export function RuntimeTaskWorkspace({
  task,
  onBack,
  onRun,
  onCancel,
}: {
  task: RuntimeTask;
  onBack: () => void;
  onRun: () => Promise<void>;
  onCancel: () => Promise<void>;
}) {
  const currentIndex = Math.max(
    0,
    workflowStages.findIndex((stage) => stage.id === task.currentStage),
  );
  const [viewedStageId, setViewedStageId] = useState<StageId>(task.currentStage);
  const [openArtifact, setOpenArtifact] = useState<RuntimeArtifact | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const viewedIndex = Math.max(
    0,
    workflowStages.findIndex((stage) => stage.id === viewedStageId),
  );
  const viewedStage = workflowStages[viewedIndex];
  if (!viewedStage) throw new Error(`Unknown workflow stage: ${viewedStageId}`);
  const stageArtifact = task.artifacts.find((artifact) => artifact.stage === viewedStageId);
  const state = toTaskRunState(task.status);
  const viewedStageStopped =
    viewedStageId === task.currentStage && ["failed", "cancelled", "blocked"].includes(task.status);
  const retryExhausted =
    task.stageRun >= task.stageRunLimit && ["failed", "cancelled", "blocked"].includes(task.status);
  const repoName = task.repositoryPath.split(/[\\/]/).filter(Boolean).at(-1) ?? task.repositoryPath;

  const rerun = async () => {
    setRunError(null);
    try {
      await onRun();
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "The task could not be started.");
    }
  };

  return (
    <div className="task-workspace runtime-workspace">
      <header className="task-header">
        <button
          type="button"
          className="icon-button task-header__back"
          onClick={onBack}
          aria-label="Back to tasks"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="task-title-block">
          <span className="mono task-id">{task.id}</span>
          <h1>{task.title}</h1>
        </div>
        <PriorityBadge priority={task.priority} />
        <div className="task-header__meta">
          <StateBadge state={state} />
          <span>
            <small>Repository</small>
            <strong>{repoName}</strong>
          </span>
          <span>
            <small>Stage</small>
            <strong>{currentIndex + 1} / 10</strong>
          </span>
          <span>
            <small>Stage run</small>
            <strong>
              {task.stageRun} / {task.stageRunLimit}
            </strong>
          </span>
        </div>
        <div className="task-header__actions">
          {task.status === "running" ? (
            <Button tone="danger" compact icon={X} onClick={() => void onCancel()}>
              Cancel run
            </Button>
          ) : null}
          {(task.status === "queued" ||
            (!retryExhausted && (task.status === "failed" || task.status === "cancelled"))) && (
            <Button tone="primary" compact icon={Play} onClick={() => void rerun()}>
              {task.status === "queued" ? "Run" : "Retry stage"}
            </Button>
          )}
        </div>
      </header>

      <nav className="stage-navigator" aria-label="Workflow stages">
        {workflowStages.map((stage, index) => {
          const complete = task.completedStages.includes(stage.id);
          const active = stage.id === task.currentStage;
          const selected = stage.id === viewedStageId;
          const failed = active && (task.status === "failed" || task.status === "blocked");
          return (
            <button
              type="button"
              key={stage.id}
              className={`stage-step ${complete ? "stage-step--complete" : ""} ${active ? "stage-step--active" : ""} ${selected ? "stage-step--selected" : ""} ${failed ? "stage-step--failed" : ""}`}
              onClick={() => setViewedStageId(stage.id)}
              aria-current={selected ? "step" : undefined}
            >
              <span className="stage-step__node">
                {complete ? (
                  <Check size={14} weight="bold" />
                ) : failed ? (
                  <X size={14} weight="bold" />
                ) : (
                  index + 1
                )}
              </span>
              <span>
                <strong>{stage.shortLabel}</strong>
                <small>
                  {active
                    ? task.status === "running"
                      ? "current"
                      : task.status.replace("-", " ")
                    : complete
                      ? "done"
                      : "—"}
                </small>
              </span>
            </button>
          );
        })}
      </nav>

      <div className="workspace-scroll">
        <div className="workspace-grid">
          <main className="stage-main runtime-stage-main">
            <RuntimeCommandBar task={task} onRun={rerun} />
            {runError ? (
              <div className="runtime-error" role="alert">
                {runError}
              </div>
            ) : null}
            <header className="runtime-stage-heading">
              <p className="eyebrow">{viewedStage.label} · living artifact</p>
              <h2>{stageArtifact ? stageArtifact.name : `${viewedStage.label} is not ready yet`}</h2>
              <p>
                {stageArtifact
                  ? "This is the durable handoff produced by the real stage agent. Open it wide or inspect the next artifact without losing task context."
                  : viewedStageStopped
                    ? "This stage stopped before it produced a handoff. Earlier artifacts remain available and the activity panel preserves the failure context."
                    : viewedIndex > currentIndex
                      ? "This stage is downstream of the current execution frontier."
                      : "The agent is working on this stage; activity will appear below when the subprocess completes."}
              </p>
            </header>

            {stageArtifact ? (
              <article className="runtime-artifact-card">
                <header>
                  <span>
                    <FileCode size={17} />
                    <strong>{stageArtifact.name}</strong>
                  </span>
                  <Button
                    tone="ghost"
                    compact
                    icon={ArrowSquareOut}
                    onClick={() => setOpenArtifact(stageArtifact)}
                  >
                    Open artifact
                  </Button>
                </header>
                <pre>{stageArtifact.content}</pre>
              </article>
            ) : (
              <div
                className={`runtime-stage-empty ${viewedStageStopped ? "runtime-stage-empty--failed" : ""}`}
              >
                {task.status === "running" && viewedStageId === task.currentStage ? (
                  <CircleNotch className="spin" size={22} />
                ) : viewedStageStopped ? (
                  <WarningCircle size={22} />
                ) : (
                  <FileCode size={22} />
                )}
                <strong>
                  {viewedStageStopped
                    ? "The stage stopped before producing an artifact"
                    : "No artifact for this stage yet"}
                </strong>
                <span>
                  {viewedStageStopped ? task.error : "Completed stages leave inspectable Markdown here."}
                </span>
              </div>
            )}
          </main>

          <aside className="stage-inspector runtime-inspector">
            <InspectorSection title="Task brief">
              <strong>{task.title}</strong>
              <p>{task.description}</p>
            </InspectorSection>
            <InspectorSection title="Stage context">
              <RuntimeRow label="Viewing" value={viewedStage.label} />
              <RuntimeRow label="Active" value={workflowStages[currentIndex]?.label ?? "Triage"} />
              <RuntimeRow label="State" value={task.status.replace("-", " ")} />
            </InspectorSection>
            <InspectorSection title="Execution metadata">
              <RuntimeRow label="Agent" value={`${viewedStage.label} agent`} />
              <RuntimeRow label="Model" value={task.models[0]?.model ?? "GPT-5.4-mini · ChatGPT plan"} />
              <RuntimeRow label="Access" value="Local OAuth session" />
              <RuntimeRow label="Sandbox" value="Read-only" />
              <RuntimeRow label="Repository" value={repoName} mono />
            </InspectorSection>
            <InspectorSection title="Living artifacts" meta={`${task.artifacts.length} retained`}>
              <div className="runtime-artifact-list">
                {task.artifacts.length ? (
                  task.artifacts.map((artifact) => (
                    <button
                      type="button"
                      key={artifact.id}
                      onClick={() => {
                        setViewedStageId(artifact.stage);
                        setOpenArtifact(artifact);
                      }}
                    >
                      <FileCode size={15} />
                      <span>
                        <strong>{artifact.name}</strong>
                        <small>{workflowStages.find((stage) => stage.id === artifact.stage)?.label}</small>
                      </span>
                    </button>
                  ))
                ) : (
                  <small>Artifacts appear as stage agents complete.</small>
                )}
              </div>
            </InspectorSection>
          </aside>
        </div>
        <RuntimeActivity events={task.events} />
      </div>

      <footer className="workspace-footer">
        <span>
          <small>Updated</small>
          <strong className="mono">
            {new Date(task.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </strong>
        </span>
        <span>
          <small>Tokens</small>
          <strong className="mono">{formatTokenCount(task.usage.totalTokens)}</strong>
        </span>
        <span>
          <small>Cached input</small>
          <strong className="mono text-green">{formatTokenCount(task.usage.cachedInputTokens)}</strong>
        </span>
        <span>
          <small>Artifacts</small>
          <strong className="mono">{task.artifacts.length}</strong>
        </span>
        <span className="workspace-footer__usage">
          <small>Model usage</small>
          <i className="provider-dot provider-dot--codex" />
          {task.models[0]?.model ?? "GPT-5.4-mini via ChatGPT"}
        </span>
        <span>
          <small>Approx. cost</small>
          <strong className="mono">Plan included</strong>
        </span>
      </footer>

      {openArtifact ? (
        <RuntimeArtifactViewer artifact={openArtifact} onClose={() => setOpenArtifact(null)} />
      ) : null}
    </div>
  );
}

function RuntimeCommandBar({ task, onRun }: { task: RuntimeTask; onRun: () => Promise<void> }) {
  const running = task.status === "running";
  const blocked =
    task.status === "blocked" ||
    (task.stageRun >= task.stageRunLimit && (task.status === "failed" || task.status === "cancelled"));
  const failed = !blocked && (task.status === "failed" || task.status === "cancelled");
  const ready = task.status === "awaiting-approval";
  const Icon = running ? CircleNotch : failed || blocked ? WarningCircle : CheckCircle;
  return (
    <section
      className={`stage-command-bar stage-command-bar--${running ? "active" : failed || blocked ? "blocked" : ready ? "ready" : "waiting"}`}
    >
      <Icon className={running ? "spin" : ""} size={18} weight="fill" />
      <span className="stage-command-bar__copy">
        <small>
          {running
            ? "Agent active"
            : blocked
              ? "Blocked"
              : failed
                ? "Action required"
                : ready
                  ? "Next step"
                  : "Ready"}
        </small>
        <strong>
          {running
            ? `${workflowStages.find((stage) => stage.id === task.currentStage)?.label} is running`
            : blocked
              ? "Repair allowance exhausted"
              : failed
                ? "Retry the failed stage"
                : ready
                  ? "Review the investigation before implementation"
                  : "Start the read-only investigation"}
        </strong>
        <span>
          {running
            ? "Codex is inspecting the selected repository in a read-only sandbox."
            : blocked
              ? "Review the retained activity, revise the task, or grant a human override in a future slice."
              : failed
                ? task.error
                : ready
                  ? "Triage, repository evidence, decisions, and specification are retained below."
                  : "Four focused agents will produce durable Markdown handoffs."}
        </span>
      </span>
      <div className="stage-command-bar__actions">
        {(task.status === "queued" || failed) && (
          <Button tone="primary" compact icon={Play} onClick={() => void onRun()}>
            {failed ? "Retry stage" : "Run investigation"}
          </Button>
        )}
        {ready ? (
          <span className="runtime-next-cut">Implementation planning is the next vertical slice</span>
        ) : null}
      </div>
    </section>
  );
}

function InspectorSection({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="runtime-inspector-section">
      <header>
        <strong>{title}</strong>
        {meta ? <small>{meta}</small> : null}
      </header>
      {children}
    </section>
  );
}

function RuntimeRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <span className="runtime-meta-row">
      <small>{label}</small>
      <strong className={mono ? "mono" : ""}>{value}</strong>
    </span>
  );
}

function RuntimeActivity({ events }: { events: RuntimeEvent[] }) {
  const [open, setOpen] = useState(false);
  const visibleEvents = useMemo(() => [...events].reverse().slice(0, 30), [events]);
  return (
    <details className="runtime-activity" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <span>
          <Robot size={16} />
          <strong>Run activity</strong>
          <small>Scoped subprocess telemetry · {events.length} events</small>
        </span>
        <span>
          <span className="connection-dot" />
          {events.at(-1)?.title ?? "Waiting to start"}
        </span>
      </summary>
      <div className="runtime-activity-list">
        {visibleEvents.map((event) => (
          <div className={`runtime-activity-row runtime-activity-row--${event.tone}`} key={event.id}>
            <time className="mono">
              {new Date(event.at).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </time>
            <span>
              <strong>{event.title}</strong>
              <small>{event.detail}</small>
            </span>
            <em>{workflowStages.find((stage) => stage.id === event.stage)?.shortLabel ?? event.stage}</em>
          </div>
        ))}
      </div>
    </details>
  );
}

function RuntimeArtifactViewer({ artifact, onClose }: { artifact: RuntimeArtifact; onClose: () => void }) {
  return (
    <div
      className="artifact-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`${artifact.name} artifact`}
    >
      <button
        type="button"
        className="artifact-overlay__backdrop"
        onClick={onClose}
        aria-label="Close artifact"
      />
      <section className="artifact-viewer">
        <header>
          <span>
            <FileCode size={18} />
            <span>
              <small>
                {artifact.stage} · {artifact.kind}
              </small>
              <strong>{artifact.name}</strong>
            </span>
          </span>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close artifact viewer">
            <X size={18} />
          </button>
        </header>
        <div className="artifact-viewer__summary">
          <span>Real agent output · read-only</span>
          <p>Produced by {artifact.model}; retained as the handoff to downstream stages.</p>
        </div>
        <pre>{artifact.content}</pre>
        <footer>
          <small>{new Date(artifact.createdAt).toLocaleString()}</small>
          <span className="mono">{formatTokenCount(artifact.usage.totalTokens)} tokens</span>
        </footer>
      </section>
    </div>
  );
}

function toTaskRunState(status: RuntimeTask["status"]): TaskRunState {
  if (status === "queued") return "paused";
  if (status === "cancelled" || status === "blocked") return "blocked";
  return status;
}
