import { ClipboardText, FileText } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import type { RuntimeArtifact, RuntimeRun } from "../../domain";
import { usePanelState } from "../app/panel-state";
import type { TaskCore } from "../runtime/contracts";
import { modelLabel, reasoningLabel, stageLabels } from "../runtime/presentation";
import { artifactState } from "../runtime/workflow";

export function ReviewEvidence({
  task,
  artifact,
  run,
  onArtifact,
  candidateIdentity,
}: {
  candidateIdentity?: ReactNode;
  task: TaskCore;
  artifact: RuntimeArtifact;
  run?: RuntimeRun;
  onArtifact(id: string): void;
}) {
  const [selected, select] = usePanelState<number>(`finding:${task.id}:${artifact.id}`, 0);
  const gate = artifact.gateResult;
  if (!gate) return null;
  const candidate = task.candidates.at(-1);
  const bindingMatches =
    candidate && gate.candidateId === candidate.id && gate.candidateRevision === candidate.revisionNumber;
  const findings = gate.findings ?? [];
  const finding = findings[selected] ?? findings[0];
  return (
    <div className="review-evidence">
      <section className="workflow-card review-intro">
        <img src="/assets/mf.worker.standard.portrait.r1.png" alt="Review worker" />
        <div>
          <small>
            {stageLabels[artifact.stage]} · {modelLabel(artifact.model)} ·{" "}
            {reasoningLabel(artifact.reasoning)}
            {run ? ` · ${run.status}` : ""}
          </small>
          <h3>Recorded verdict: {gate.verdict}</h3>
          <p>
            {bindingMatches
              ? artifactState(artifact, task)
              : "Previous or unbound candidate · retained for audit"}
          </p>
          <small>
            {gate.candidateId} r{gate.candidateRevision} · {new Date(gate.evaluatedAt).toLocaleString()}
          </small>
        </div>
      </section>
      {candidateIdentity}
      {gate.blockingReasons.length > 0 && (
        <div className="review-blockers">
          {gate.blockingReasons.map((reason) => (
            <p className="form-error" key={reason}>
              {reason}
            </p>
          ))}
        </div>
      )}
      {finding ? (
        <div className="review-finding-grid">
          <section className="workflow-card finding-list">
            <header className="panel-heading">
              <span>
                <ClipboardText size={18} />
                <h3>Findings</h3>
              </span>
              <small>{findings.length} recorded</small>
            </header>
            <nav aria-label="Review findings">
              {findings.map((entry, index) => (
                <button
                  type="button"
                  key={JSON.stringify(entry)}
                  aria-pressed={entry === finding}
                  onClick={() => select(index)}
                >
                  <span className={`severity severity-${entry.severity}`}>{entry.severity}</span>
                  <span>
                    <strong>{entry.title}</strong>
                    <small>
                      {entry.file}
                      {entry.line ? `:${entry.line}` : ""}
                    </small>
                    <small>
                      {entry.kind.replaceAll("-", " ")} · {entry.blocking ? "Blocking" : "Non-blocking"}
                    </small>
                  </span>
                </button>
              ))}
            </nav>
            {!finding && (
              <p className="panel-content">
                No structured findings recorded. The retained report remains available.
              </p>
            )}
            <footer className="panel-content">
              <small>
                {["P0", "P1", "P2", "P3"]
                  .map(
                    (severity) =>
                      `${findings.filter((entry) => entry.severity === severity).length} ${severity}`,
                  )
                  .join(" · ")}
              </small>
            </footer>
          </section>
          <section className="workflow-card finding-detail">
            <header className="panel-heading">
              <h3>{finding?.title ?? "Review report"}</h3>
              {finding && <span className={`severity severity-${finding.severity}`}>{finding.severity}</span>}
            </header>
            <div className="panel-content">
              {finding ? (
                <>
                  <h4>Finding detail</h4>
                  <p>{finding.detail}</p>
                  {finding.file && (
                    <code>
                      {finding.file}
                      {finding.line ? `:${finding.line}` : ""}
                    </code>
                  )}
                  {finding.reproductionEvidence && (
                    <section>
                      <h4>Reproduction evidence</h4>
                      <p>{finding.reproductionEvidence}</p>
                    </section>
                  )}
                  {finding.acceptanceCriterion && (
                    <section>
                      <h4>Acceptance criterion</h4>
                      <p>{finding.acceptanceCriterion}</p>
                    </section>
                  )}
                  <small>
                    {finding.candidateId} r{finding.candidateRevision}
                  </small>
                </>
              ) : (
                <p>Use the full report to inspect the reviewer’s retained evidence.</p>
              )}
              <button type="button" onClick={() => onArtifact(artifact.id)}>
                <FileText size={17} />
                Open review report
              </button>
            </div>
          </section>
        </div>
      ) : (
        <button type="button" onClick={() => onArtifact(artifact.id)}>
          <FileText size={17} />
          Open review report · no structured findings recorded
        </button>
      )}
    </div>
  );
}
