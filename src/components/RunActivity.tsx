import { ArrowSquareOut, Robot } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getTaskActivity, getTaskRuns } from "../api";
import {
  formatApproximateCost,
  formatTokenCount,
  type RuntimeArtifact,
  type RuntimeEvent,
  type RuntimeRun,
  type RuntimeTask,
  workflowStages,
} from "../domain";
import { RetryGrantAudit } from "./runtime/RetryGrantAudit";
import "./run-activity.css";

export type RunActivityFilter = "activity" | "agent" | "test" | "decision" | "tool";

type ActivityItem = {
  id: string;
  kind: "event" | "run";
  at: string | null;
  title: string;
  detail: string;
  tone: RuntimeEvent["tone"];
  stage: string;
  event?: RuntimeEvent;
  run?: RuntimeRun;
};

const FILTERS: Array<[RunActivityFilter, string]> = [
  ["activity", "Activity"],
  ["agent", "Agent runs"],
  ["test", "Test runs"],
  ["decision", "Decisions"],
  ["tool", "Tool calls"],
];

export function filterRunActivity(task: RuntimeTask, filter: RunActivityFilter): ActivityItem[] {
  const runsById = new Map((task.runs ?? []).map((run) => [run.id, run]));
  if (filter === "agent" || filter === "test") {
    return [...(task.runs ?? [])]
      .filter((run) =>
        filter === "test" ? run.stage === "test" || run.kind === "test" : run.stage !== "test",
      )
      .reverse()
      .map((run) => {
        const presentation = freshnessPresentation(
          runLabel(run),
          runDetail(run),
          runTone(run),
          run.freshness,
        );
        return {
          id: `run:${run.id}`,
          kind: "run" as const,
          at: run.startedAt,
          ...presentation,
          stage: run.stage,
          run,
        };
      });
  }

  return [...task.events]
    .filter((event) => {
      if (filter === "activity") return true;
      if (filter === "decision")
        return event.category === "decision" || Boolean(event.decisionId || event.approvalId);
      return Boolean(event.toolCall);
    })
    .reverse()
    .map((event) => {
      const linkedRun = event.runId ? runsById.get(event.runId) : null;
      const presentation = freshnessPresentation(
        event.title,
        event.detail,
        event.tone,
        event.freshness ?? linkedRunFreshness(event, linkedRun),
      );
      return {
        id: `event:${event.id}`,
        kind: "event" as const,
        at: event.at,
        ...presentation,
        stage: event.stage,
        event,
      };
    });
}

function linkedRunFreshness(event: RuntimeEvent, linkedRun: RuntimeRun | null | undefined) {
  const freshness = linkedRun?.freshness;
  if (!freshness || linkedRun.stage !== event.stage || freshness.stage !== event.stage) return null;
  if (event.runId !== linkedRun.id || freshness.sourceRunId !== linkedRun.id) return null;
  if (event.artifactId && freshness.sourceArtifactId !== event.artifactId) return null;
  return freshness;
}

