import {
  ArrowRight,
  CheckCircle,
  CircleNotch,
  FileCode,
  GitBranch,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import type { CSSProperties, ReactNode } from "react";
import type { RuntimeArtifact, RuntimeTask, StageId } from "../../domain";
import { Button } from "../Primitives";
import {
  formatUsage,
  type ObservatoryModel,
  type ObservatorySelection,
  type ObservatoryState,
} from "./model";

export function ObservatoryInspector({
  task,
  model,
  selection,
  onOpenArtifact,
  onOpenWorkspace,
  onDismiss,
}: {
  task: RuntimeTask;
  model: ObservatoryModel;
  selection: ObservatorySelection;
  onOpenArtifact: (artifact: RuntimeArtifact) => void;
  onOpenWorkspace: (stageId?: StageId) => void;
  onDismiss: () => void;
}) {
  if (selection.kind === "package") {
    const item = model.packages.find((candidate) => candidate.id === selection.id);
    if (item) {
      const usage = formatUsage(item.usage);
      const outputArtifact = item.outputArtifact;
      const inputArtifact = item.inputArtifact;
      return (
        <aside className="observatory-inspector" aria-label={`Selected package ${item.id}`}>
          <InspectorHeading
            label="Selected package"
            title={item.id}
            detail={item.title}
            state={item.state}
            onDismiss={onDismiss}
          />
          <InspectorGroup title="Dependency">
            <InspectorRow
              label="Requires"
              value={item.dependencies.length ? item.dependencies.join(" + ") : "Implementation plan"}
            />
            <InspectorRow
              label="Input"
              value={item.inputArtifact?.name ?? "No persisted input artifact"}
              mono
            />
            <InspectorRow
              label="Output"
              value={item.outputArtifact?.name ?? (item.state === "blocked" ? "Not produced" : "In progress")}
              mono
            />
            {item.error ? (
              <p className="observatory-inspector__error">
                <WarningCircle size={15} />
                {item.error}
              </p>
            ) : null}
          </InspectorGroup>
          <InspectorGroup title="Assigned agent">
            <InspectorRow label="Role" value={item.agent} />
            <InspectorRow label="Model" value={item.model} mono />
            <InspectorRow label="Reasoning" value={item.reasoning} />
            <InspectorRow label="Worktree" value={item.worktree ?? "Not created"} mono />
          </InspectorGroup>
          <InspectorGroup title="Observed usage">
            <InspectorRow label="Elapsed" value={item.elapsed} />
            <InspectorRow label="Input" value={usage.input} mono />
            <InspectorRow label="Output" value={usage.output} mono />
            <InspectorRow label="Cache rate" value={usage.cache} />
            <UsageMeters
              input={usage.input}
              output={usage.output}
              cache={usage.cache}
              cacheValue={item.usage ? item.usage.cachedInputTokens / Math.max(1, item.usage.inputTokens) : 0}
            />
          </InspectorGroup>
          <div className="observatory-inspector__actions">
            {outputArtifact ? (
              <Button tone="secondary" compact icon={FileCode} onClick={() => onOpenArtifact(outputArtifact)}>
                Open output
              </Button>
            ) : null}
            {inputArtifact ? (
              <Button tone="ghost" compact icon={FileCode} onClick={() => onOpenArtifact(inputArtifact)}>
                Open input
              </Button>
            ) : null}
            <Button tone="primary" compact icon={ArrowRight} onClick={() => onOpenWorkspace("implement")}>
              Package workspace
            </Button>
          </div>
        </aside>
      );
    }
  }

  if (selection.kind === "candidate" && model.candidate) {
    const candidate = model.candidate;
    return (
      <aside className="observatory-inspector" aria-label={`Selected candidate ${candidate.id}`}>
        <InspectorHeading
          label="Integration candidate"
          title={`${candidate.id} r${candidate.revision}`}
          detail="Exact downstream gate subject"
          state={candidate.state}
          onDismiss={onDismiss}
        />
        <InspectorGroup title="Candidate binding">
          <InspectorRow
            label="Head"
            value={candidate.headRevision?.slice(0, 12) ?? "Assembly pending"}
            mono
          />
          <InspectorRow
            label="Packages"
            value={candidate.members.length ? candidate.members.join(" \u2192 ") : "Pending assembly"}
          />
          <InspectorRow
            label="Prior revision"
            value={candidate.priorRevision ? `${candidate.id} r${candidate.priorRevision} retained` : "None"}
          />
        </InspectorGroup>
        <InspectorGroup title="Quality gates">
          {model.stages.slice(6).map((stage) => (
            <InspectorRow
              key={stage.id}
              label={stage.label}
              value={stateLabel(stage.state)}
              tone={stage.state}
            />
          ))}
        </InspectorGroup>
        <div className="observatory-inspector__actions">
          <Button tone="secondary" compact icon={GitBranch} onClick={() => onOpenWorkspace("implement")}>
            Candidate desk
          </Button>
          <Button tone="primary" compact icon={ArrowRight} onClick={() => onOpenWorkspace(nextGate(model))}>
            Open next gate
          </Button>
        </div>
      </aside>
    );
  }

  const stage =
    model.stages.find(
      (candidate) => candidate.id === (selection.kind === "stage" ? selection.id : model.activeStage.id),
    ) ?? model.activeStage;
  const stageArtifact = stage.artifact;
  return (
    <aside className="observatory-inspector" aria-label={`Selected stage ${stage.label}`}>
      <InspectorHeading
        label={`Stage ${stage.index + 1} of 10`}
        title={stage.label}
        detail={stage.id === task.currentStage ? "Current execution" : "Workflow stage"}
        state={stage.state}
        onDismiss={onDismiss}
      />
      <InspectorGroup title="Stage evidence">
        <InspectorRow label="State" value={stateLabel(stage.state)} tone={stage.state} />
        <InspectorRow label="Duration" value={stage.duration} />
        <InspectorRow label="Artifact" value={stage.artifact?.name ?? "No persisted artifact yet"} mono />
        <InspectorRow label="Task status" value={task.status.replaceAll("-", " ")} />
      </InspectorGroup>
      <InspectorGroup title="Handoff">
        <InspectorRow
          label="Input"
          value={
            stage.index
              ? (model.stages[stage.index - 1]?.artifact?.name ?? "Earlier retained state")
              : "Task brief"
          }
        />
        <InspectorRow label="Output" value={stage.artifact?.name ?? "Not produced"} />
      </InspectorGroup>
      <div className="observatory-inspector__actions">
        {stageArtifact ? (
          <Button tone="secondary" compact icon={FileCode} onClick={() => onOpenArtifact(stageArtifact)}>
            Open evidence
          </Button>
        ) : null}
        <Button tone="primary" compact icon={ArrowRight} onClick={() => onOpenWorkspace(stage.id)}>
          Stage workspace
        </Button>
      </div>
    </aside>
  );
}

function InspectorHeading({
  label,
  title,
  detail,
  state,
  onDismiss,
}: {
  label: string;
  title: string;
  detail: string;
  state: ObservatoryState;
  onDismiss: () => void;
}) {
  const Icon =
    state === "active"
      ? CircleNotch
      : state === "complete"
        ? CheckCircle
        : state === "blocked"
          ? WarningCircle
          : CircleNotch;
  return (
    <header className="observatory-inspector__heading">
      <span className="observatory-inspector__kicker">
        <small>{label}</small>
        <button type="button" onClick={onDismiss} aria-label="Close selection inspector">
          <X size={14} />
        </button>
      </span>
      <span>
        <strong>{title}</strong>
        <em className={`observatory-state-label observatory-state--${state}`}>
          <Icon size={13} className={state === "active" ? "spin" : undefined} />
          {stateLabel(state)}
        </em>
      </span>
      <p>{detail}</p>
    </header>
  );
}

function UsageMeters({
  input,
  output,
  cache,
  cacheValue,
}: {
  input: string;
  output: string;
  cache: string;
  cacheValue: number;
}) {
  return (
    <div className="observatory-usage-bars" aria-hidden="true">
      <span>
        <small>In</small>
        <i style={{ "--usage": "82%" } as CSSProperties} />
        <em>{input}</em>
      </span>
      <span>
        <small>Out</small>
        <i style={{ "--usage": "34%" } as CSSProperties} />
        <em>{output}</em>
      </span>
      <span>
        <small>Cache</small>
        <i style={{ "--usage": `${Math.round(cacheValue * 100)}%` } as CSSProperties} />
        <em>{cache}</em>
      </span>
    </div>
  );
}

function nextGate(model: ObservatoryModel): StageId {
  return model.stages.slice(6).find((stage) => stage.state !== "complete")?.id ?? "approval";
}

function InspectorGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="observatory-inspector__group">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function InspectorRow({
  label,
  value,
  mono,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: ObservatoryState;
}) {
  return (
    <span className="observatory-inspector__row">
      <small>{label}</small>
      <strong className={`${mono ? "mono" : ""}${tone ? ` observatory-state-text--${tone}` : ""}`}>
        {value}
      </strong>
    </span>
  );
}

function stateLabel(state: ObservatoryState) {
  return state === "complete"
    ? "Fresh"
    : state === "active"
      ? "In progress"
      : state === "blocked"
        ? "Blocked"
        : state === "stale"
          ? "Rerun required"
          : "Not started";
}
