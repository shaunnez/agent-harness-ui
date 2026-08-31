import {
  CheckCircle,
  CircleNotch,
  FileText,
  GitCommit,
  ShieldCheck,
  WarningCircle,
} from "@phosphor-icons/react";
import type { RuntimeArtifact, RuntimeTask, StageId } from "../../domain";
import { Button } from "../Primitives";
import { RuntimeCommandBar } from "./RuntimeCommandBar";
import { RuntimeOperatorFinalReview } from "./RuntimeOperatorFinalReview";
import { RuntimeOperatorPackageFlow } from "./RuntimeOperatorPackageFlow";
import type { RuntimeWorkflowAction } from "./contracts";
import { buildOperatorViewModel } from "./operatorViewModel";

export function RuntimeOperatorWorkspace({
  task,
  readOnlyPreview = false,
  viewedStageId,
  runError,
  onRun,
  onAction,
  onFinishGrill,
  onOpenEvidence,
  onOpenArtifact,
  onOpenCandidateDiff,
  candidateDiffLoading,
}: {
  task: RuntimeTask;
  readOnlyPreview?: boolean;
  viewedStageId: StageId;
  runError: string | null;
  onRun: () => Promise<void>;
  onAction: (action: RuntimeWorkflowAction) => Promise<void>;
  onFinishGrill: (acceptRemaining: boolean) => Promise<void>;
  onOpenEvidence: () => void;
  onOpenArtifact: (artifact: RuntimeArtifact) => void;
  onOpenCandidateDiff: () => void;
  candidateDiffLoading: boolean;
}) {
  const model = buildOperatorViewModel(task, viewedStageId);
  const candidate = task.candidates?.at(-1);
  const StateIcon =
    model.alert?.tone === "red" || model.alert?.tone === "amber" ? WarningCircle : CheckCircle;
  const packageStage = viewedStageId === "plan" || viewedStageId === "implement";
  const stageFailed =
    viewedStageId === task.currentStage && ["failed", "blocked", "cancelled"].includes(task.status);

  return (
    <div className="runtime-operator-scroll">
      <section className="runtime-operator-briefing" aria-label="Operator briefing">
        <header>Operator briefing</header>
        <div>
          {model.briefing.map((item, index) => (
            <article key={item.key}>
              <small>
                {index + 1} · {item.label}
              </small>
              <strong className={`runtime-operator-tone--${item.tone ?? "neutral"}`}>{item.value}</strong>
              <span title={item.detail}>{item.detail}</span>
            </article>
          ))}
        </div>
      </section>

      {readOnlyPreview ? (
        <section className="stage-command-bar stage-command-bar--history">
          <FileText size={18} />
          <span className="stage-command-bar__copy">
            <small>Prototype fixture · read-only</small>
            <strong>Inspect the workflow without changing task state</strong>
            <span>Actions are available only in the local runtime.</span>
          </span>
          <span className="badge badge--neutral">Preview</span>
        </section>
      ) : (
        <RuntimeCommandBar
          task={task}
          viewedStageId={viewedStageId}
          onRun={onRun}
          onAction={onAction}
          onFinishGrill={onFinishGrill}
        />
      )}

      {runError ? (
        <div className="runtime-error" role="alert">
          {runError}
        </div>
      ) : null}

      <div className="runtime-operator-grid">
        <main className="runtime-operator-main">
          <header className="runtime-operator-stage-heading">
            <span>
              <p className="eyebrow">{model.summary.kicker}</p>
              <h2>{model.summary.title}</h2>
              <small>{model.summary.detail}</small>
            </span>
            <span
              className={`runtime-operator-state runtime-operator-state--${model.briefing[0]?.tone ?? "neutral"}`}
            >
              {task.status === "running" && viewedStageId === task.currentStage ? (
                <CircleNotch className="spin" size={15} />
              ) : (
                <StateIcon size={15} weight="fill" />
              )}
              {model.briefing[0]?.value}
            </span>
          </header>

          {model.alert ? (
            <section
              className={`runtime-operator-alert runtime-operator-alert--${model.alert.tone}`}
              role="alert"
            >
              <WarningCircle size={20} weight="fill" />
              <span>
                <strong>{model.alert.title}</strong>
                <small>{model.alert.detail}</small>
              </span>
            </section>
          ) : null}

          <section className="runtime-operator-section-title">
            <span>Stage signal</span>
            <i />
          </section>
          <div className="runtime-operator-facts">
            {model.facts.map((fact) => (
              <article key={fact.label}>
                <small>{fact.label}</small>
                <strong className={`runtime-operator-tone--${fact.tone ?? "neutral"}`}>{fact.value}</strong>
                <p>{fact.detail}</p>
              </article>
            ))}
          </div>

          {packageStage ? (
            <>
              <section className="runtime-operator-section-title">
                <span>Package flow</span>
                <i />
              </section>
              <RuntimeOperatorPackageFlow
                batches={model.packageBatches}
                stageFailed={stageFailed}
                stageError={task.error}
              />
              {viewedStageId === "implement" && candidate?.revisions?.length ? (
                <section className="runtime-operator-lineage" aria-label="Candidate repair lineage">
                  <header>
                    <strong>Candidate revision lineage</strong>
                    <small>
                      {candidate.id} · {candidate.revisions.length} retained revision
                      {candidate.revisions.length === 1 ? "" : "s"}
                    </small>
                  </header>
                  <div>
                    {candidate.revisions.map((revision) => (
                      <article key={revision.number}>
                        <strong>r{revision.number}</strong>
                        <code>{revision.headRevision.slice(0, 8)}</code>
                        <span>{revision.reason}</span>
                        <small>
                          {revision.authorizingGateStage
                            ? `Authorized by ${revision.authorizingGateStage.replaceAll("-", " ")}`
                            : revision.number === 1
                              ? "Initial candidate"
                              : "Authorizing gate not retained"}
                        </small>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}
            </>
          ) : null}

          {viewedStageId === "final-review" ? <RuntimeOperatorFinalReview task={task} /> : null}

          {model.staleGates.length &&
          ["implement", "dev-review", "test", "final-review", "approval"].includes(viewedStageId) ? (
            <section className="runtime-operator-stale-gates">
              <header>
                <WarningCircle size={18} weight="fill" />
                <strong>Candidate-bound gates requiring attention</strong>
              </header>
              {model.staleGates.map((gate) => (
                <span key={gate.stageId}>
                  <strong>{gate.label}</strong>
                  <small>{gate.reason}</small>
                </span>
              ))}
            </section>
          ) : null}
        </main>

        <aside className="runtime-operator-rail">
          <header>
            <small>Viewed stage</small>
            <strong>{model.stageLabel}</strong>
          </header>
          <section>
            <small>Temporal state</small>
            <strong>
              {model.temporalState === "past"
                ? "Recorded history"
                : model.temporalState === "future"
                  ? "Not started"
                  : "Current"}
            </strong>
            <p>Future stages remain unavailable until persisted evidence exists.</p>
          </section>
          <section>
            <small>Candidate</small>
            <strong>{candidate ? `${candidate.id} r${candidate.revisionNumber}` : "Not assembled"}</strong>
            <p>
              {candidate?.headRevision
                ? `Exact head ${candidate.headRevision.slice(0, 8)}`
                : "No candidate-bound authority yet."}
            </p>
          </section>
          <section>
            <small>Handoff readiness</small>
            <strong className={`runtime-operator-tone--${model.handoff.tone}`}>{model.handoff.label}</strong>
            <p>{model.handoff.detail}</p>
          </section>
          <div className="runtime-operator-rail__actions">
            {model.artifact ? (
              <Button
                compact
                icon={FileText}
                onClick={() => onOpenArtifact(model.artifact as RuntimeArtifact)}
              >
                Open artifact
              </Button>
            ) : null}
            {candidate &&
            ["implement", "dev-review", "test", "final-review", "approval"].includes(viewedStageId) ? (
              <Button compact icon={GitCommit} disabled={candidateDiffLoading} onClick={onOpenCandidateDiff}>
                {candidateDiffLoading ? "Loading diff..." : "Open candidate diff"}
              </Button>
            ) : null}
            <Button tone="primary" compact icon={FileText} onClick={onOpenEvidence}>
              Open Evidence view
            </Button>
          </div>
        </aside>
      </div>

      <footer className={`runtime-operator-handoff runtime-operator-handoff--${model.handoff.tone}`}>
        <ShieldCheck size={24} weight="duotone" />
        <span>
          <small>Handoff readiness</small>
          <strong>{model.handoff.label}</strong>
        </span>
        <small>{model.handoff.detail}</small>
      </footer>
    </div>
  );
}
