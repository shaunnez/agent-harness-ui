import { FileText, GitCommit, WarningCircle } from "@phosphor-icons/react";
import { type RuntimeArtifact, type RuntimeTask, type StageId, workflowStages } from "../../domain";
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
  onOpenEvidenceStage,
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
  onOpenEvidenceStage: (stageId: StageId) => void;
  onOpenArtifact: (artifact: RuntimeArtifact) => void;
  onOpenCandidateDiff: () => void;
  candidateDiffLoading: boolean;
}) {
  const model = buildOperatorViewModel(task, viewedStageId);
  const candidate = task.candidates?.at(-1);
  const packageStage = viewedStageId === "plan" || viewedStageId === "implement";
  const stageFailed =
    viewedStageId === task.currentStage && ["failed", "blocked", "cancelled"].includes(task.status);
  const visibleFacts = model.facts.filter((fact) => {
    if (viewedStageId === "approval") return true;
    if (fact.label === "Candidate" && model.signals.some((signal) => signal.key === "candidate"))
      return false;
    if (fact.label === "Gate" && model.signals.some((signal) => signal.key === "gate")) return false;
    return true;
  });
  const currentStageLabel =
    workflowStages.find((stage) => stage.id === task.currentStage)?.label ?? task.currentStage;

  return (
    <div className="runtime-operator-scroll">
      <section className="runtime-operator-briefing" aria-label="Operator briefing">
        <header>
          <span>Operator briefing</span>
          {readOnlyPreview ? <span className="badge badge--neutral">Read-only preview</span> : null}
        </header>
        <div className="runtime-operator-briefing__primary">
          <article className="runtime-operator-briefing__now">
            <small>{model.now.label}</small>
            <strong className={`runtime-operator-tone--${model.now.tone ?? "neutral"}`}>
              {model.now.value}
            </strong>
            <span>{model.now.detail}</span>
          </article>
          {readOnlyPreview ? (
            <article className="runtime-operator-briefing__next">
              <small>{model.next.label}</small>
              <strong className={`runtime-operator-tone--${model.next.tone ?? "neutral"}`}>
                {model.next.value}
              </strong>
              <span>{model.next.detail}</span>
            </article>
          ) : (
            <div className="runtime-operator-briefing__command">
              <RuntimeCommandBar
                task={task}
                viewedStageId={viewedStageId}
                onRun={onRun}
                onAction={onAction}
                onFinishGrill={onFinishGrill}
              />
            </div>
          )}
        </div>
        {model.signals.length ? (
          <div className="runtime-operator-briefing__signals">
            {model.signals.map((signal) => (
              <article key={signal.key}>
                <small>{signal.label}</small>
                <strong className={`runtime-operator-tone--${signal.tone ?? "neutral"}`}>
                  {signal.value}
                </strong>
                <span>{signal.detail}</span>
              </article>
            ))}
          </div>
        ) : null}
      </section>

      {readOnlyPreview ? (
        <p className="runtime-operator-preview-label">
          <FileText size={15} /> Hosted fixture · actions remain available only in the local runtime
        </p>
      ) : null}

      {runError ? (
        <div className="runtime-error" role="alert">
          {runError}
        </div>
      ) : null}

      <div className="runtime-operator-grid">
        <main className="runtime-operator-main">
          {visibleFacts.length ? (
            <>
              <section className="runtime-operator-section-title">
                <span>{viewedStageId === "approval" ? "Decision receipt" : "Stage detail"}</span>
                <i />
              </section>
              <div
                className={`runtime-operator-facts ${viewedStageId === "approval" ? "runtime-operator-facts--approval" : ""}`}
              >
                {visibleFacts.map((fact) => (
                  <article key={fact.label}>
                    <small>{fact.label}</small>
                    <strong className={`runtime-operator-tone--${fact.tone ?? "neutral"}`}>
                      {fact.value}
                    </strong>
                    <p>{fact.detail}</p>
                  </article>
                ))}
              </div>
            </>
          ) : null}

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

          {viewedStageId === "final-review" ? (
            <RuntimeOperatorFinalReview task={task} onInspectStage={onOpenEvidenceStage} />
          ) : null}

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
            <p>
              {model.temporalState === "past"
                ? `Recorded history · current work is ${currentStageLabel}`
                : model.temporalState === "future"
                  ? `Not started · current work is ${currentStageLabel}`
                  : "Current workflow stage"}
            </p>
          </header>
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
    </div>
  );
}
