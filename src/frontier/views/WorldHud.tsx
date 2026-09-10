import {
  ArrowRight,
  Binoculars,
  Crosshair,
  GearSix,
  GlobeHemisphereWest,
  ListBullets,
  Plus,
  Robot,
  X,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { RuntimeProject, RuntimeRun } from "../../domain";
import type { FrontierSnapshot, TaskSummary } from "../runtime/contracts";
import {
  attentionAction,
  attentionFor,
  formatCount,
  isExecuting,
  isOpen,
  modelLabel,
  needsYou,
  reasoningLabel,
  splitRecordedDetail,
  stageLabels,
} from "../runtime/presentation";
import { AttentionIcon } from "../ui/Attention";

export function WorldClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="world-clock">
      <span>
        {now.toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" })} ·{" "}
        {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </span>
      <small>{Intl.DateTimeFormat().resolvedOptions().timeZone}</small>
    </div>
  );
}
export function AttentionQueue({ tasks, onSelect }: { tasks: TaskSummary[]; onSelect(id: string): void }) {
  const attention = tasks.filter(needsYou).sort((a, b) => {
    const severity = (task: TaskSummary) =>
      ["repair", "failed", "blocked"].includes(attentionFor(task).kind) ? 0 : 1;
    return (
      severity(a) - severity(b) ||
      (attentionFor(a).since ?? a.createdAt).localeCompare(attentionFor(b).since ?? b.createdAt)
    );
  });
  return (
    <aside className="attention-queue panel">
      <header>
        <strong>Needs you</strong>
        <span className="count">{attention.length}</span>
      </header>
      {attention.length ? (
        <div className="attention-rows">
          {attention.map((task) => (
            <button
              type="button"
              key={task.id}
              className={`attention-row tone-${attentionFor(task).kind}`}
              onClick={() => onSelect(task.id)}
            >
              <AttentionIcon kind={attentionFor(task).kind} />
              <span>
                <strong>
                  {task.id} · {stageLabels[task.currentStage]}
                </strong>
                <small>{attentionFor(task).label}</small>
              </span>
              <ArrowRight size={18} />
            </button>
          ))}
        </div>
      ) : (
        <p className="quiet">No decisions are waiting for you.</p>
      )}
    </aside>
  );
}
export function ProjectHud({
  project,
  tasks,
  onTasks,
}: {
  project: RuntimeProject;
  tasks: TaskSummary[];
  onTasks(): void;
}) {
  const open = tasks.filter(isOpen);
  return (
    <aside className="project-hud panel">
      <h2>
        <Crosshair size={22} />
        {project.name}
      </h2>
      <small>Repository</small>
      <p className="repository-path">{project.repositoryPath.split("/").filter(Boolean).at(-1)}</p>
      <dl className="project-counts">
        <div>
          <dt>Open tasks</dt>
          <dd>{open.length}</dd>
        </div>
        <div>
          <dt>Executing</dt>
          <dd>{open.filter(isExecuting).length}</dd>
        </div>
        <div>
          <dt>Need you</dt>
          <dd>{open.filter(needsYou).length}</dd>
        </div>
      </dl>
      <button type="button" className="text-row" onClick={onTasks}>
        <ListBullets size={18} />
        Open tasks
        <ArrowRight size={18} />
      </button>
    </aside>
  );
}
export function SelectionHud({
  task,
  run,
  loading,
  connected,
  onAction,
  onInspect,
  onWatch,
  onClose,
  portrait = "/assets/mf.worker.standard.portrait.r1.png",
}: {
  task: TaskSummary;
  run?: RuntimeRun;
  loading: boolean;
  connected: boolean;
  onAction(): void;
  onInspect(): void;
  onWatch(): void;
  onClose(): void;
  portrait?: string;
}) {
  const attention = attentionFor(task);
  return (
    <section className={`selection-hud panel tone-${attention.kind}`} aria-label="Selected task">
      <img className="worker-portrait" src={portrait} alt="Worker role" />
      <div className="selection-copy">
        <h2>
          {task.id} · {stageLabels[task.currentStage]}
        </h2>
        <strong className="state-copy">{connected ? attention.label : "Last known state"}</strong>
        {/* The HUD is a compact floating card: the verdict line only. Command output
            belongs in the task window, which has room to scroll it. */}
        <p className="hud-reason">{splitRecordedDetail(attention.reason).headline || task.title}</p>
        <small>
          {attention.since &&
            `Waiting since ${new Date(attention.since).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · `}
          {attention.nextActor && `Next: ${attention.nextActor}`}
          {run &&
            ` · ${run.status === "running" && task.activeRunIds?.includes(run.id) ? "Run executing" : `Run ${run.status}`}`}
        </small>
        <div className="selection-meta">
          <Robot size={17} />
          <span>
            {run
              ? `${modelLabel(run.model)} · ${reasoningLabel(run.reasoning)}`
              : loading
                ? "Loading recorded worker…"
                : "No selected run"}
          </span>
          <span>{formatCount(task.usage.totalTokens)} tokens</span>
        </div>
      </div>
      <div className="selection-actions">
        {attentionAction(task) !== "Inspect task" && (
          <button type="button" onClick={onInspect}>
            <Binoculars size={18} />
            Inspect task
          </button>
        )}
        <button type="button" className="primary" onClick={onAction}>
          {attentionAction(task)}
          <ArrowRight size={18} />
        </button>
        {run && (
          <button type="button" className="link-button" onClick={onWatch}>
            Watch agent
          </button>
        )}
      </div>
      <button
        type="button"
        className="icon-button dismiss-selection"
        aria-label="Clear selection"
        onClick={onClose}
      >
        <X size={18} />
      </button>
    </section>
  );
}
export function WorldActions({
  onNew,
  onTasks,
  onSettings,
}: {
  onNew(): void;
  onTasks(): void;
  onSettings(): void;
}) {
  return (
    <aside className="world-actions panel">
      <button type="button" className="primary new-task" onClick={onNew}>
        <Plus size={22} />
        New task
      </button>
      <div className="secondary-actions">
        <button type="button" onClick={onTasks}>
          <ListBullets size={23} />
          Tasks
        </button>
        <button type="button" onClick={onSettings}>
          <GearSix size={23} />
          World settings
        </button>
      </div>
      <small>Drag to pan · Scroll to zoom · Space to follow</small>
    </aside>
  );
}
export function ConnectionBadge({
  snapshot,
  fixture,
  onRetry,
}: {
  snapshot: FrontierSnapshot;
  fixture: boolean;
  onRetry(): void;
}) {
  const apiFixture = snapshot.status?.authMethod === "deterministic-fixture";
  return (
    <div className={`connection-badge ${snapshot.connection === "offline" ? "offline" : ""}`}>
      <GlobeHemisphereWest size={15} />
      <span>
        {fixture
          ? "Sample world · local demonstration"
          : apiFixture
            ? "Isolated API fixture · no model execution"
            : snapshot.connection === "connected"
              ? "Local runtime connected"
              : snapshot.connection === "connecting"
                ? "Connecting…"
                : "Connection lost · last known state"}
        {fixture && snapshot.connection === "offline" && " · Connection lost · last known state"}
      </span>
      {snapshot.connection === "offline" && (
        <button type="button" className="link-button" onClick={onRetry}>
          Reconnect
        </button>
      )}
    </div>
  );
}
