import { ArrowRight, Binoculars, CaretDown, FileText, Pulse } from "@phosphor-icons/react";
import { type ReactNode, useEffect, useState } from "react";
import type { RuntimeArtifact, StageId } from "../../domain";
import { usePanelState } from "../app/panel-state";
import type { FrontierGateway, TaskEvidence } from "../runtime/contracts";
import { latestStageArtifact, modelLabel, reasoningLabel, stageLabels } from "../runtime/presentation";
import { artifactState } from "../runtime/workflow";
import { ArtifactViewer } from "./ArtifactViewer";
import { InvestigationEvidence } from "./InvestigationEvidence";
import { ReviewEvidence } from "./ReviewEvidence";

export function StageEvidence({
  evidence,
  stage,
  gateway,
  onArtifact,
  onWatch,
  onMore,
  reviewIdentity,
  footer,
}: {
  reviewIdentity?: ReactNode;
  footer?: ReactNode;
  evidence: TaskEvidence;
  stage: StageId;
  gateway: FrontierGateway;
  onArtifact(id: string): void;
  onWatch(id: string): void;
  onMore(kind: "artifacts" | "runs" | "activity"): void;
}) {
  const task = evidence.core;
  const artifacts = task.artifacts.filter((item) => item.stage === stage);
  const latest = latestStageArtifact(artifacts, stage);
  const runs = evidence.runs.items.filter((item) => item.stage === stage);
  const [detail, setDetail] = useState<RuntimeArtifact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedTab, setTab] = usePanelState<"output" | "activity" | "runs" | "decisions">(
    `evidence-tab:${task.id}:${stage}`,
    "output",
  );
  const artifactId = latest?.id;
  const earlyStage = ["triage", "scouts", "grill", "specification", "plan"].includes(stage);
  useEffect(() => {
    let disposed = false;
    setDetail(null);
    setError(null);
    if (artifactId && !earlyStage)
      gateway
        .artifact(task.id, artifactId)
        .then((value) => {
          if (!disposed) setDetail(value);
        })
        .catch((reason) => {
          if (!disposed) setError(reason instanceof Error ? reason.message : "Evidence failed to load");
        });
    return () => {
      disposed = true;
    };
  }, [artifactId, task.id, gateway, earlyStage]);
  const tab = savedTab === "output" ? "activity" : savedTab;
  const tabs = (
    <nav className="content-tabs" aria-label="Task evidence tabs">
      {(["activity", "runs", "decisions"] as const).map((key) => (
        <button type="button" key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>
          {key === "runs" ? "Agent runs" : key[0]?.toUpperCase() + key.slice(1)}
        </button>
      ))}
    </nav>
  );
  const telemetry = (
    <>
      {" "}
      {tab === "runs" && (
        <>
          {runs.map((run) => (
            <button type="button" key={run.id} className="text-row" onClick={() => onWatch(run.id)}>
              <Binoculars size={20} />
              <span>
                <strong>
                  {run.role ?? stageLabels[stage]} · {run.status}
                </strong>
                <small>
                  {modelLabel(run.model)} · {reasoningLabel(run.reasoning)} · {run.id}
                </small>
                {run.error && <small className="form-error">{run.error}</small>}
              </span>
              <ArrowRight size={17} />
            </button>
          ))}
          {!runs.length && <p>No run is loaded for this stage.</p>}
          {evidence.runs.nextCursor && (
            <button type="button" onClick={() => onMore("runs")}>
              Load earlier runs
            </button>
          )}
        </>
      )}
      {tab === "activity" && (
        <>
          {evidence.activity.items
            .filter((event) => event.stage === stage)
            .map((event) => (
              <article className="activity-row" key={event.id}>
                <time>{new Date(event.at).toLocaleTimeString()}</time>
                <div>
                  <strong>{event.title}</strong>
                  <p>{event.detail}</p>
                  {event.toolCall?.result && <pre>{event.toolCall.result}</pre>}
                </div>
              </article>
            ))}
          {!evidence.activity.items.some((event) => event.stage === stage) && (
            <p>No activity loaded for this stage.</p>
          )}
          {evidence.activity.nextCursor && (
            <button type="button" onClick={() => onMore("activity")}>
              Load earlier activity
            </button>
          )}
        </>
      )}
      {tab === "decisions" && (
        <>
          {task.decisions.map((decision) => (
            <article className="workflow-card" key={decision.id}>
              <strong>{decision.question}</strong>
              <p>{decision.answer}</p>
              <small>{new Date(decision.createdAt).toLocaleString()}</small>
            </article>
          ))}
          {task.approvals.map((approval) => (
            <p key={approval.id}>
              {stageLabels[approval.stage]} approved · {new Date(approval.createdAt).toLocaleString()} ·{" "}
              {approval.note || "No note"}
            </p>
          ))}
          {!task.decisions.length && !task.approvals.length && <p>No operator decision has been recorded.</p>}
        </>
      )}
    </>
  );
  const artifactLinks = artifacts.map((artifact) => (
    <button type="button" key={artifact.id} className="text-row" onClick={() => onArtifact(artifact.id)}>
      <FileText size={20} />
      <span>
        <strong>{artifact.name}</strong>
        <small>
          {artifactState(artifact, task)} · {new Date(artifact.createdAt).toLocaleString()}
        </small>
      </span>
      <ArrowRight size={17} />
    </button>
  ));
  return (
    <section className={`stage-evidence ${earlyStage ? "workspace-early-evidence" : ""}`}>
      {(stage === "triage" || stage === "scouts") && (
        <InvestigationEvidence evidence={evidence} stage={stage} onWatch={onWatch} />
      )}
      {!detail?.gateResult && reviewIdentity}
      {detail?.gateResult && (
        <ReviewEvidence
          task={task}
          artifact={detail}
          candidateIdentity={reviewIdentity}
          run={runs.find((run) => run.artifactId === detail.id)}
          onArtifact={onArtifact}
        />
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {!earlyStage && artifactLinks}
      {!artifacts.length && (
        <section className={earlyStage ? "workflow-card empty-stage-output" : undefined}>
          {earlyStage && (
            <header className="panel-heading">
              <span>
                <FileText size={18} />
                <h3>{stage === "scouts" ? "Synthesis brief" : "Retained output"}</h3>
              </span>
            </header>
          )}
          <p className="quiet">
            No retained artifact is loaded for {stageLabels[stage]}.{" "}
            {task.stageDispositions?.[stage]?.reason ??
              (task.artifactNextCursor
                ? "Earlier retained artifacts can be loaded below."
                : "Only retained records are shown.")}
          </p>
        </section>
      )}
      {task.artifactNextCursor && (
        <button type="button" onClick={() => onMore("artifacts")}>
          Load earlier artifacts
        </button>
      )}
      {latest &&
        ["specification", "plan", "triage", "scouts", "dev-review", "test", "final-review"].includes(stage) &&
        (earlyStage ? (
          <div className="stage-document">
            <ArtifactViewer
              key={latest.id}
              taskId={task.id}
              artifactId={latest.id}
              gateway={gateway}
              workspace
            />
          </div>
        ) : (
          <details className="stage-document retained-report" open={!detail?.gateResult}>
            <summary>
              <FileText size={18} />
              Retained report · {latest.name}
              <CaretDown size={16} />
            </summary>
            <ArtifactViewer
              key={latest.id}
              taskId={task.id}
              artifactId={latest.id}
              gateway={gateway}
              workspace
            />
          </details>
        ))}
      {earlyStage && artifacts.length > 0 && (
        <section className="workflow-card retained-stage-artifacts">
          <header className="panel-heading">
            <span>
              <FileText size={18} />
              <h3>Retained artifacts</h3>
            </span>
          </header>
          {artifactLinks}
        </section>
      )}
      {footer}
      <details className="task-run-activity">
        <summary>
          <Pulse size={18} />
          <strong>Run activity</strong>
          <small>· recorded telemetry</small>
          <CaretDown size={16} />
        </summary>
        {tabs}
        {telemetry}
      </details>
    </section>
  );
}