export function RunActivity({
  task,
  onOpenArtifact,
  initialFilter = "activity",
  initialSelectedId = null,
}: {
  task: RuntimeTask;
  onOpenArtifact?: (artifact: RuntimeArtifact) => void;
  initialFilter?: RunActivityFilter;
  initialSelectedId?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<RunActivityFilter>(initialFilter);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [pagedEvents, setPagedEvents] = useState<RuntimeEvent[]>(task.events);
  const [pagedRuns, setPagedRuns] = useState<RuntimeRun[]>(task.runs ?? []);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const pagedTask = useMemo(
    () => ({
      ...task,
      events: [...pagedEvents].sort((left, right) => left.at.localeCompare(right.at)),
      runs: [...pagedRuns].sort((left, right) =>
        (left.startedAt ?? left.completedAt ?? "").localeCompare(right.startedAt ?? right.completedAt ?? ""),
      ),
    }),
    [pagedEvents, pagedRuns, task],
  );
  const items = useMemo(() => filterRunActivity(pagedTask, filter), [pagedTask, filter]);
  const latestActivity = useMemo(() => filterRunActivity(task, "activity")[0] ?? null, [task]);
  const selected = items.find((item) => item.id === selectedId) ?? null;
  const selectedRun =
    selected?.run ??
    (selected?.event?.runId ? task.runs?.find((run) => run.id === selected.event?.runId) : null);
  const selectedArtifactId = selectedRun?.artifactId ?? selected?.event?.artifactId ?? null;
  const selectedArtifact = selectedArtifactId
    ? (task.artifacts.find((artifact) => artifact.id === selectedArtifactId) ?? null)
    : null;
  const activityVersion = task.updatedAt;

  const loadPage = useCallback(
    async (cursor: string | null, append: boolean) => {
      setLoading(true);
      setLoadError(null);
      try {
        if (filter === "agent" || filter === "test") {
          const page = await getTaskRuns(task.id, { cursor, limit: 60, filter });
          setPagedRuns((current) => (append ? mergePage(current, page.items) : page.items));
          setPagedEvents([]);
          setNextCursor(page.nextCursor);
          setTotal(page.total);
        } else {
          const page = await getTaskActivity(task.id, {
            cursor,
            limit: 60,
            filter: filter === "decision" ? "decision" : "all",
          });
          setPagedEvents((current) => (append ? mergePage(current, page.items) : page.items));
          setPagedRuns([]);
          setNextCursor(page.nextCursor);
          setTotal(page.total);
        }
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "Run activity could not be loaded.");
      } finally {
        setLoading(false);
      }
    },
    [filter, task.id],
  );

  useEffect(() => {
    if (!open || !activityVersion) return;
    void loadPage(null, false);
  }, [activityVersion, loadPage, open]);

  const selectFilter = (next: RunActivityFilter) => {
    setFilter(next);
    setSelectedId(null);
  };

  const selectRelatedRun = (runId: string | null | undefined) => {
    if (!runId) return;
    const related = task.runs?.find((run) => run.id === runId);
    setFilter(related?.stage === "test" || related?.kind === "test" ? "test" : "agent");
    setSelectedId(`run:${runId}`);
  };

  return (
    <details className="runtime-activity" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <span>
          <Robot size={16} />
          <strong>Run activity</strong>
          <small>
            Persisted runs, tools, artifacts, tests, approvals, and decisions ·{" "}
            {task.eventCount ?? task.events.length} events · {task.runCount ?? task.runs?.length ?? 0} runs
          </small>
        </span>
        <span>
          <span className="connection-dot" />
          {latestActivity?.title ?? "Waiting to start"}
        </span>
      </summary>
      <div className="runtime-activity-filters" role="tablist" aria-label="Run activity filters">
        {FILTERS.map(([id, label]) => (
          <button
            type="button"
            role="tab"
            aria-selected={filter === id}
            className={filter === id ? "selected" : ""}
            key={id}
            onClick={() => selectFilter(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="runtime-activity-layout">
        <div className="runtime-activity-list" aria-live="polite">
          {items.length ? (
            items.map((item) => (
              <button
                type="button"
                className={`runtime-activity-row runtime-activity-row--${item.tone}${selectedId === item.id ? " is-selected" : ""}`}
                key={item.id}
                onClick={() => setSelectedId(item.id)}
                aria-pressed={selectedId === item.id}
              >
                <time className="mono">{formatTime(item.at)}</time>
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.detail}</small>
                  {item.event ? <RetryGrantAudit audit={item.event} /> : null}
                </span>
                <em>{stageLabel(item.stage)}</em>
              </button>
            ))
          ) : (
            <div className="runtime-activity-empty">
              {loading
                ? "Loading retained activity…"
                : (loadError ?? "No persisted data matches this filter.")}
            </div>
          )}
          {nextCursor ? (
            <button
              type="button"
              className="run-activity-link"
              disabled={loading}
              onClick={() => void loadPage(nextCursor, true)}
            >
              {loading ? "Loading…" : `Load older · ${items.length} of ${total}`}
            </button>
          ) : null}
        </div>
        {selected ? (
          <aside className="run-activity-detail" aria-label="Run activity detail">
            <header>
              <span>
                <small>{selected.kind === "run" ? "Run drilldown" : "Event drilldown"}</small>
                <strong>{selected.title}</strong>
              </span>
              <button type="button" onClick={() => setSelectedId(null)} aria-label="Close activity detail">
                ×
              </button>
            </header>
            <p>{selected.detail}</p>
            <dl>
              <Detail label="Stage" value={stageLabel(selected.stage)} />
              <Detail label="Recorded" value={formatDate(selected.at)} />
              {selectedRun ? <RunDetails run={selectedRun} /> : null}
              {selected.event?.decisionId ? (
                <Detail label="Decision ID" value={selected.event.decisionId} mono />
              ) : null}
              {selected.event?.approvalId ? (
                <Detail label="Approval ID" value={selected.event.approvalId} mono />
              ) : null}
              {selected.event?.toolCall ? <ToolDetails toolCall={selected.event.toolCall} /> : null}
            </dl>
            {selected.event ? <RetryGrantAudit audit={selected.event} /> : null}
            {selectedRun?.retryOfRunId ? (
              <button
                className="run-activity-link"
                type="button"
                onClick={() => selectRelatedRun(selectedRun.retryOfRunId)}
              >
                Previous attempt <span className="mono">{shortId(selectedRun.retryOfRunId)}</span>
              </button>
            ) : null}
            {selectedRun?.repairOfRunId ? (
              <button
                className="run-activity-link"
                type="button"
                onClick={() => selectRelatedRun(selectedRun.repairOfRunId)}
              >
                Repairs run <span className="mono">{shortId(selectedRun.repairOfRunId)}</span>
              </button>
            ) : null}
            {selectedArtifact && onOpenArtifact ? (
              <button
                className="run-activity-link"
                type="button"
                onClick={() => onOpenArtifact(selectedArtifact)}
              >
                Open {selectedArtifact.name} <ArrowSquareOut size={14} />
              </button>
            ) : null}
          </aside>
        ) : null}
      </div>
    </details>
  );
}

function RunDetails({ run }: { run: RuntimeRun }) {
  return (
    <>
      <Detail label="Run ID" value={run.id} mono />
      <Detail label="Kind / status" value={`${run.kind} · ${run.status}`} />
      <Detail label="Role" value={run.role ?? "Unavailable"} />
      <Detail
        label="Model / reasoning"
        value={run.model ? `${run.model} · ${run.reasoning ?? "reasoning unavailable"}` : "Unavailable"}
      />
      <Detail label="Started" value={formatDate(run.startedAt)} />
      <Detail
        label="Ended / duration"
        value={`${formatDate(run.completedAt)} · ${formatDuration(run.durationMs)}`}
      />
      <Detail
        label="Usage"
        value={
          run.usage
            ? `${formatTokenCount(run.usage.inputTokens)} input · ${formatTokenCount(run.usage.outputTokens)} output · ${formatTokenCount(run.usage.cachedInputTokens)} cached`
            : "Unavailable"
        }
      />
      <Detail label="Credits" value={run.credits == null ? "Unavailable" : run.credits.toFixed(3)} />
      <Detail label="API-rate estimate" value={formatApproximateCost(run.apiEstimate)} />
      {run.candidateId ? (
        <Detail label="Candidate" value={`${run.candidateId} revision ${run.candidateRevision ?? "?"}`} />
      ) : null}
      {run.freshness ? (
        <Detail label="Evidence freshness" value={run.freshness.fresh ? "Fresh" : "Rerun required"} />
      ) : null}
      {run.freshness && !run.freshness.fresh ? (
        <Detail label="Stale reason" value={run.freshness.reasonCopy} />
      ) : null}
      {run.workPackageId ? <Detail label="Work package" value={run.workPackageId} /> : null}
      {run.test ? <Detail label="Focused tests" value={formatFocusedTestSummary(run.test)} /> : null}
      {run.error ? <Detail label="Error" value={run.error} /> : null}
      {run.toolCalls.length ? (
        <Detail label="Tool calls" value={`${run.toolCalls.length} captured from Codex JSONL`} />
      ) : null}
    </>
  );
}

function formatFocusedTestSummary(test: RuntimeRun["test"] & object) {
  const failedRowCount = Array.isArray(test.failedRowIds) ? test.failedRowIds.length : null;
  return `${test.status} · ${test.rowCount} row${test.rowCount === 1 ? "" : "s"}${
    failedRowCount == null
      ? " · failed count unavailable"
      : failedRowCount > 0
        ? ` · ${failedRowCount} failed`
        : ""
  }`;
}

function ToolDetails({ toolCall }: { toolCall: NonNullable<RuntimeEvent["toolCall"]> }) {
  return (
    <>
      <Detail label="Tool" value={toolCall.name} mono />
      <Detail
        label="Category"
        value={toolCall.server ? `${toolCall.category} · ${toolCall.server}` : toolCall.category}
      />
      <Detail label="Result" value={toolCall.result ?? "Not exposed in this event"} />
    </>
  );
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={mono ? "mono" : ""}>{value}</dd>
    </div>
  );
}

function mergePage<T extends { id: string }>(current: T[], incoming: T[]) {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()];
}

function runLabel(run: RuntimeRun) {
  const role = run.role ?? run.kind;
  return `${role} · attempt ${run.attempt ?? "historical"}`;
}

function runDetail(run: RuntimeRun) {
  const policy = run.model
    ? `${run.model} · ${run.reasoning ?? "reasoning unavailable"}`
    : "Policy unavailable";
  return `${run.status} · ${policy} · ${formatDuration(run.durationMs)}`;
}

function runTone(run: RuntimeRun): RuntimeEvent["tone"] {
  if (["failed", "cancelled", "interrupted"].includes(run.status)) return "danger";
  return run.status === "running" ? "info" : run.gateResult?.verdict === "REPAIR" ? "warning" : "success";
}

function freshnessPresentation(
  title: string,
  detail: string,
  tone: RuntimeEvent["tone"],
  freshness: RuntimeRun["freshness"] | RuntimeEvent["freshness"],
) {
  if (!freshness || freshness.fresh) return { title, detail, tone };
  return {
    title: `${title} · Rerun required`,
    detail: `${detail} · ${freshness.reasonCopy}`,
    tone: "warning" as const,
  };
}

function stageLabel(stage: string) {
  return workflowStages.find((item) => item.id === stage)?.shortLabel ?? stage;
}

function formatTime(value: string | null) {
  if (!value || Number.isNaN(new Date(value).getTime())) return "—";
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDate(value: string | null) {
  if (!value || Number.isNaN(new Date(value).getTime())) return "Unavailable";
  return new Date(value).toLocaleString();
}

function formatDuration(value: number | null) {
  if (value == null) return "Duration unavailable";
  if (value < 1_000) return `${value}ms`;
  if (value < 60_000) return `${(value / 1_000).toFixed(1)}s`;
  return `${Math.floor(value / 60_000)}m ${Math.floor((value % 60_000) / 1_000)}s`;
}

function shortId(value: string) {
  return value.length > 14 ? `${value.slice(0, 12)}…` : value;
}
