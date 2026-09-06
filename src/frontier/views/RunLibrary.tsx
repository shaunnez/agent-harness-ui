import { ArrowRight, Binoculars, Robot } from "@phosphor-icons/react";
import { useState } from "react";
import { agentRoles, policyIdForRole } from "../../components/AgentRoles";
import type { RuntimeProject, RuntimeStatus } from "../../domain";
import { usePanelState } from "../app/panel-state";
import type { FrontierGateway, TaskSummary } from "../runtime/contracts";
import {
  formatCount,
  formatDuration,
  isActiveRun,
  modelLabel,
  reasoningLabel,
} from "../runtime/presentation";
import { type RunRecord, useRunRecords } from "../runtime/run-records";
import { runTime } from "../runtime/usage";

export function RunLibrary({
  tasks,
  projects,
  gateway,
  status,
  connected,
  now,
  onWatch,
  onTask,
  onSkills,
}: {
  tasks: TaskSummary[];
  projects: RuntimeProject[];
  gateway: FrontierGateway;
  status: RuntimeStatus | null;
  connected: boolean;
  now: number;
  onWatch(taskId: string, runId: string): void;
  onTask(id: string): void;
  onSkills(role?: string): void;
}) {
  const [tab, setTab] = usePanelState("agents-tab", "active");
  const [query, setQuery] = usePanelState("agents-query", "");
  const [project, setProject] = usePanelState("agents-project", "all");
  const [selection, select] = useState<string | null>(null);
  const scoped = tasks
    .filter(
      (task) =>
        project === "all" ||
        projects.find((item) => item.id === project)?.repositoryPath === task.repositoryPath,
    )
    .filter((task) => tab !== "active" || Boolean(task.activeRunIds?.length));
  const feed = useRunRecords(scoped, gateway, tab !== "roles" && connected);
  const rows = feed.records.filter(
    ({ task, run }) =>
      (tab !== "active" || isActiveRun(task, run)) &&
      `${task.id} ${task.title} ${run.role} ${run.model} ${run.workPackageId ?? ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const selected = rows.find(({ task, run }) => `${task.id}:${run.id}` === selection) ?? rows[0];
  return (
    <div className="overlay-body library-body">
      <nav className="tab-bar" aria-label="Agent views">
        {[
          ["active", "Active runs"],
          ["roles", "Role catalogue"],
          ["history", "Run history"],
        ].map(([id, label]) => (
          <button type="button" key={id} aria-pressed={tab === id} onClick={() => setTab(id ?? "active")}>
            {label}
          </button>
        ))}
      </nav>
      {tab === "roles" ? (
        <div className="role-catalogue">
          <p>
            Reusable workflow roles. Model policies apply to future tasks; recorded runs keep their captured
            configuration.
          </p>
          {agentRoles.map((role) => {
            const policy = status?.settings?.stagePolicies[policyIdForRole(role.id)];
            return (
              <button type="button" className="text-row" key={role.id} onClick={() => onSkills(role.id)}>
                <Robot size={24} />
                <span>
                  <strong>{role.label}</strong>
                  <small>
                    {role.skill}
                    {role.parentId ? " · shared Repository scouts policy" : ""}
                  </small>
                </span>
                <span>
                  {role.provider === "harness"
                    ? "Operator / deterministic gate"
                    : policy
                      ? `${modelLabel(policy.model)} · ${reasoningLabel(policy.reasoning)}`
                      : "Policy unavailable"}
                </span>
                <ArrowRight size={18} />
              </button>
            );
          })}
        </div>
      ) : (
        <>
          <div className="library-filters">
            <select
              aria-label="Agent project"
              value={project}
              onChange={(event) => setProject(event.target.value)}
            >
              <option value="all">All projects</option>
              {projects.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <input
              aria-label="Search agents"
              placeholder="Search agent, task or model"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <button type="button" onClick={feed.retry} disabled={!connected || feed.loading}>
              Refresh runs
            </button>
          </div>
          <div className="library-columns">
            <div className="library-table-scroll">
              <table className="record-table">
                <thead>
                  <tr>
                    <th>Agent & role</th>
                    <th>Project / task</th>
                    <th>State</th>
                    <th>Model / effort</th>
                    <th>Tokens</th>
                    <th>Agent time</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((record) => (
                    <RunRow
                      key={`${record.task.id}:${record.run.id}`}
                      record={record}
                      selected={record === selected}
                      project={
                        projects.find((item) => item.repositoryPath === record.task.repositoryPath)?.name
                      }
                      now={now}
                      onSelect={() => select(`${record.task.id}:${record.run.id}`)}
                    />
                  ))}
                </tbody>
              </table>
              {!rows.length && (
                <p className="empty-results">
                  {feed.loading
                    ? "Loading recorded runs…"
                    : tab === "active"
                      ? "No active workers in this scope."
                      : "No matching runs loaded."}
                </p>
              )}
              <RunCoverage feed={feed} />
            </div>
            <aside className="record-inspector">
              {selected ? (
                <>
                  <img className="record-portrait" src="/assets/mf.worker.standard.portrait.r1.png" alt="" />
                  <span className="state-badge">
                    {isActiveRun(selected.task, selected.run)
                      ? connected
                        ? "Executing"
                        : "Last known running"
                      : selected.run.status}
                  </span>
                  <h2>{selected.run.role ?? selected.run.stage}</h2>
                  <h3>
                    {selected.task.id} · {selected.task.title}
                  </h3>
                  <dl>
                    <dt>Run</dt>
                    <dd>{selected.run.id}</dd>
                    <dt>Package</dt>
                    <dd>{selected.run.workPackageId ?? "Whole stage"}</dd>
                    <dt>Model / effort</dt>
                    <dd>
                      {modelLabel(selected.run.model)} · {reasoningLabel(selected.run.reasoning)}
                    </dd>
                    <dt>Agent time</dt>
                    <dd>
                      {formatDuration(runTime(selected.run, now, isActiveRun(selected.task, selected.run)))}
                    </dd>
                    <dt>Started</dt>
                    <dd>
                      {selected.run.startedAt
                        ? new Date(selected.run.startedAt).toLocaleString()
                        : "Not recorded"}
                    </dd>
                  </dl>
                  {selected.run.error && <p className="form-error">{selected.run.error}</p>}
                  <button
                    type="button"
                    className="primary wide-button"
                    onClick={() => onWatch(selected.task.id, selected.run.id)}
                  >
                    <Binoculars size={19} />
                    Watch agent
                  </button>
                  <button type="button" className="wide-button" onClick={() => onTask(selected.task.id)}>
                    Inspect task
                  </button>
                  <p className="quiet">The avatar represents this run. Historical workers remain parked.</p>
                </>
              ) : (
                <p>Select a recorded worker to inspect its execution.</p>
              )}
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
function RunRow({
  record: { task, run },
  selected,
  project,
  now,
  onSelect,
}: {
  record: RunRecord;
  selected: boolean;
  project?: string;
  now: number;
  onSelect(): void;
}) {
  return (
    <tr className={selected ? "selected" : ""}>
      <td>
        <button type="button" className="run-row-title" aria-pressed={selected} onClick={onSelect}>
          <img src="/assets/mf.worker.standard.portrait.r1.png" alt="" />
          <span>
            <strong>
              {run.role ?? run.stage}
              {run.workPackageId ? ` · ${run.workPackageId}` : ""}
            </strong>
            <small>{run.id}</small>
          </span>
        </button>
      </td>
      <td>
        <strong>{project ?? "Unregistered project"}</strong>
        <small>
          {task.id} · {task.title}
        </small>
      </td>
      <td>
        <span className="state-badge">
          {isActiveRun(task, run)
            ? "Running"
            : run.status === "running"
              ? "Historical / inactive"
              : run.status}
        </span>
      </td>
      <td>
        {modelLabel(run.model)}
        <small>{reasoningLabel(run.reasoning)}</small>
      </td>
      <td>{run.usage ? formatCount(run.usage.totalTokens) : "—"}</td>
      <td>{formatDuration(runTime(run, now, isActiveRun(task, run)))}</td>
    </tr>
  );
}
export function RunCoverage({ feed }: { feed: ReturnType<typeof useRunRecords> }) {
  return (
    <div className="run-coverage">
      <small>
        {feed.records.length} runs loaded across {feed.selected.length} tasks
        {feed.loading ? " · Refreshing…" : ""}. Counts describe loaded evidence.
      </small>
      {feed.selected.map((task) => (
        <div key={task.id}>
          {feed.entries[task.id]?.error && (
            <p role="alert" className="form-error">
              {task.id}: {feed.entries[task.id]?.error} · Earlier records may be stale.{" "}
              <button type="button" onClick={feed.retry}>
                Retry
              </button>
            </p>
          )}
          {feed.entries[task.id]?.page?.nextCursor && (
            <button type="button" onClick={() => void feed.more(task.id)}>
              Load earlier runs for {task.id}
            </button>
          )}
        </div>
      ))}
      {feed.hasMoreTasks && (
        <button type="button" className="wide-button" onClick={feed.loadTasks}>
          Load runs from more tasks
        </button>
      )}
    </div>
  );
}
