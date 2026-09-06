import { ArrowRight, Binoculars, FileText } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { RuntimeArtifact, StageId } from "../../domain";
import { usePanelState } from "../app/panel-state";
import type { FrontierGateway, TaskEvidence } from "../runtime/contracts";
import { modelLabel, reasoningLabel, stageLabels } from "../runtime/presentation";
import { artifactState } from "../runtime/workflow";
import { ArtifactViewer } from "./ArtifactViewer";

export function StageEvidence({
  evidence,
  stage,
  gateway,
  onArtifact,
  onWatch,
  onMore,
}: {
  evidence: TaskEvidence;
  stage: StageId;
  gateway: FrontierGateway;
  onArtifact(id: string): void;
  onWatch(id: string): void;
  onMore(kind: "artifacts" | "runs" | "activity"): void;
}) {
  const task = evidence.core;
  const artifacts = task.artifacts.filter((item) => item.stage === stage);
  const latest = artifacts.at(-1);
  const runs = evidence.runs.items.filter((item) => item.stage === stage);
  const [detail, setDetail] = useState<RuntimeArtifact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedFinding, selectFinding] = useState(0);
  const [tab, setTab] = usePanelState<"output" | "activity" | "runs" | "decisions">(
    `evidence-tab:${task.id}:${stage}`,
    "output",
  );
  const artifactId = latest?.id;
  useEffect(() => {
    let disposed = false;
    setDetail(null);
    setError(null);
    if (artifactId)
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
  }, [artifactId, task.id, gateway]);
  const findings = detail?.gateResult?.findings ?? [];
  const finding = findings[selectedFinding] ?? findings[0];
  return (
    <section className="stage-evidence">
      {(stage === "triage" || stage === "scouts") && (
        <section className="workflow-card">
          <h3>{stage === "triage" ? "Risk & scope" : "Repository scouts"}</h3>
          <p>
            {task.workflowProfile
              ? `${task.workflowProfile.selected} · ${task.workflowProfile.reason}`
              : "No risk profile is recorded yet."}
          </p>
          {task.scoutDispatch ? (
            <>
              <p>{task.scoutDispatch.rationale}</p>
              <div className="scout-grid">
                {task.scoutDispatch.selected.map((scout) => (
                  <article key={scout.name}>
                    <img src="/assets/mf.worker.standard.se.neutral.r1.png" alt="" />
                    <div>
                      <h3>{scout.name}</h3>
                      <small>{scout.status}</small>
                      <p>{scout.focus}</p>
                      <p className="quiet">{scout.reason}</p>
                      {scout.error && <p className="form-error">{scout.error}</p>}
                    </div>
                  </article>
                ))}
              </div>
              <p className="quiet">Skipped: {task.scoutDispatch.skipped.join(", ") || "None recorded"}</p>
            </>
          ) : (
            <p className="quiet">The selected and skipped scout set has not been recorded.</p>
          )}
        </section>
      )}
      {detail?.gateResult && (
        <section className="workflow-card">
          <div className="section-heading">
            <h3>
              {stageLabels[stage]} verdict: {detail.gateResult.verdict}
            </h3>
            <span>
              {detail.gateResult.candidateId} r{detail.gateResult.candidateRevision}
            </span>
          </div>
          <p className="quiet">{artifactState(detail, task)}</p>
          {detail.gateResult.blockingReasons.map((reason) => (
            <p className="form-error" key={reason}>
              {reason}
            </p>
          ))}
          {finding && (
            <div className="finding-layout">
              <nav aria-label="Review findings">
                {findings.map((entry, index) => (
                  <button
                    type="button"
                    className={entry === finding ? "selected" : ""}
                    key={JSON.stringify(entry)}
                    onClick={() => selectFinding(index)}
                  >
                    <strong>
                      {entry.severity} · {entry.title}
                    </strong>
                    <small>{entry.kind.replaceAll("-", " ")}</small>
                  </button>
                ))}
              </nav>
              <article>
                <h3>
                  {finding.severity} · {finding.title}
                </h3>
                <p>{finding.detail}</p>
                {finding.file && (
                  <code>
                    {finding.file}
                    {finding.line ? `:${finding.line}` : ""}
                  </code>
                )}
                {finding.reproductionEvidence && (
                  <>
                    <h4>Reproduction evidence</h4>
                    <p>{finding.reproductionEvidence}</p>
                  </>
                )}
                {finding.acceptanceCriterion && <p>Acceptance criterion: {finding.acceptanceCriterion}</p>}
              </article>
            </div>
          )}
        </section>
      )}
      <nav className="content-tabs" aria-label="Task evidence tabs">
        {(["output", "activity", "runs", "decisions"] as const).map((key) => (
          <button type="button" key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>
            {key === "output"
              ? "Evidence"
              : key === "runs"
                ? "Agent runs"
                : key[0]?.toUpperCase() + key.slice(1)}
          </button>
        ))}
      </nav>
      {tab === "output" && (
        <>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          {artifacts.map((artifact) => (
            <button
              type="button"
              key={artifact.id}
              className="text-row"
              onClick={() => onArtifact(artifact.id)}
            >
              <FileText size={20} />
              <span>
                <strong>{artifact.name}</strong>
                <small>
                  {artifactState(artifact, task)} · {new Date(artifact.createdAt).toLocaleString()}
                </small>
              </span>
              <ArrowRight size={17} />
            </button>
          ))}
          {!artifacts.length && (
            <p className="quiet">
              No retained output is loaded for {stageLabels[stage]}.{" "}
              {task.stageDispositions?.[stage]?.reason ??
                (task.artifactNextCursor
                  ? "Earlier retained artifacts can be loaded below."
                  : "Only retained records are shown.")}
            </p>
          )}
          {task.artifactNextCursor && (
            <button type="button" onClick={() => onMore("artifacts")}>
              Load earlier artifacts
            </button>
          )}
          {latest &&
            ["specification", "plan", "triage", "scouts", "dev-review", "test", "final-review"].includes(
              stage,
            ) && (
              <div className="stage-document">
                <ArtifactViewer key={latest.id} taskId={task.id} artifactId={latest.id} gateway={gateway} />
              </div>
            )}
        </>
      )}
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
    </section>
  );
}
