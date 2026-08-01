import {
  ArrowsOut,
  CaretDown,
  CaretUp,
  CheckCircle,
  FileCode,
  Info,
  Pulse,
  WarningCircle,
  XCircle,
} from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { baseEvents, type EventCategory, type HarnessEvent, type TaskRunState } from "../domain";
import { Button, ProviderTag } from "./Primitives";

const filters: { id: Exclude<EventCategory, "events">; label: string }[] = [
  { id: "agents", label: "Agent runs" },
  { id: "tests", label: "Test runs" },
  { id: "decisions", label: "Decisions" },
];

export function LiveRun({
  onSelectEvent,
  selectedEventId,
  stageLabel,
  candidateId,
  runState,
}: {
  onSelectEvent: (event: HarnessEvent) => void;
  selectedEventId?: string;
  stageLabel: string;
  candidateId: string;
  runState: TaskRunState;
}) {
  const [filter, setFilter] = useState<EventCategory | "all">("all");
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const events = useMemo(() => {
    const runtimeEvent = getRuntimeEvent(runState, candidateId);
    return runtimeEvent ? [...baseEvents, runtimeEvent] : baseEvents;
  }, [candidateId, runState]);
  const visibleEvents = useMemo(() => {
    const filtered = filter === "all" ? events : events.filter((event) => event.category === filter);
    return filtered.slice(-(expanded ? 9 : 5));
  }, [events, expanded, filter]);
  const summary = getActivitySummary(runState, candidateId, stageLabel);
  const failureCount = runState === "failed" || runState === "blocked" ? 1 : 0;

  return (
    <section
      className={`live-run ${open ? "live-run--open" : ""} ${expanded ? "live-run--expanded" : ""}`}
      aria-label="Run activity"
    >
      <header className="live-run__summary">
        <div className="live-run__identity">
          <Pulse size={16} weight="bold" />
          <span>
            <strong>Run activity</strong>
            <small>Chronological telemetry · stage content remains the source of truth</small>
          </span>
        </div>
        <output className="live-run__latest" aria-live="polite">
          <span className={`connection-dot ${failureCount ? "connection-dot--danger" : ""}`} />
          <strong>{summary}</strong>
        </output>
        <div className="live-run__summary-meta">
          <span>2 agents</span>
          <span className={failureCount ? "text-red" : "text-green"}>{failureCount} failures</span>
        </div>
        <Button
          tone="ghost"
          compact
          icon={open ? CaretDown : CaretUp}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? "Collapse" : "Open activity"}
        </Button>
      </header>

      {open ? (
        <>
          <div className="live-run__toolbar">
            <div className="event-filters" role="tablist" aria-label="Activity filters">
              <button
                type="button"
                role="tab"
                aria-selected={filter === "all"}
                className={filter === "all" ? "active" : ""}
                onClick={() => setFilter("all")}
              >
                Activity
              </button>
              {filters.map((item) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={filter === item.id}
                  className={filter === item.id ? "active" : ""}
                  key={item.id}
                  onClick={() => setFilter(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="live-run__actions">
              <span className="autoscroll">
                <span className="connection-dot" />
                Auto-scroll
              </span>
              <Button tone="ghost" compact icon={ArrowsOut} onClick={() => setExpanded(!expanded)}>
                {expanded ? "Fit panel" : "Expand"}
              </Button>
            </div>
          </div>
          <div className="event-table">
            <div className="event-table__header">
              <span>Time</span>
              <span>Event</span>
              <span>Scope</span>
              <span>Model / agent</span>
              <span>Tokens / cost</span>
              <span>Duration</span>
              <span>Artifact</span>
            </div>
            {visibleEvents.length ? (
              visibleEvents.map((event) => (
                <EventRow
                  key={event.id}
                  event={event}
                  selected={event.id === selectedEventId}
                  onSelect={() => onSelectEvent(event)}
                />
              ))
            ) : (
              <div className="event-table__empty">No structured activity matches this filter.</div>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}

function EventRow({
  event,
  selected,
  onSelect,
}: {
  event: HarnessEvent;
  selected: boolean;
  onSelect: () => void;
}) {
  const EventIcon =
    event.tone === "success"
      ? CheckCircle
      : event.tone === "danger"
        ? XCircle
        : event.tone === "warning"
          ? WarningCircle
          : Info;
  return (
    <button
      type="button"
      className={`event-table__row ${selected ? "event-table__row--selected" : ""}`}
      onClick={onSelect}
    >
      <span className="mono event-time">{event.time}</span>
      <span className="event-title">
        <EventIcon className={`tone-${event.tone}`} size={16} weight="fill" />
        <span>
          <strong>{event.title}</strong>
          <small>
            {event.detail} · {event.component}
          </small>
        </span>
      </span>
      <span className="event-scope">{event.scope}</span>
      <ProviderTag provider={event.provider} model={event.model} />
      <span className="event-usage">
        <strong className="mono">{event.tokens}</strong>
        <small className="mono">{event.cost}</small>
      </span>
      <span className="mono">{event.duration}</span>
      <span className="artifact-link">
        <FileCode size={14} />
        {event.artifact}
      </span>
    </button>
  );
}

function getActivitySummary(runState: TaskRunState, candidateId: string, stageLabel: string) {
  if (runState === "repairing") return `${candidateId} assembling from repair packet PKT-0094`;
  if (runState === "failed") return `${candidateId} failed the API contract gate`;
  if (runState === "blocked") return `${candidateId} blocked after repair allowance was exhausted`;
  if (runState === "awaiting-approval") return `${candidateId} is ready for human approval`;
  if (runState === "completed") return `${candidateId} merged to main`;
  if (stageLabel === "Implement") return `${candidateId} assembling · 3 slices ready`;
  return `${stageLabel} is active · ${candidateId} remains the current candidate`;
}

function getRuntimeEvent(runState: TaskRunState, candidateId: string): HarnessEvent | null {
  if (runState === "repairing") {
    return {
      id: `runtime-${candidateId}-repair`,
      time: "12:28:14",
      category: "events",
      title: "Repair candidate created",
      detail: "PKT-0094 applied; affected review and test gates invalidated",
      component: "Integration orchestrator",
      scope: `Candidate ${candidateId}`,
      provider: "harness",
      model: "Deterministic",
      tokens: "—",
      cost: "$0.00",
      cache: "—",
      duration: "9s",
      artifact: "candidate-lineage.json",
      tone: "warning",
    };
  }
  if (runState === "failed" || runState === "blocked") {
    return {
      id: `runtime-${candidateId}-failed`,
      time: "12:30:02",
      category: "tests",
      title: "Candidate gate failed",
      detail: "API contract returned HTTP 201 instead of rejecting invalid priority",
      component: "Test harness",
      scope: `Candidate ${candidateId}`,
      provider: "harness",
      model: "Deterministic",
      tokens: "—",
      cost: "$0.04",
      cache: "—",
      duration: "8.2s",
      artifact: "junit.xml",
      tone: "danger",
    };
  }
  if (runState === "awaiting-approval") {
    return {
      id: `runtime-${candidateId}-approval`,
      time: "12:35:44",
      category: "events",
      title: "Candidate cleared all required gates",
      detail: "Dev Review, deterministic tests, and holdout review passed",
      component: "Approval orchestrator",
      scope: `Candidate ${candidateId}`,
      provider: "harness",
      model: "Deterministic",
      tokens: "—",
      cost: "$0.00",
      cache: "—",
      duration: "2s",
      artifact: "approval-packet.json",
      tone: "success",
    };
  }
  if (runState === "completed") {
    return {
      id: `runtime-${candidateId}-merged`,
      time: "12:37:10",
      category: "events",
      title: "Candidate merged",
      detail: "Squash merge completed against main@c842e1b",
      component: "Approval orchestrator",
      scope: `Candidate ${candidateId}`,
      provider: "harness",
      model: "Deterministic",
      tokens: "—",
      cost: "$0.00",
      cache: "—",
      duration: "4s",
      artifact: "merge-record.json",
      tone: "success",
    };
  }
  return null;
}
