import { ArrowRight, Crosshair, MagnifyingGlass, Plus } from "@phosphor-icons/react";
import type { RuntimeProject } from "../../domain";
import { usePanelState } from "../app/panel-state";
import type { TaskSummary } from "../runtime/contracts";
import {
  attentionFor,
  formatApproximateCost,
  formatCount,
  formatDuration,
  isExecuting,
  isOpen,
  needsYou,
  stageLabels,
} from "../runtime/presentation";
import { AttentionIcon } from "../ui/Attention";

const tabs = ["Active", "Needs you", "Completed", "Closed", "Archived", "All"];
export function TaskJournal({
  tasks,
  projects,
  initialProject,
  onInspect,
  onLocate,
  onNew,
}: {
  tasks: TaskSummary[];
  projects: RuntimeProject[];
  initialProject?: string;
  onInspect(id: string): void;
  onLocate(id: string): void;
  onNew(): void;
}) {
  const key = `journal-${initialProject ?? "all"}`;
  const [query, setQuery] = usePanelState(`${key}-query`, "");
  const [filter, setFilter] = usePanelState(`${key}-filter`, "Active");
  const [projectId, setProjectId] = usePanelState(`${key}-project`, initialProject ?? "all");
  const [stage, setStage] = usePanelState(`${key}-stage`, "all");
  const [sort, setSort] = usePanelState(`${key}-sort`, "updated");
  const [selectedId, select] = usePanelState<string | null>(`${key}-selected`, null);
  const project = projects.find((item) => item.id === projectId);
  const visible = tasks
    .filter((task) =>
      `${task.id} ${task.title} ${task.repositoryPath}`.toLowerCase().includes(query.toLowerCase()),
    )
    .filter((task) => !project || task.repositoryPath === project.repositoryPath)
    .filter((task) => stage === "all" || task.currentStage === stage)
    .filter(
      (task) =>
        filter === "All" ||
        (filter === "Active"
          ? isOpen(task)
          : filter === "Needs you"
            ? needsYou(task)
            : filter === "Completed"
              ? task.status === "completed"
              : filter === "Closed"
                ? ["closed", "cancelled"].includes(task.status)
                : task.status === "archived"),
    )
    .sort((a, b) =>
      sort === "tokens"
        ? b.usage.totalTokens - a.usage.totalTokens
        : sort === "created"
          ? b.createdAt.localeCompare(a.createdAt)
          : b.updatedAt.localeCompare(a.updatedAt),
    );
  const selected = visible.find((item) => item.id === selectedId) ?? visible[0];
  return (
    <div className="overlay-body journal-body">
      <div className="journal-tools journal-filters">
        <nav className="segmented" aria-label="Task state filter">
          {tabs.map((tab) => (
            <button type="button" key={tab} aria-pressed={filter === tab} onClick={() => setFilter(tab)}>
              {tab}
            </button>
          ))}
        </nav>
        <button type="button" className="primary" onClick={onNew}>
          <Plus size={18} />
          New task
        </button>
      </div>
      <div className="journal-tools">
        <label>
          <MagnifyingGlass size={19} />
          <input
            aria-label="Search tasks"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tasks and projects"
          />
        </label>
        <select
          aria-label="Filter by project"
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
        >
          <option value="all">All projects</option>
          {projects.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
              {item.archivedAt ? " (archived)" : ""}
            </option>
          ))}
        </select>
        <select aria-label="Filter by stage" value={stage} onChange={(event) => setStage(event.target.value)}>
          <option value="all">All stages</option>
          {Object.entries(stageLabels).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <select aria-label="Sort tasks" value={sort} onChange={(event) => setSort(event.target.value)}>
          <option value="updated">Recently updated</option>
          <option value="created">Recently created</option>
          <option value="tokens">Most tokens</option>
        </select>
        <span>{visible.length} tasks</span>
      </div>
      <div className="journal-table-scroll">
        <table className="task-journal">
          <thead>
            <tr>
              <th>Task</th>
              <th>Project</th>
              <th>Stage</th>
              <th>State</th>
              <th>Agents</th>
              <th>Tokens</th>
              <th>Approx. cost</th>
              <th>Elapsed</th>
              <th>Updated</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((task) => (
              <tr key={task.id} className={task.id === selected?.id ? "selected" : ""}>
                <td>
                  <button
                    type="button"
                    className="table-task"
                    onClick={() => select(task.id)}
                    aria-pressed={task.id === selected?.id}
                  >
                    <strong>{task.id}</strong>
                    <span>{task.title}</span>
                  </button>
                </td>
                <td>
                  {projects.find((item) => item.repositoryPath === task.repositoryPath)?.name ??
                    task.repositoryPath.split("/").at(-1)}
                </td>
                <td>{stageLabels[task.currentStage]}</td>
                <td>
                  <span className={`state-badge tone-${attentionFor(task).kind}`}>
                    <AttentionIcon kind={attentionFor(task).kind} size={17} />
                    {attentionFor(task).label}
                  </span>
                </td>
                <td>
                  <span className="journal-agent">
                    <img src="/assets/mf.worker.standard.portrait.r1.png" alt="" />
                    {task.activeRunIds?.length
                      ? `${task.activeRunIds.length} active`
                      : isExecuting(task)
                        ? "Executing"
                        : "Idle"}
                  </span>
                </td>
                <td>{formatCount(task.usage.totalTokens)}</td>
                <td>{formatApproximateCost(task.usage.cost, task.usage.pricingVersion)}</td>
                <td>
                  {task.startedAt
                    ? formatDuration(
                        Date.parse(task.completedAt ?? task.updatedAt) - Date.parse(task.startedAt),
                      )
                    : task.status === "queued"
                      ? "Not started"
                      : "Not recorded"}
                </td>
                <td>
                  <time dateTime={task.updatedAt}>
                    {new Date(task.updatedAt).toLocaleDateString()}
                    <small>
                      {new Date(task.updatedAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </small>
                  </time>
                </td>
                <td>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Inspect ${task.id}`}
                    onClick={() => onInspect(task.id)}
                  >
                    <ArrowRight size={20} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!visible.length && <p className="empty-state">No tasks match these filters.</p>}
      {selected && (
        <section className="journal-selection">
          <div className="section-heading">
            <div>
              <small>{selected.id}</small>
              <h2>{selected.title}</h2>
            </div>
            <div className="inline-controls">
              <button type="button" className="primary" onClick={() => onInspect(selected.id)}>
                Inspect task
                <ArrowRight size={18} />
              </button>
              <button
                type="button"
                disabled={Boolean(
                  projects.find((item) => item.repositoryPath === selected.repositoryPath)?.archivedAt,
                )}
                onClick={() => onLocate(selected.id)}
              >
                <Crosshair size={18} />
                Locate in world
              </button>
            </div>
          </div>
          <p className="quiet">{attentionFor(selected).reason ?? selected.description}</p>
          <div className="journal-detail-grid">
            <div>
              <h3>Current state</h3>
              <p>
                {stageLabels[selected.currentStage]} · {attentionFor(selected).label}
              </p>
              <small>
                {isExecuting(selected) ? "Execution active" : "No active execution"} · Updated{" "}
                {new Date(selected.updatedAt).toLocaleString()}
              </small>
              {selected.closure && (
                <p>
                  Closed: {selected.closure.reason} · {selected.closure.note}
                </p>
              )}
              {selected.archive && <p>Archived from {selected.archive.previousStatus}</p>}
            </div>
            <div>
              <h3>Retained artifacts</h3>
              {selected.artifacts.length ? (
                selected.artifacts.slice(-3).map((item) => (
                  <div className="journal-artifact" key={item.id}>
                    <span>{item.name}</span>
                    <small>{stageLabels[item.stage]}</small>
                  </div>
                ))
              ) : (
                <p className="quiet">No artifacts recorded yet.</p>
              )}
            </div>
            <div>
              <h3>Usage so far</h3>
              <strong>{formatCount(selected.usage.totalTokens)} tokens</strong>
              <p className="quiet">
                {formatCount(selected.usage.inputTokens)} input · {formatCount(selected.usage.outputTokens)}{" "}
                output
              </p>
              <small>{formatCount(selected.usage.cachedInputTokens)} cached input</small>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
