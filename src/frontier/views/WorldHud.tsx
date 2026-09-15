import {
  ArrowRight,
  Crosshair,
  GearSix,
  Books,
  GlobeHemisphereWest,
  ListBullets,
  Plus,
  Robot,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { RuntimeProject } from "../../domain";
import type { FrontierSnapshot, TaskSummary } from "../runtime/contracts";
import { orderedDecisions } from "../runtime/decision-session";
import { attentionFor, isExecuting, isOpen, needsYou, stageLabels } from "../runtime/presentation";
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
export function AttentionQueue({
  tasks,
  projects,
  onSelect,
}: {
  tasks: TaskSummary[];
  projects: RuntimeProject[];
  onSelect(id: string): void;
}) {
  const attention = orderedDecisions(tasks);
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? attention : attention.slice(0, 3);
  return (
    <aside
      className={`attention-queue panel ${expanded ? "attention-expanded" : ""}`}
      aria-label="Tasks needing your attention"
    >
      <header>
        <strong>Needs you</strong>
        <span className="count">{attention.length}</span>
      </header>
      {attention.length ? (
        <div className="attention-rows">
          {visible.map((task) => (
            <button
              type="button"
              key={task.id}
              className={`attention-row tone-${attentionFor(task).kind}`}
              aria-label={`${task.id} · ${task.title} · ${attentionFor(task).label}`}
              onClick={() => onSelect(task.id)}
            >
              <AttentionIcon kind={attentionFor(task).kind} />
              <span>
                <span className="queue-heading">
                  <strong>
                    {task.id} · {stageLabels[task.currentStage]}
                  </strong>
                  <small>
                    {projects.find((project) => project.repositoryPath === task.repositoryPath)?.name ??
                      "Project unavailable"}
                  </small>
                </span>
                <small className="queue-state">{attentionFor(task).label}</small>
              </span>
              <ArrowRight size={18} />
            </button>
          ))}
        </div>
      ) : (
        <p className="quiet">No decisions are waiting for you.</p>
      )}
      {attention.length > 3 && (
        <button
          type="button"
          className="queue-expand"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Show priority decisions" : `Show all ${attention.length} decisions`}
          <ArrowRight size={16} />
        </button>
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
export { SelectionHud } from "./SelectionDock";
export function WorldActions({
  onNew,
  onAgents,
  onSkills,
  onSettings,
}: {
  onNew(): void;
  onAgents(): void;
  onSkills(): void;
  onSettings(): void;
}) {
  return (
    <aside className="world-actions panel">
      <button type="button" className="primary new-task" onClick={onNew}>
        <Plus size={22} />
        New task
      </button>
      <div className="secondary-actions">
        <button type="button" onClick={onAgents}>
          <Robot size={23} />
          Agent roster
        </button>
        <button type="button" onClick={onSkills}>
          <Books size={23} />
          Skills
        </button>
        <button type="button" onClick={onSettings}>
          <GearSix size={23} />
          Settings
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
  if (fixture && snapshot.connection !== "offline") return null;
  return (
    <div className={`connection-badge ${snapshot.connection === "offline" ? "offline" : ""}`}>
      <GlobeHemisphereWest size={15} />
      <span>
        {fixture
          ? "Connection lost · last known state"
          : apiFixture
            ? "Isolated API fixture · no model execution"
            : snapshot.connection === "connected"
              ? "Local runtime connected"
              : snapshot.connection === "connecting"
                ? "Connecting…"
                : "Connection lost · last known state"}
      </span>
      {snapshot.connection === "offline" && (
        <button type="button" className="link-button" onClick={onRetry}>
          Reconnect
        </button>
      )}
    </div>
  );
}
