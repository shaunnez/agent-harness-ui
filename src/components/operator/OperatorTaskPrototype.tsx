import {
  Archive,
  ArrowLeft,
  Check,
  CheckCircle,
  CircleNotch,
  FileText,
  Pause,
  Play,
  ShieldCheck,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { type StageId, workflowStages } from "../../domain";
import { Button } from "../Primitives";
import { OperatorStageView } from "./OperatorStageViews";
import {
  type OperatorPreviewState,
  operatorPreviewStates,
  operatorStageDefinitions,
} from "./operatorPrototypeData";

export function OperatorTaskPrototype({ onExit }: { onExit: () => void }) {
  const [stageId, setStageId] = useState<StageId>("implement");
  const [view, setView] = useState<"operator" | "evidence">("operator");
  const [previewState, setPreviewState] = useState<OperatorPreviewState>("running");
  const [notice, setNotice] = useState<string | null>(null);
  const stageIndex = workflowStages.findIndex((stage) => stage.id === stageId);
  const definition = operatorStageDefinitions[stageId];
  const stateCopy = useMemo(() => previewStatePresentation(previewState), [previewState]);
  const stateOverride =
    previewState === defaultPreviewState(stageId) ? null : previewStateOverride(previewState);
  const briefing = stateOverride
    ? definition.briefing.map((item, index) => {
        if (index === 0)
          return {
            ...item,
            value: stateCopy.label,
            detail: "Representative visual QA state",
            tone: stateCopy.tone,
          };
        if (index === 1)
          return {
            ...item,
            value: stateOverride.health,
            detail: stateOverride.reason,
            tone: stateCopy.tone,
          };
        if (index === 4)
          return {
            ...item,
            value: stateOverride.action,
            detail: stateOverride.actionDetail,
            tone: stateCopy.tone,
          };
        return item;
      })
    : definition.briefing;
  const primaryAction = stateOverride?.action ?? definition.nextAction;
  const handoff = stateOverride?.handoff ?? definition.handoff;
  const StateIcon = stateCopy.icon;

  const selectStage = (nextStage: StageId) => {
    setStageId(nextStage);
    setNotice(null);
    setPreviewState(defaultPreviewState(nextStage));
  };

  const act = (message = `${definition.nextAction} selected. This preview did not mutate task data.`) => {
    setNotice(message);
  };

  return (
    <div className="operator-prototype">
      <header className="operator-prototype__header">
        <button type="button" className="icon-button" aria-label="Exit operator prototype" onClick={onExit}>
          <ArrowLeft size={18} />
        </button>
        <div className="operator-prototype__identity">
          <span className="mono">AH-P01</span>
          <h1>Reduce operator fatigue across the task journey</h1>
        </div>
        <span className="badge badge--medium">medium</span>
        <span className={`operator-prototype__state operator-prototype__state--${stateCopy.tone}`}>
          <StateIcon size={14} weight="fill" />
          {stateCopy.label}
        </span>
        <div className="operator-prototype__meta">
          <span>
            <small>Repository</small>
            <strong>agent-harness-ui</strong>
          </span>
          <span>
            <small>Stage</small>
            <strong>{stageIndex + 1} / 10</strong>
          </span>
          <span>
            <small>Attempts</small>
            <strong>1 / 3</strong>
          </span>
        </div>
        <fieldset className="operator-view-toggle">
          <legend className="sr-only">Workspace detail level</legend>
          <button
            type="button"
            className={view === "operator" ? "is-selected" : ""}
            aria-pressed={view === "operator"}
            onClick={() => setView("operator")}
          >
            Operator
          </button>
          <button
            type="button"
            className={view === "evidence" ? "is-selected" : ""}
            aria-pressed={view === "evidence"}
            onClick={() => setView("evidence")}
          >
            Evidence
          </button>
        </fieldset>
        <div className="operator-prototype__actions">
          <Button compact icon={Archive}>
            Archive
          </Button>
          <Button compact icon={Pause} disabled>
            Pause
          </Button>
          <Button compact tone="danger" icon={X}>
            Cancel
          </Button>
        </div>
      </header>

      <nav className="stage-navigator operator-stage-navigator" aria-label="Prototype workflow stages">
        {workflowStages.map((stage, index) => {
          const selected = stage.id === stageId;
          const before = index < stageIndex;
          return (
            <button
              type="button"
              key={stage.id}
              className={`stage-step ${before ? "stage-step--complete" : ""} ${selected ? "stage-step--active stage-step--selected" : ""}`}
              onClick={() => selectStage(stage.id)}
              aria-current={selected ? "step" : undefined}
            >
              <span className="stage-step__node">
                {selected && previewState === "running" ? (
                  <CircleNotch size={14} className="spin" />
                ) : before ? (
                  <Check size={14} weight="bold" />
                ) : (
                  index + 1
                )}
              </span>
              <span>
                <strong>{stage.shortLabel}</strong>
                <small>{selected ? stateCopy.shortLabel : before ? "done" : "preview"}</small>
              </span>
            </button>
          );
        })}
      </nav>

      <section className="operator-preview-switcher" aria-label="Prototype state switcher">
        <span>
          <strong>Prototype state</strong>
          <small>Visual QA only · persisted tasks are unchanged</small>
        </span>
        <fieldset>
          <legend className="sr-only">Representative task state</legend>
          {operatorPreviewStates.map((state) => (
            <button
              type="button"
              key={state.id}
              className={previewState === state.id ? "is-selected" : ""}
              onClick={() => {
                setPreviewState(state.id);
                setNotice(null);
              }}
            >
              {state.label}
            </button>
          ))}
        </fieldset>
      </section>

      {view === "operator" ? (
        <>
          <section className="operator-briefing" aria-label="Operator briefing">
            <header>Operator briefing</header>
            <div>
              {briefing.map((item, index) => (
                <article key={item.label}>
                  <small>
                    {index + 1} · {item.label}
                  </small>
                  <strong className={`text-${item.tone}`}>{item.value}</strong>
                  <span>{item.detail}</span>
                </article>
              ))}
            </div>
          </section>
          <div className="operator-workspace">
            <main>
              <header className="operator-stage-heading">
                <span>
                  <p className="eyebrow">{definition.eyebrow}</p>
                  <h2>{definition.title}</h2>
                  <small>{definition.summary}</small>
                </span>
                <span className={`badge badge--${stateCopy.badge}`}>{stateCopy.label}</span>
              </header>
              {stateOverride ? (
                <div className={`operator-state-callout operator-state-callout--${stateCopy.tone}`}>
                  <StateIcon size={19} weight="fill" />
                  <span>
                    <strong>{stateOverride.health}</strong>
                    <small>{stateOverride.reason}</small>
                  </span>
                </div>
              ) : null}
              <OperatorStageView stageId={stageId} onAction={setNotice} />
            </main>
            <aside className="operator-context-rail">
              <header>
                <small>Stage context</small>
                <strong>{workflowStages[stageIndex]?.label}</strong>
              </header>
              {definition.aside.map((row) => (
                <section key={row.label}>
                  <small>{row.label}</small>
                  <strong className={row.tone ? `text-${row.tone}` : ""}>{row.value}</strong>
                  <p>{row.detail}</p>
                </section>
              ))}
              <Button tone="primary" icon={Play} onClick={() => act()}>
                {primaryAction}
              </Button>
              <Button icon={FileText} onClick={() => setView("evidence")}>
                Open evidence
              </Button>
            </aside>
          </div>
          {notice ? (
            <div className="operator-prototype__notice" role="status">
              <CheckCircle size={18} weight="fill" />
              <span>{notice}</span>
              <button type="button" onClick={() => setNotice(null)}>
                Dismiss
              </button>
            </div>
          ) : null}
          <footer className="operator-handoff">
            <ShieldCheck size={28} weight="duotone" />
            <span>
              <small>Handoff readiness</small>
              <strong>{handoff}</strong>
            </span>
            <small>Last updated {definition.updated} · 31 Aug 2026</small>
          </footer>
        </>
      ) : (
        <OperatorEvidencePreview stageId={stageId} onReturn={() => setView("operator")} />
      )}
      <div className="operator-run-activity">
        <strong>Run activity</strong>
        <span>Persisted runs, tools, artifacts, tests, approvals, and decisions</span>
        <small>Prototype · no live events</small>
      </div>
    </div>
  );
}

function OperatorEvidencePreview({ stageId, onReturn }: { stageId: StageId; onReturn: () => void }) {
  const definition = operatorStageDefinitions[stageId];
  return (
    <div className="operator-evidence-preview">
      <main>
        <header>
          <span>
            <p className="eyebrow">Evidence view · retained detail</p>
            <h2>{definition.title}</h2>
            <small>All provenance and detailed records remain visible in this mode.</small>
          </span>
          <Button icon={ArrowLeft} onClick={onReturn}>
            Back to Operator view
          </Button>
        </header>
        <section className="operator-evidence-strip">
          <article>
            <FileText size={19} />
            <span>
              <small>Authoritative handoff</small>
              <strong>{stageId}-handoff.md</strong>
              <p>31 Aug 2026 · {definition.updated}</p>
            </span>
          </article>
          <article>
            <CircleNotch size={19} />
            <span>
              <small>Execution contract</small>
              <strong>gpt-5.6-luna · xhigh</strong>
              <p>Context manifest retained</p>
            </span>
          </article>
          <article>
            <ShieldCheck size={19} />
            <span>
              <small>Authority</small>
              <strong>Exact repository revision</strong>
              <p>Read-only outside Implement</p>
            </span>
          </article>
        </section>
        <section className="operator-evidence-artifact">
          <header>
            <strong>{stageId}-handoff.md</strong>
            <span className="badge badge--blue">Current evidence</span>
          </header>
          <div>
            <h3>Outcome</h3>
            <p>{definition.summary}</p>
            <h3>Recorded evidence</h3>
            <ul>
              <li>Repository authority and stage run identity retained.</li>
              <li>Model, reasoning, context manifest, usage, and execution safeguards recorded.</li>
              <li>Detailed artifact content remains available for audit and downstream gates.</li>
            </ul>
            <h3>Next safe action</h3>
            <p>{definition.nextAction}</p>
          </div>
        </section>
      </main>
      <aside>
        <section>
          <small>Task brief</small>
          <strong>Reduce operator fatigue across the complete task journey.</strong>
          <p>
            Provide concise decision-relevant summaries for all ten stages while retaining complete evidence.
          </p>
        </section>
        <section>
          <small>Stage context</small>
          <strong>{workflowStages.find((stage) => stage.id === stageId)?.label}</strong>
          <p>Viewing prototype evidence · no task data is mutated.</p>
        </section>
        <section>
          <small>Run safeguards</small>
          <strong>Read-only preview</strong>
          <p>Access, sandbox, authority, and write boundary are all retained here.</p>
        </section>
        <section>
          <small>Living artifacts</small>
          <strong>10 retained</strong>
          <p>One durable handoff per workflow stage.</p>
        </section>
      </aside>
    </div>
  );
}

function defaultPreviewState(stageId: StageId): OperatorPreviewState {
  if (stageId === "grill" || stageId === "specification" || stageId === "approval") return "needs-input";
  if (stageId === "implement") return "running";
  return "completed";
}

function previewStatePresentation(state: OperatorPreviewState) {
  switch (state) {
    case "running":
      return { label: "Running", shortLabel: "running", tone: "blue", badge: "blue", icon: CircleNotch };
    case "needs-input":
      return {
        label: "Needs input",
        shortLabel: "needs input",
        tone: "amber",
        badge: "yellow",
        icon: WarningCircle,
      };
    case "blocked":
      return { label: "Blocked", shortLabel: "blocked", tone: "red", badge: "red", icon: X };
    case "repair":
      return {
        label: "Repair required",
        shortLabel: "repair",
        tone: "red",
        badge: "red",
        icon: WarningCircle,
      };
    case "completed":
      return { label: "Completed", shortLabel: "done", tone: "green", badge: "green", icon: CheckCircle };
  }
}

function previewStateOverride(state: OperatorPreviewState) {
  switch (state) {
    case "running":
      return {
        health: "Active worker",
        reason: "Run heartbeat is current",
        action: "Monitor active run",
        actionDetail: "No intervention needed",
        handoff: "Work is active. The next handoff remains gated on persisted completion evidence.",
      };
    case "needs-input":
      return {
        health: "Operator decision required",
        reason: "Automatic continuation is paused",
        action: "Open required decision",
        actionDetail: "Then continue safely",
        handoff: "Handoff is paused until the required operator decision is recorded.",
      };
    case "blocked":
      return {
        health: "Blocked · action required",
        reason: "Repository authority drift",
        action: "Open blocked task",
        actionDetail: "Resolve authority first",
        handoff: "Handoff is blocked until repository authority is restored and revalidated.",
      };
    case "repair":
      return {
        health: "Candidate gates are stale",
        reason: "A downstream gate requested repair",
        action: "Return to Implement",
        actionDetail: "Assemble a new revision",
        handoff: "Downstream gates are stale until a repaired candidate is assembled and rerun.",
      };
    case "completed":
      return {
        health: "Stage complete",
        reason: "Durable evidence retained",
        action: "Open next stage",
        actionDetail: "No rerun required",
        handoff: "This stage is complete and its durable handoff is ready downstream.",
      };
  }
}
