import { ArrowRight, GitDiff, Package, ShieldCheck } from "@phosphor-icons/react";
import type { RuntimeCandidate } from "../../domain";
import type { TaskCore } from "../runtime/contracts";
import { stageLabels } from "../runtime/presentation";
import { gateStages, gateView } from "../runtime/workflow";

export function CandidateEvidence({
  task,
  onDiff,
  compact = false,
}: {
  task: TaskCore;
  compact?: boolean;
  onDiff(candidate: RuntimeCandidate): void;
}) {
  const candidate = task.candidates.at(-1);
  if (!candidate)
    return (
      <section className={`workflow-card candidate-evidence candidate-empty ${compact ? "compact" : ""}`}>
        <div className="panel-heading">
          <span>
            <Package size={18} />
            <h3>Candidate assembly</h3>
          </span>
          <small className="assembly-status">Not assembled</small>
        </div>
        <div className="candidate-body">
          <div className="candidate-empty-intro">
            <Package size={28} />
            <div>
              <h3>Waiting for qualified slices</h3>
              <p>No integration candidate has been assembled.</p>
            </div>
          </div>
          <div className="candidate-footer">
            <p>Qualified slices remain distinct from an integrated, reviewed delivery.</p>
            <button type="button" disabled>
              <GitDiff size={18} />
              Open exact diff
            </button>
          </div>
          <small>The candidate diff becomes available after assembly records a head revision.</small>
        </div>
      </section>
    );
  return (
    <section className={`workflow-card candidate-evidence ${compact ? "compact" : ""}`}>
      {!compact && (
        <div className="panel-heading">
          <span>
            <Package size={18} />
            <h3>Candidate assembly</h3>
          </span>
          <small>{candidate.status.replaceAll("_", " ")}</small>
        </div>
      )}
      <div className="candidate-body">
        <div className="section-heading candidate-identity">
          <div>
            <small>Integration candidate</small>
            <h3>
              {candidate.id} / r{candidate.revisionNumber}
            </h3>
            <code>{candidate.headRevision ?? "Head not recorded"}</code>
          </div>
          <button type="button" disabled={!candidate.headRevision} onClick={() => onDiff(candidate)}>
            <GitDiff size={18} />
            Open exact diff
          </button>
        </div>
        <dl>
          <dt>State</dt>
          <dd>{candidate.status.replaceAll("_", " ")}</dd>
          <dt>Target</dt>
          <dd>
            {candidate.baseBranch} · {candidate.baseRevision.slice(0, 12)}
          </dd>
          <dt>Integrated slices</dt>
          <dd>{candidate.members?.map((item) => item.packageId).join(" → ") || "Not recorded"}</dd>
        </dl>
        <div className="gate-strip">
          {gateStages.map((stage) => {
            const gate = gateView(task, stage);
            return (
              <div key={stage} className={gate?.fresh ? "fresh" : ""}>
                <ShieldCheck size={18} />
                <strong>{stageLabels[stage]}</strong>
                <span>{gate.label}</span>
                <small>{gate.reason}</small>
              </div>
            );
          })}
        </div>
        {candidate.revisions.length > 1 && (
          <section className="candidate-lineage">
            <h3>Repair & revision history</h3>
            {candidate.revisions.map((revision) => (
              <div className="text-row" key={revision.number}>
                <span>
                  <strong>
                    r{revision.number} · {revision.headRevision.slice(0, 12)}
                  </strong>
                  <small>
                    {revision.reason} · {new Date(revision.createdAt).toLocaleString()}
                  </small>
                </span>
                <button
                  type="button"
                  onClick={() =>
                    onDiff({
                      ...candidate,
                      revisionNumber: revision.number,
                      headRevision: revision.headRevision,
                    })
                  }
                >
                  Inspect diff <ArrowRight size={16} />
                </button>
              </div>
            ))}
          </section>
        )}
      </div>
    </section>
  );
}
