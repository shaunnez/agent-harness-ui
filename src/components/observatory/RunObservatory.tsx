import {
  ArrowLeft,
  ArrowRight,
  Crosshair,
  Cube,
  Eye,
  Info,
  Pause,
  Play,
  SquaresFour,
  Waveform,
} from "@phosphor-icons/react";
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import type { RuntimeArtifact, RuntimeTask, StageId } from "../../domain";
import { Button, PriorityBadge } from "../Primitives";
import { MissionMap } from "./MissionMap";
import { buildObservatoryModel, defaultObservatorySelection, type ObservatorySelection } from "./model";
import { ObservatoryInspector } from "./ObservatoryInspector";
import { SignalLoom } from "./SignalLoom";

export type ObservatoryMode = "mission" | "loom";

export function RunObservatory({
  task,
  mode,
  onModeChange,
  onOpenWorkspace,
  onOpenArtifact,
}: {
  task: RuntimeTask;
  mode: ObservatoryMode;
  onModeChange: (mode: ObservatoryMode) => void;
  onOpenWorkspace: (stageId?: StageId) => void;
  onOpenArtifact: (artifact: RuntimeArtifact) => void;
}) {
  const model = useMemo(() => buildObservatoryModel(task), [task]);
  const [selection, setSelection] = useState<ObservatorySelection>(() => defaultObservatorySelection(model));
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [cameraMode, setCameraMode] = useState<"top" | "orbit">("top");
  const [replaying, setReplaying] = useState(false);
  const events = useMemo(() => [...task.events].sort((a, b) => a.at.localeCompare(b.at)), [task.events]);
  const timelineEvents = useMemo(() => {
    const stride = Math.max(1, Math.ceil(events.length / 58));
    return events
      .map((event, index) => ({ event, index }))
      .filter(({ index }) => index % stride === 0 || index === events.length - 1);
  }, [events]);
  const [eventIndex, setEventIndex] = useState(Math.max(0, events.length - 1));
  const activeEvent = events[eventIndex] ?? null;

  useEffect(() => {
    setEventIndex(Math.max(0, events.length - 1));
  }, [events.length]);

  useEffect(() => {
    const selectionExists =
      selection.kind === "stage"
        ? model.stages.some((item) => item.id === selection.id)
        : selection.kind === "package"
          ? model.packages.some((item) => item.id === selection.id)
          : model.candidate?.id === selection.id;
    if (!selectionExists) setSelection(defaultObservatorySelection(model));
  }, [model, selection]);

  useEffect(() => {
    if (!replaying || events.length < 2) return;
    const interval = window.setInterval(
      () => {
        setEventIndex((current) => {
          if (current >= events.length - 1) {
            setReplaying(false);
            return current;
          }
          return current + 1;
        });
      },
      reducedMotion ? 900 : 520,
    );
    return () => window.clearInterval(interval);
  }, [events.length, reducedMotion, replaying]);

  const returnToWorkspace = () => {
    onOpenWorkspace(selection.kind === "stage" ? selection.id : "implement");
  };
  const selectNode = (next: ObservatorySelection) => {
    setSelection(next);
    setInspectorOpen(true);
  };
  const followActive = () => {
    setSelection(defaultObservatorySelection(model));
    setInspectorOpen(true);
  };

  return (
    <div className={`run-observatory run-observatory--${mode}`} data-testid="run-observatory">
      <header className="observatory-header">
        <button
          type="button"
          className="icon-button"
          onClick={returnToWorkspace}
          aria-label="Back to task workspace"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="observatory-header__title">
          <span className="eyebrow">Live workflow</span>
          <h1>{mode === "mission" ? "Mission Map" : "Signal Loom"}</h1>
          <p>
            <strong className="mono">{task.id}</strong>
            <span>{task.title}</span>
          </p>
        </div>
        <PriorityBadge priority={task.priority} />
        <div className="observatory-header__actions">
          <Button tone="secondary" compact icon={Crosshair} onClick={followActive}>
            Follow active
          </Button>
          {mode === "mission" ? (
            <fieldset className="observatory-camera-switch">
              <legend className="sr-only">Camera view</legend>
              <button
                type="button"
                className={cameraMode === "top" ? "is-selected" : ""}
                onClick={() => setCameraMode("top")}
              >
                Top view
              </button>
              <button
                type="button"
                className={cameraMode === "orbit" ? "is-selected" : ""}
                onClick={() => setCameraMode("orbit")}
              >
                Orbit view
              </button>
            </fieldset>
          ) : (
            <Button
              tone="secondary"
              compact
              icon={replaying ? Pause : Play}
              disabled={events.length < 2}
              onClick={() => {
                if (!replaying && eventIndex >= events.length - 1) setEventIndex(0);
                setReplaying((value) => !value);
              }}
            >
              {replaying ? "Pause replay" : "Replay handoffs"}
            </Button>
          )}
          <Button
            tone="secondary"
            compact
            icon={paused ? Play : Pause}
            onClick={() => setPaused((value) => !value)}
          >
            {paused ? "Resume motion" : "Pause motion"}
          </Button>
          <Button tone="primary" compact icon={ArrowRight} onClick={returnToWorkspace}>
            Open workspace
          </Button>
        </div>
      </header>

      <section className="observatory-meta" aria-label="Live task metadata">
        <span>
          <i className="observatory-dot observatory-dot--green" />
          Status <strong>{task.status.replaceAll("-", " ")}</strong>
        </span>
        <span>
          <i className="observatory-dot observatory-dot--blue" />
          Stage <strong>{model.activeStage.label}</strong>
        </span>
        <span>
          Elapsed <strong className="mono">{model.elapsed}</strong>
        </span>
        <span>
          Candidate{" "}
          <strong className="mono">
            {model.candidate ? `${model.candidate.id} r${model.candidate.revision}` : "Not assembled"}
          </strong>
        </span>
        <span>
          Repository{" "}
          <strong className="mono">{task.repositoryPath.split(/[\\/]/).filter(Boolean).at(-1)}</strong>
        </span>
        <span>
          Branch <strong className="mono">{task.candidates.at(-1)?.baseBranch ?? "main"}</strong>
        </span>
        <span>
          Updated <strong>{formatDate(task.updatedAt)}</strong>
        </span>
      </section>

      <div className={`observatory-body${inspectorOpen ? "" : " is-inspector-collapsed"}`}>
        <main className="observatory-canvas">
          {mode === "mission" ? (
            <MissionMap
              model={model}
              taskId={task.id}
              selection={selection}
              reducedMotion={reducedMotion}
              paused={paused}
              cameraMode={cameraMode}
              onSelect={selectNode}
            />
          ) : (
            <SignalLoom
              model={model}
              selection={selection}
              reducedMotion={reducedMotion}
              paused={paused}
              onSelect={selectNode}
            />
          )}
        </main>
        {inspectorOpen ? (
          <ObservatoryInspector
            task={task}
            model={model}
            selection={selection}
            onOpenArtifact={onOpenArtifact}
            onOpenWorkspace={onOpenWorkspace}
            onDismiss={() => setInspectorOpen(false)}
          />
        ) : (
          <button
            type="button"
            className="observatory-inspector-launcher"
            onClick={() => setInspectorOpen(true)}
          >
            <Info size={15} /> Open selected evidence
          </button>
        )}
      </div>

      <footer className="observatory-footer">
        <section className="observatory-legend" aria-label="State legend">
          <span>
            <i className="observatory-dot observatory-dot--green" />
            Completed
          </span>
          <span>
            <i className="observatory-dot observatory-dot--blue" />
            Active
          </span>
          <span>
            <i className="observatory-dot observatory-dot--amber" />
            Waiting
          </span>
          <span>
            <i className="observatory-dot observatory-dot--red" />
            Blocked
          </span>
          <span>
            <i className="observatory-dot observatory-dot--stale" />
            Stale
          </span>
          <span>
            <Cube size={13} className="observatory-artifact-icon" />
            Artifact in transit
          </span>
        </section>
        <div className="observatory-timeline">
          <button
            type="button"
            className="observatory-live"
            onClick={() => {
              setEventIndex(Math.max(0, events.length - 1));
              setReplaying(false);
            }}
          >
            <i className="observatory-dot observatory-dot--green" />
            Live
          </button>
          <div className="observatory-timeline__track">
            <fieldset className="observatory-event-pips">
              <legend className="sr-only">Persisted workflow event markers</legend>
              {timelineEvents.map(({ event, index }) => (
                <button
                  type="button"
                  key={event.id}
                  className={`observatory-event-pip observatory-event-pip--${event.tone}`}
                  style={
                    {
                      "--event-position": `${events.length > 1 ? (index / (events.length - 1)) * 100 : 100}%`,
                    } as CSSProperties
                  }
                  title={`${formatTime(event.at)} · ${event.title}`}
                  aria-label={`Replay from ${event.title}`}
                  onClick={() => {
                    setEventIndex(index);
                    setReplaying(false);
                  }}
                />
              ))}
            </fieldset>
            <input
              aria-label="Replay persisted workflow events"
              type="range"
              min={0}
              max={Math.max(0, events.length - 1)}
              value={eventIndex}
              disabled={!events.length}
              onChange={(event) => {
                setEventIndex(Number(event.target.value));
                setReplaying(false);
              }}
            />
            <span>
              {activeEvent ? (
                <>
                  <time>{formatTime(activeEvent.at)}</time>
                  <strong>{activeEvent.title}</strong>
                </>
              ) : (
                "No persisted events yet"
              )}
            </span>
          </div>
          <button
            type="button"
            className="observatory-reduced"
            aria-pressed={reducedMotion}
            onClick={() => setReducedMotion((value) => !value)}
          >
            <Eye size={14} />
            Reduced motion <i className={reducedMotion ? "is-on" : ""} />
          </button>
          <div
            className="observatory-view-switch observatory-view-switch--footer"
            role="tablist"
            aria-label="Observatory view"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === "mission"}
              className={mode === "mission" ? "is-selected" : ""}
              onClick={() => onModeChange("mission")}
            >
              <SquaresFour size={15} /> Mission map
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "loom"}
              className={mode === "loom" ? "is-selected" : ""}
              onClick={() => onModeChange("loom")}
            >
              <Waveform size={15} /> Signal loom
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "\u2014"
    : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "\u2014"
    : date.toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" });
}
