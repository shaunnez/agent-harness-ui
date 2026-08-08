import type { CSSProperties } from "react";
import type { ObservatoryModel, ObservatorySelection, ObservatoryState } from "./model";

const STAGE_POSITIONS = [
  [14, 35],
  [22, 25],
  [31, 19],
  [40, 17],
  [49, 21],
] as const;
const GATE_POSITIONS = [
  [62, 79],
  [73, 79],
  [84, 78],
  [94, 73],
] as const;

export function MissionMapLabels({
  model,
  taskId,
  selection,
  onSelect,
}: {
  model: ObservatoryModel;
  taskId: string;
  selection: ObservatorySelection;
  onSelect: (selection: ObservatorySelection) => void;
}) {
  return (
    <>
      <nav className="mission-map__labels" aria-label="Mission topology">
        <span className="mission-map__core-label">
          <small>Task core</small>
          <strong>{taskId}</strong>
          <em>Live evidence field</em>
        </span>
        {model.stages.slice(0, 5).map((stage, index) => (
          <MapNode
            key={stage.id}
            label={`${index + 1} ${stage.label}`}
            detail={stage.duration}
            state={stage.state}
            selected={selection.kind === "stage" && selection.id === stage.id}
            style={positionStyle(STAGE_POSITIONS[index] ?? [20, 20])}
            onClick={() => onSelect({ kind: "stage", id: stage.id })}
          />
        ))}
        <section className="mission-map__package-cluster" aria-label="Implementation packages">
          <span>Implementation constellation</span>
          {model.packages.length ? (
            model.packages.map((item) => (
              <MapNode
                key={item.id}
                label={item.id}
                detail={`${item.title} · ${stateLabel(item.state)}`}
                state={item.state}
                selected={selection.kind === "package" && selection.id === item.id}
                onClick={() => onSelect({ kind: "package", id: item.id })}
              />
            ))
          ) : (
            <small>Packages appear after the implementation plan is approved.</small>
          )}
        </section>
        {model.candidate ? (
          <MapNode
            label={`${model.candidate.id} r${model.candidate.revision}`}
            detail={`Integration candidate · ${model.candidate.headRevision?.slice(0, 8) ?? "assembling"}`}
            state={model.candidate.state}
            selected={selection.kind === "candidate"}
            style={positionStyle([43, 76])}
            featured
            onClick={() => {
              const candidate = model.candidate;
              if (candidate) onSelect({ kind: "candidate", id: candidate.id });
            }}
          />
        ) : null}
        {model.stages.slice(6).map((stage, index) => (
          <MapNode
            key={stage.id}
            label={`${index + 7} ${stage.label}`}
            detail={stateLabel(stage.state)}
            state={stage.state}
            selected={selection.kind === "stage" && selection.id === stage.id}
            style={positionStyle(GATE_POSITIONS[index] ?? [70, 78])}
            onClick={() => onSelect({ kind: "stage", id: stage.id })}
          />
        ))}
      </nav>
      <div className="mission-map__instructions">
        <span>Drag to orbit</span>
        <span>Scroll to zoom</span>
        <span>Select any node for evidence and actions</span>
      </div>
    </>
  );
}

function MapNode({
  label,
  detail,
  state,
  selected,
  featured,
  style,
  onClick,
}: {
  label: string;
  detail: string;
  state: ObservatoryState;
  selected: boolean;
  featured?: boolean;
  style?: CSSProperties;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`mission-node observatory-state--${state}${selected ? " is-selected" : ""}${featured ? " is-featured" : ""}`}
      style={style}
      onClick={onClick}
      aria-pressed={selected}
    >
      <i aria-hidden />
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
    </button>
  );
}

function positionStyle(position: readonly [number, number]) {
  return { left: `${position[0]}%`, top: `${position[1]}%` } satisfies CSSProperties;
}

function stateLabel(state: ObservatoryState) {
  return state === "complete"
    ? "Done"
    : state === "active"
      ? "Running"
      : state === "blocked"
        ? "Blocked"
        : state === "stale"
          ? "Stale"
          : "Waiting";
}
