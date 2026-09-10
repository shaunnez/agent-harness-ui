import { DownloadSimple } from "@phosphor-icons/react";
import { useState } from "react";
import type { RuntimeProject, RuntimeRun } from "../../domain";
import { usePanelState } from "../app/panel-state";
import type { FrontierGateway, TaskSummary } from "../runtime/contracts";
import {
  formatApproximateCost,
  formatCount,
  formatDuration,
  isActiveRun,
  modelLabel,
  reasoningLabel,
} from "../runtime/presentation";
import { useRunRecords } from "../runtime/run-records";
import { runTime, type sumRecorded, taskWallTime, usageTotals } from "../runtime/usage";
import { RunCoverage } from "./RunLibrary";

export function Usage({
  tasks,
  projects,
  gateway,
  connected,
  now,
  onTask,
  onWatch,
}: {
  tasks: TaskSummary[];
  projects: RuntimeProject[];
  gateway: FrontierGateway;
  connected: boolean;
  now: number;
  onTask(id: string): void;
  onWatch(taskId: string, runId: string): void;
}) {
  const [tab, setTab] = usePanelState("usage-tab", "tasks");
  const [project, setProject] = usePanelState("usage-project", "all");
  const [query, setQuery] = usePanelState("usage-query", "");
  const [model, setModel] = usePanelState("usage-model", "all");
  const [since, setSince] = usePanelState("usage-since", "");
  const [selection, select] = useState<string | null>(null);
  const [limit, setLimit] = useState(50);
  const scoped = tasks.filter(
    (task) =>
      (project === "all" ||
        projects.find((item) => item.id === project)?.repositoryPath === task.repositoryPath) &&
      `${task.id} ${task.title}`.toLowerCase().includes(query.toLowerCase()) &&
      (!since || Date.parse(task.updatedAt) >= Date.parse(`${since}T00:00:00`)),
  );
  const feed = useRunRecords(scoped, gateway, tab === "runs" && connected);
  const records = feed.records.filter(({ run }) => model === "all" || run.model === model);
  const totals = usageTotals(
    tab === "runs"
      ? records.map(({ run }) =>
          run.usage ? { ...run.usage, cost: run.apiEstimate, credits: run.credits } : null,
        )
      : scoped.map((task) => task.usage),
  );
  const selected = records.find(({ task, run }) => `${task.id}:${run.id}` === selection) ?? records[0];
  const exportRecords = () => {
    const data = {
      schema: "mission-frontier.usage.v1",
      exportedAt: new Date().toISOString(),
      source: gateway.mode,
      scope: { view: tab, project, query, since, model: tab === "runs" ? model : null },
      completeness:
        tab === "runs"
          ? {
              tasksLoaded: feed.selected.length,
              tasksInScope: scoped.length,
              runsLoaded: records.length,
              pages: feed.selected.map((task) => ({
                taskId: task.id,
                total: feed.entries[task.id]?.page?.total ?? null,
                nextCursor: feed.entries[task.id]?.page?.nextCursor ?? null,
                error: feed.entries[task.id]?.error ?? null,
              })),
            }
          : { taskSummaries: scoped.length },
      attributablePlanCharge: null,
      taskSummaries: scoped.map((task) => ({
        id: task.id,
        title: task.title,
        repositoryPath: task.repositoryPath,
        status: task.status,
        usage: task.usage,
        wallTimeMs: taskWallTime(task, now),
      })),
      runs: tab === "runs" ? records.map(({ task, run }) => ({ taskId: task.id, run })) : [],
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `mission-frontier-${tab}-usage.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const groups = [...new Set(scoped.map((task) => task.repositoryPath))].map((path) => ({
    path,
    tasks: scoped.filter((task) => task.repositoryPath === path),
  }));
  return (
    <div className="overlay-body usage-body">
      <div className="library-filters">
        <select
          aria-label="Usage project"
          value={project}
          onChange={(event) => setProject(event.target.value)}
        >
          <option value="all">All projects</option>
          {projects.map((item) => (
            <option value={item.id} key={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <input
          aria-label="Usage task search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search task ID or title"
        />
        <label>
          Task updated since
          <input type="date" value={since} onChange={(event) => setSince(event.target.value)} />
        </label>
        <button type="button" onClick={exportRecords}>
          <DownloadSimple size={19} />
          Export retrieved records
        </button>
      </div>
      <section className="usage-overview">
        <div className="usage-metrics">
          <UsageMetric label="Input" metric={totals.input} />
          <UsageMetric label="Cached input" metric={totals.cached} />
          <UsageMetric label="Output" metric={totals.output} />
          <div>
            <small>Cache rate</small>
            <strong>{totals.cacheRate == null ? "—" : `${Math.round(totals.cacheRate * 100)}%`}</strong>
          </div>
          <UsageMetric label="Approx. cost" metric={totals.cost} money />
          <UsageMetric label="Work credits" metric={totals.credits} />
        </div>
        <p className="quiet">
          {tab === "runs" ? "Loaded run records" : "Task summary totals"} · API-rate estimate from identified
          rate cards. Attributable ChatGPT-plan charges are unavailable. Missing telemetry is shown as —.
        </p>
      </section>
      <nav className="tab-bar" aria-label="Usage views">
        {["projects", "tasks", "runs"].map((id) => (
          <button type="button" key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>
            {id[0]?.toUpperCase()}
            {id.slice(1)}
          </button>
        ))}
      </nav>
      {tab === "runs" && (
        <div className="library-filters">
          <select aria-label="Usage model" value={model} onChange={(event) => setModel(event.target.value)}>
            <option value="all">All loaded models</option>
            {model !== "all" && !feed.records.some(({ run }) => run.model === model) && (
              <option value={model}>{modelLabel(model)} · no loaded records</option>
            )}
            {[
              ...new Set(
                feed.records.map(({ run }) => run.model).filter((value): value is string => Boolean(value)),
              ),
            ].map((id) => (
              <option key={id} value={id}>
                {modelLabel(id)}
              </option>
            ))}
          </select>
          <button type="button" disabled={!connected || feed.loading} onClick={feed.retry}>
            Refresh runs
          </button>
          <small>Agent times may overlap. They are not task wall time.</small>
        </div>
      )}
      <div className={tab === "runs" ? "library-columns" : "usage-table-layout"}>
        <div className="library-table-scroll">
          <table className="record-table">
            <thead>
              <tr>
                <th>{tab === "projects" ? "Project" : "Task"}</th>
                {tab === "runs" && (
                  <>
                    <th>Role / model</th>
                    <th>State</th>
                  </>
                )}
                <th>Input</th>
                <th>Cached</th>
                <th>Output</th>
                <th>{tab === "runs" ? "Agent time" : tab === "tasks" ? "Task wall time" : "Tasks"}</th>
                <th>Approx. cost</th>
              </tr>
            </thead>
            <tbody>
              {tab === "projects"
                ? groups.map((group) => {
                    const usage = usageTotals(group.tasks.map((task) => task.usage));
                    return (
                      <tr key={group.path}>
                        <td>
                          <strong>
                            {projects.find((item) => item.repositoryPath === group.path)?.name ??
                              "Unregistered project"}
                          </strong>
                          <small>{group.path}</small>
                        </td>
                        <td>{metricText(usage.input)}</td>
                        <td>{metricText(usage.cached)}</td>
                        <td>{metricText(usage.output)}</td>
                        <td>{group.tasks.length}</td>
                        <td>{metricText(usage.cost, true)}</td>
                      </tr>
                    );
                  })
                : tab === "tasks"
                  ? scoped.slice(0, limit).map((task) => (
                      <tr key={task.id}>
                        <td>
                          <button type="button" className="plain-link" onClick={() => onTask(task.id)}>
                            {task.id} · {task.title}
                          </button>
                          <small>{task.status}</small>
                        </td>
                        <td>{formatCount(task.usage.inputTokens)}</td>
                        <td>{formatCount(task.usage.cachedInputTokens)}</td>
                        <td>{formatCount(task.usage.outputTokens)}</td>
                        <td>{formatDuration(taskWallTime(task, now))}</td>
                        <td>{formatApproximateCost(task.usage.cost, task.usage.pricingVersion)}</td>
                      </tr>
                    ))
                  : records.map(({ task, run }) => (
                      <tr
                        key={`${task.id}:${run.id}`}
                        className={selected?.run.id === run.id ? "selected" : ""}
                      >
                        <td>
                          <button
                            type="button"
                            className="plain-link"
                            onClick={() => select(`${task.id}:${run.id}`)}
                          >
                            {task.id} · {task.title}
                          </button>
                          <small>{run.id}</small>
                        </td>
                        <td>
                          {run.role ?? run.stage}
                          <small>
                            {modelLabel(run.model)} · {reasoningLabel(run.reasoning)}
                          </small>
                        </td>
                        <td>{run.status}</td>
                        <td>{run.usage ? formatCount(run.usage.inputTokens) : "—"}</td>
                        <td>{run.usage ? formatCount(run.usage.cachedInputTokens) : "—"}</td>
                        <td>{run.usage ? formatCount(run.usage.outputTokens) : "—"}</td>
                        <td>{formatDuration(runTime(run, now, isActiveRun(task, run)))}</td>
                        <td>{formatApproximateCost(run.apiEstimate, run.usage?.pricingVersion)}</td>
                      </tr>
                    ))}
            </tbody>
          </table>
          {tab === "runs" ? (
            <>
              <RunCoverage feed={feed} />
              {!records.length && (
                <p>{feed.loading ? "Loading run usage…" : "No matching run records loaded."}</p>
              )}
            </>
          ) : (
            <>
              <p className="quiet">
                {scoped.length} task summaries in scope. Task wall time spans task start to completion; it is
                separate from summed agent runtime.
              </p>
              {!scoped.length && <p>No tasks match these filters.</p>}
              {tab === "tasks" && scoped.length > limit && (
                <button type="button" onClick={() => setLimit(limit + 50)}>
                  Show more tasks
                </button>
              )}
            </>
          )}
        </div>
        {tab === "runs" && (
          <aside className="record-inspector">
            {selected ? (
              <>
                <h2>Selected run</h2>
                <h3>
                  {selected.task.id} · {selected.run.role ?? selected.run.stage}
                </h3>
                <RunUsageDetail run={selected.run} task={selected.task} now={now} />
                <button
                  type="button"
                  className="primary wide-button"
                  onClick={() => onWatch(selected.task.id, selected.run.id)}
                >
                  Open run activity
                </button>
                <button type="button" className="wide-button" onClick={() => onTask(selected.task.id)}>
                  Inspect task
                </button>
              </>
            ) : (
              <p>Select a run to inspect its recorded usage.</p>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
function RunUsageDetail({ run, task, now }: { run: RuntimeRun; task: TaskSummary; now: number }) {
  return (
    <dl>
      <dt>Run ID</dt>
      <dd>{run.id}</dd>
      <dt>Started</dt>
      <dd>{run.startedAt ? new Date(run.startedAt).toLocaleString() : "Not recorded"}</dd>
      <dt>Finished</dt>
      <dd>{run.completedAt ? new Date(run.completedAt).toLocaleString() : "Not recorded"}</dd>
      <dt>Task wall time</dt>
      <dd>{formatDuration(taskWallTime(task, now))}</dd>
      <dt>Agent runtime</dt>
      <dd>{formatDuration(runTime(run, now, isActiveRun(task, run)))}</dd>
      <dt>Rate card</dt>
      <dd>{run.usage?.pricingVersion ?? "Unavailable"}</dd>
      <dt>Gate verdict</dt>
      <dd>{run.gateResult?.verdict ?? "No recorded gate verdict"}</dd>
      <dt>Repair lineage</dt>
      <dd>{run.repairOfRunId ?? run.retryOfRunId ?? "No preceding repair/retry recorded"}</dd>
      <dt>Credits</dt>
      <dd>{run.credits ?? "Unavailable"}</dd>
    </dl>
  );
}
function metricText(metric: ReturnType<typeof sumRecorded>, money = false) {
  return metric.value == null
    ? "—"
    : `${money ? `$${metric.value.toFixed(4)}` : formatCount(metric.value)}${metric.known < metric.total ? " (partial)" : ""}`;
}
function UsageMetric({
  label,
  metric,
  money = false,
}: {
  label: string;
  metric: ReturnType<typeof sumRecorded>;
  money?: boolean;
}) {
  return (
    <div>
      <small>{label}</small>
      <strong>{metricText(metric, money)}</strong>
      {metric.total > 0 && metric.known < metric.total && (
        <small>
          {metric.known}/{metric.total} records have this value
        </small>
      )}
    </div>
  );
}
