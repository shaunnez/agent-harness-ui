import { ArrowRight, GitDiff, GitPullRequest, ShieldCheck } from "@phosphor-icons/react";
import { useState } from "react";
import { type RuntimeCandidate, type RuntimeFocusedTestRow, stageIds } from "../../domain";
import type { TaskCore, TaskEvidence } from "../runtime/contracts";
import { formatCount, stageLabels } from "../runtime/presentation";
import { gateStages, gateView, stageState } from "../runtime/workflow";
import { sumRecorded } from "../runtime/usage";

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
      <section className="workflow-card">
        <h3>Candidate assembly</h3>
        <p>
          No integration candidate has been assembled. Qualified slices remain distinct from an integrated,
          reviewed delivery.
        </p>
      </section>
    );
  return (
    <section className={`workflow-card candidate-evidence ${compact ? "compact" : ""}`}>
      <div className="section-heading">
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
    </section>
  );
}

export function TestEvidence({ evidence }: { evidence: TaskEvidence }) {
  const [selected, select] = useState<string | null>(null);
  const candidate = evidence.core.candidates.at(-1);
  const summaries = evidence.runs.items.filter((run) => run.stage === "test" && run.test);
  const rows = new Map<string, RuntimeFocusedTestRow>();
  const sources = new Map<string, string>();
  const seen = new Set<string>();
  for (const run of [...summaries].reverse())
    for (const row of run.test?.rows ?? []) {
      rows.set(`${run.id}:${row.id}`, row);
      sources.set(
        `${run.id}:${row.id}`,
        `Attempt ${run.attempt ?? "—"} · ${run.startedAt ? new Date(run.startedAt).toLocaleString() : "Start time unavailable"}`,
      );
      seen.add(JSON.stringify(row));
    }
  for (const [index, verification] of (candidate?.verificationRuns ?? []).entries())
    for (const row of verification.rows)
      if (!seen.has(JSON.stringify(row))) rows.set(`verification:${index}:${row.id}`, row);
  const entries = [...rows];
  const chosen = selected ? rows.get(selected) : null;
  return (
    <section className="workflow-card">
      <h3>Test results</h3>
      <p>
        {entries.filter(([, row]) => row.status === "passed").length} passed ·{" "}
        {entries.filter(([, row]) => row.status === "failed").length} failed · {entries.length} recorded
        checks across loaded attempts
      </p>
      {chosen ? (
        <div className="test-detail">
          <button type="button" onClick={() => select(null)}>
            ← Back to results
          </button>
          <h3>{chosen.title}</h3>
          <small>{selected ? (sources.get(selected) ?? "Retained candidate verification") : ""}</small>
          <p>
            {chosen.status} · {chosen.candidateId} r{chosen.candidateRevision} ·{" "}
            {chosen.durationMs == null ? "Duration unavailable" : `${(chosen.durationMs / 1000).toFixed(2)}s`}
          </p>
          <code>{chosen.command}</code>
          {chosen.failureDetails && <p className="form-error">{chosen.failureDetails}</p>}
          <pre>{chosen.output ?? "No command output retained."}</pre>
          {chosen.assertions.map((assertion) => (
            <dl key={JSON.stringify(assertion)}>
              <dt>{assertion.label}</dt>
              <dd>
                Actual: {assertion.actual}
                <br />
                Expected: {assertion.expected ?? "Not recorded"}
              </dd>
            </dl>
          ))}
        </div>
      ) : (
        <div className="test-result-list">
          {entries.map(([id, row]) => (
            <button type="button" className={`text-row ${row.status}`} key={id} onClick={() => select(id)}>
              <span className="state-badge">{row.status}</span>
              <span>
                <strong>{row.title}</strong>
                <small>
                  {row.command} · {row.candidateId} r{row.candidateRevision}
                  {candidate && row.candidateRevision !== candidate.revisionNumber
                    ? " · Previous revision"
                    : ""}
                </small>
                <small>{sources.get(id) ?? "Retained candidate verification"}</small>
              </span>
              <ArrowRight size={17} />
            </button>
          ))}
        </div>
      )}
      {!entries.length && (
        <p className="quiet">
          No structured test rows are loaded. Retained logs and execution failures remain available below.
        </p>
      )}
      {summaries
        .filter((run) => run.error)
        .map((run) => (
          <p
            className={
              run.id === summaries[0]?.id && !gateView(evidence.core, "test").fresh ? "form-error" : "quiet"
            }
            key={run.id}
          >
            Retained attempt {run.attempt ?? "—"} · {run.status}: {run.error}
          </p>
        ))}
    </section>
  );
}

