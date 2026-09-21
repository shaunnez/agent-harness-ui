import { ArrowLeft, CheckCircle, Flask, XCircle } from "@phosphor-icons/react";
import { usePanelState } from "../app/panel-state";
import type { TaskEvidence } from "../runtime/contracts";
import { testAttempts } from "../runtime/test-evidence";
import { gateView } from "../runtime/workflow";

export function TestEvidence({ evidence }: { evidence: TaskEvidence }) {
  const [attemptId, selectAttempt] = usePanelState<string | null>(`test-attempt:${evidence.core.id}`, null);
  const [selections, setSelections] = usePanelState<Record<string, string | null>>(
    `test-results:${evidence.core.id}`,
    {},
  );
  const attempts = testAttempts(evidence);
  const attempt = attempts.find((item) => item.id === attemptId) ?? attempts[0];
  const rows = attempt?.rows ?? [];
  const rowId = attempt ? selections[attempt.id] : undefined;
  const chosen =
    rowId === undefined ? rows.find((row) => row.status === "failed") : rows.find((row) => row.id === rowId);
  const selectRow = (id: string | null) => {
    if (attempt) setSelections({ ...selections, [attempt.id]: id });
  };
  const candidate = evidence.core.candidates.at(-1);
  const binding = (id: string | null, revision: number | null) =>
    id === candidate?.id &&
    revision === candidate?.revisionNumber &&
    (!attempt?.headRevision || attempt.headRevision === candidate.headRevision)
      ? "Current candidate revision · see gate status for clearance"
      : "Previous, mismatched or unbound candidate · retained for audit";
  const gate = gateView(evidence.core, "test");
  return (
    <section className="workflow-card test-evidence">
      <header className="panel-heading">
        <span>
          <Flask size={18} />
          <h3>Test results</h3>
        </span>
        <small>Current gate · {gate.label}</small>
      </header>
      <div className={`test-inspection-grid${chosen ? " has-selection" : ""}`}>
        <div className="test-list-column">
          <div className="test-attempt-picker panel-content">
            <label>
              Recorded attempt
              <select
                value={attempt?.id ?? ""}
                onChange={(event) => {
                  selectAttempt(event.target.value);
                }}
                disabled={!attempts.length}
              >
                {!attempts.length && <option value="">No attempts loaded</option>}
                {attempts.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label} · {item.candidateId ?? "Unbound"} r{item.candidateRevision ?? "—"}
                  </option>
                ))}
              </select>
            </label>
            <p className="quiet">
              {attempt
                ? binding(attempt.candidateId, attempt.candidateRevision)
                : "Retained logs and execution failures remain available below."}
            </p>
            <div className="test-counts">
              <span>
                <CheckCircle size={18} />
                {rows.filter((row) => row.status === "passed").length} passed
              </span>
              <span>
                <XCircle size={18} />
                {rows.filter((row) => row.status === "failed").length} failed
              </span>
              <small>
                {rows.length} loaded checks in this attempt
                {attempt && attempt.rowCount > rows.length ? ` · ${attempt.rowCount} reported` : ""}
              </small>
            </div>
            <small>
              {evidence.runs.items.length} of {evidence.runs.total} task runs loaded
              {evidence.runs.nextCursor ? " · Earlier attempts may be unloaded" : ""}.
            </small>
          </div>
          <nav className="test-result-list" aria-label="Test checks">
            {rows.map((row) => (
              <button
                type="button"
                key={row.id}
                className={row.status}
                aria-pressed={row === chosen}
                onClick={() => selectRow(row.id)}
              >
                {row.status === "passed" ? <CheckCircle size={20} /> : <XCircle size={20} />}
                <span>
                  <strong>{row.title}</strong>
                  <small>
                    {row.status} ·{" "}
                    {row.durationMs == null
                      ? "Duration unavailable"
                      : `${(row.durationMs / 1000).toFixed(2)}s`}
                  </small>
                  <small>
                    {row.candidateId} r{row.candidateRevision}
                  </small>
                </span>
              </button>
            ))}
          </nav>
        </div>
        <article className="test-detail">
          {attempt?.error && <p className="form-error">Execution failure: {attempt.error}</p>}
          {chosen ? (
            <>
              <button type="button" onClick={() => selectRow(null)}>
                <ArrowLeft size={17} />
                Back to results
              </button>
              <h3>{chosen.title}</h3>
              <p className={`test-outcome ${chosen.status}`}>
                {chosen.status} · {binding(chosen.candidateId, chosen.candidateRevision)}
              </p>
              <dl>
                <dt>Candidate</dt>
                <dd>
                  {chosen.candidateId} r{chosen.candidateRevision}
                </dd>
                <dt>Command</dt>
                <dd>
                  <code>{chosen.command}</code>
                </dd>
                <dt>Duration</dt>
                <dd>
                  {chosen.durationMs == null ? "Unavailable" : `${(chosen.durationMs / 1000).toFixed(2)}s`}
                </dd>
                <dt>Exit code</dt>
                <dd>{chosen.exitCode ?? "Unavailable"}</dd>
              </dl>
              {chosen.failureDetails && <p className="form-error">{chosen.failureDetails}</p>}
              {chosen.assertions.map((assertion) => (
                <section key={JSON.stringify(assertion)} className="test-assertion">
                  <h4>{assertion.label}</h4>
                  <dl>
                    <dt>Actual</dt>
                    <dd>{assertion.actual}</dd>
                    <dt>Expected</dt>
                    <dd>{assertion.expected ?? "Unavailable"}</dd>
                  </dl>
                </section>
              ))}
              <h4>Retained output</h4>
              <pre>{chosen.output ?? "No command output retained."}</pre>
              {chosen.artifactReferences.map((reference) => (
                <p key={JSON.stringify(reference)}>
                  {reference.name} · {reference.kind}
                  {reference.path && <code>{reference.path}</code>}
                </p>
              ))}
            </>
          ) : (
            <div className="test-detail-empty">
              <Flask size={28} />
              <h3>{rows.length ? "Select a check" : "No structured test rows loaded"}</h3>
              <p>
                {rows.length
                  ? "Inspect its command, assertions and retained output."
                  : "Use the retained report or agent run to inspect available evidence."}
              </p>
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
