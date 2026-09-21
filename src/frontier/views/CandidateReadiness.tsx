import { ArrowRight, GitBranch, GitDiff, ShieldCheck } from "@phosphor-icons/react";
import type { RuntimeCandidate } from "../../domain";
import type { TaskCore } from "../runtime/contracts";
import { stageLabels } from "../runtime/presentation";
import { gateStages, gateView } from "../runtime/workflow";

export function CandidateIdentity({
  task,
  onDiff,
}: {
  task: TaskCore;
  onDiff(candidate: RuntimeCandidate): void;
}) {
  const candidate = task.candidates.at(-1);
  return (
    <section className="workflow-card candidate-ribbon" aria-label="Candidate identity">
      <GitBranch size={18} />
      {candidate ? (
        <>
          <strong>
            {candidate.id} r{candidate.revisionNumber}
          </strong>
          <code title={candidate.headRevision ?? undefined}>
            {candidate.headRevision?.slice(0, 12) ?? "Head unavailable"}
          </code>
          <small>Target · {candidate.baseBranch}</small>
          <button type="button" disabled={!candidate.headRevision} onClick={() => onDiff(candidate)}>
            <GitDiff size={17} />
            Open exact diff
          </button>
        </>
      ) : (
        <p>No integration candidate recorded.</p>
      )}
    </section>
  );
}

export function CandidateReadiness({ task }: { task: TaskCore }) {
  return (
    <section className="workflow-card readiness-panel">
      <header className="panel-heading">
        <span>
          <ShieldCheck size={18} />
          <h3>Candidate-bound gates</h3>
        </span>
        <small>Current revision</small>
      </header>
      <div className="readiness-grid">
        {gateStages.map((stage) => {
          const gate = gateView(task, stage);
          return (
            <article key={stage} data-fresh={gate.fresh}>
              <ShieldCheck size={21} />
              <h3>{stageLabels[stage]}</h3>
              <strong>{gate.label}</strong>
              <p>{gate.reason}</p>
            </article>
          );
        })}
      </div>
      <p className="panel-content quiet">
        Each gate must apply to this candidate revision. Earlier evidence remains available for audit.
      </p>
    </section>
  );
}

export function CandidateHistory({
  task,
  onDiff,
}: {
  task: TaskCore;
  onDiff(candidate: RuntimeCandidate): void;
}) {
  const candidates = task.candidates;
  if (!candidates.length) return null;
  const current = candidates.at(-1);
  return (
    <section className="workflow-card revision-history">
      <header className="panel-heading">
        <span>
          <GitBranch size={18} />
          <h3>Repair & revision history</h3>
        </span>
      </header>
      <div className="revision-list">
        {candidates.flatMap((candidate) =>
          candidate.revisions.map((revision) => (
            <article key={`${candidate.id}:${revision.number}`}>
              <small>
                {candidate.id === current?.id && revision.number === current.revisionNumber
                  ? "Current candidate"
                  : "Previous revision · retained"}
              </small>
              <strong>
                {candidate.id} r{revision.number} · {revision.headRevision.slice(0, 12)}
              </strong>
              <p>{revision.reason}</p>
              <small>{new Date(revision.createdAt).toLocaleString()}</small>
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
            </article>
          )),
        )}
      </div>
      <p className="panel-content quiet">
        A repair creates a new revision; affected reviews and tests must rerun. No future revision is implied.
      </p>
    </section>
  );
}