export function JourneyEvidence({
  evidence,
  onStage,
}: {
  evidence: TaskEvidence;
  onStage(stage: (typeof stageIds)[number]): void;
}) {
  const task = evidence.core;
  return (
    <section className="workflow-card">
      <h3>Recorded journey</h3>
      <p className="quiet">
        Task wall time and summed agent runtime differ when work runs in parallel. Pricing is an API-rate
        estimate; the attributable ChatGPT-plan charge is unavailable.
      </p>
      <table className="journey-table">
        <thead>
          <tr>
            <th>Stage</th>
            <th>State</th>
            <th>Tokens</th>
            <th>Agent time</th>
            <th>Outcome</th>
          </tr>
        </thead>
        <tbody>
          {stageIds.map((stage) => {
            const runs = evidence.runs.items.filter((run) => run.stage === stage);
            const artifact = task.artifacts.filter((item) => item.stage === stage).at(-1);
            const started =
              task.completedStages.includes(stage) ||
              runs.length > 0 ||
              artifact ||
              task.currentStage === stage ||
              task.stageDispositions?.[stage];
            return (
              <tr key={stage}>
                <td>
                  <button
                    type="button"
                    className="plain-link"
                    disabled={!started}
                    onClick={() => onStage(stage)}
                  >
                    {stageLabels[stage]}
                  </button>
                </td>
                <td>{started ? stageState(task, stage) : "Not started"}</td>
                <td>
                  {runs.length && runs.every((run) => run.usage)
                    ? formatCount(sumRecorded(runs.map((run) => run.usage?.totalTokens)).value ?? 0)
                    : "—"}
                </td>
                <td>
                  {runs.length && runs.every((run) => run.durationMs != null)
                    ? `${Math.round(runs.reduce((sum, run) => sum + (run.durationMs ?? 0), 0) / 1000)}s`
                    : "—"}
                </td>
                <td>
                  {task.stageDispositions?.[stage]?.reason ??
                    artifact?.name ??
                    (stage === task.currentStage ? task.status.replaceAll("-", " ") : "No retained output")}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <small>
        {evidence.runs.items.length} of {evidence.runs.total} runs loaded.
      </small>
    </section>
  );
}

export function DeliveryEvidence({ task }: { task: TaskCore }) {
  const pr = task.pullRequestIntent;
  if (!pr)
    return (
      <section className="workflow-card">
        <h3>Delivery</h3>
        <p>
          {task.workflow === "investigate"
            ? "This investigation ends with an approved specification."
            : "No pull request has been recorded. Approval and publication are explicit actions."}
        </p>
      </section>
    );
  return (
    <section className="workflow-card delivery-evidence">
      <h3>
        <GitPullRequest size={20} />{" "}
        {task.status === "blocked"
          ? "Delivery blocked"
          : pr.status === "open"
            ? "Awaiting PR merge"
            : pr.status === "merged"
              ? "PR merged"
              : `PR ${pr.status}`}
      </h3>
      <dl>
        <dt>Pull request</dt>
        <dd>
          {pr.repository} {pr.number ? `#${pr.number}` : "Identity pending"}
        </dd>
        <dt>Exact approved head</dt>
        <dd>
          <code>{pr.headRevision}</code>
        </dd>
        <dt>Candidate</dt>
        <dd>
          {pr.candidateId} r{pr.candidateRevision}
        </dd>
        <dt>Target</dt>
        <dd>{pr.targetBranch}</dd>
        <dt>Last GitHub check</dt>
        <dd>{pr.lastCheckedAt ? new Date(pr.lastCheckedAt).toLocaleString() : "Not yet checked"}</dd>
        <dt>Completion</dt>
        <dd>
          {task.status === "blocked"
            ? "Blocked; approved candidate retained"
            : task.completedAt
              ? new Date(task.completedAt).toLocaleString()
              : "Pending exact merge confirmation"}
        </dd>
      </dl>
      {pr.lastError && <p className="form-error">{pr.lastError}</p>}
      {pr.url && /^https:\/\//.test(pr.url) && (
        <a className="button primary" href={pr.url} target="_blank" rel="noreferrer">
          Open pull request <ArrowRight size={17} />
        </a>
      )}
      <p className="quiet">
        The runtime tracks this exact PR, repository, target, and approved head. Opening a PR does not
        complete the task.
      </p>
    </section>
  );
}
