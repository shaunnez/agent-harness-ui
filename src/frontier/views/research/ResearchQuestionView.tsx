import { ArrowSquareOut, CheckCircle, WarningCircle, XCircle } from "@phosphor-icons/react";
import { useState } from "react";
import { errorMessage } from "../../runtime/errors";
import { formatDuration } from "../../runtime/presentation";
import {
  componentCounts,
  formatBand,
  formatNzd,
  type ResearchCheck,
  type ResearchGateway,
  type ResearchGrading,
  type ResearchQuestion,
  type ResearchRunRecord,
  researchCheckCopy,
  researchEngineLabel,
  researchEnginePlan,
  researchStatusCopy,
  reviewState,
  reviewStateCopy,
  runFailureCopy,
  runsDisagree,
} from "../../runtime/research";
import { CollapsibleText } from "../../ui/CollapsibleText";
import { ResearchCheckBadge, ResearchStatusBadge } from "./ResearchBadges";
import { ResearchScopePanel } from "./ResearchScope";
import { pendingPoll, useResearch } from "./use-research";

/** A QV CostBuilder rowId is a long content hash plus a `:table:row` locator. Never show the raw
 *  hash in the UI — the locator is the only human-legible part. */
function qvRowLabel(rowId: string): string {
  const locator = rowId.split(":").slice(1).join(":");
  return locator ? `QV ${locator}` : "QV row";
}

const statusExplanation: Record<ResearchQuestion["status"], string> = {
  agreed: "All three runs banded within 1.25× on the low end and 1.35× on the high. Read the consensus.",
  single_run:
    "A Quick question: one run priced it, and no second run checked the band. Ask again with three runs before relying on it.",
  disputed:
    "The runs disagree by more than 1.25× low or 1.35× high. The disagreement is the finding: compare the runs to see which part of the scope is still open.",
  not_established:
    "No run could price the main cost drivers. That is an answer, not an error: the open questions say who to ask.",
  incomplete:
    "A run did not finish, so agreement cannot be judged. A run that did not finish is not a run that found nothing.",
  running: "The runs are still working. The answer appears when all of them finish.",
  queued: "The runs have not started.",
};

export function ResearchQuestionView({
  research,
  questionId,
  connected,
}: {
  research: ResearchGateway | undefined;
  questionId: string;
  connected: boolean;
}) {
  const {
    value: question,
    error,
    reload,
  } = useResearch(research, (gateway) => gateway.question(questionId), questionId, pendingPoll);
  const [runId, setRunId] = useState<string | null>(null);
  if (!research)
    return (
      <div className="overlay-body">
        <p className="empty-state">The research backend does not serve questions yet.</p>
      </div>
    );
  if (error)
    return (
      <div className="overlay-body">
        <p role="alert" className="form-error">
          {error}
        </p>
        <button type="button" onClick={reload}>
          Retry
        </button>
      </div>
    );
  if (!question)
    return (
      <div className="overlay-body">
        <p className="quiet">Loading the question and its evidence…</p>
      </div>
    );
  const selectedRun = question.runs.find((run) => run.run === runId) ?? question.runs[0];
  const finished = question.status !== "running" && question.status !== "queued";
  return (
    <div className="overlay-body research-detail">
      <ReviewCommand question={question} research={research} connected={connected} onReviewed={reload} />
      <p className={`research-provenance provenance-${question.provenance}`}>{question.provenanceNote}</p>
      <div className="research-detail-grid">
        <div className="research-detail-main">
          <section className="research-panel" aria-labelledby="research-answer-heading">
            <header className="research-panel-heading">
              <h2 id="research-answer-heading">Answer</h2>
              <ResearchStatusBadge question={question} />
            </header>
            <p className="quiet">{statusExplanation[question.status]}</p>
            {question.status === "disputed" &&
              question.agreement.runsWithBand === 1 &&
              question.agreement.runsTotal > 1 && (
                <p className="research-units-differ" role="note">
                  Only one of the {question.agreement.runsTotal} runs found a band; the others could not price
                  it. One band cannot agree with itself.
                </p>
              )}
            {question.unitsDiffer && (
              <p className="research-units-differ" role="note">
                {question.scope
                  ? `The scope asks for a price ${question.scope.measure}, and the runs priced it as: ${question.unitsDiffer.join("; ")}. A band in another measure answers a different question, so there is no consensus.`
                  : `The runs priced this in different units (${question.unitsDiffer.join("; ")}), so their bands cannot be compared and there is no consensus.`}
              </p>
            )}
            {question.grading && <GradingNote grading={question.grading} />}
            {finished && (
              <>
                <div className="research-answer-bands">
                  <div className={question.status === "agreed" ? "is-headline" : undefined}>
                    <small>Consensus · median of the runs</small>
                    <strong>
                      {question.consensus
                        ? formatBand(question.consensus.low, question.consensus.high)
                        : "No band"}
                    </strong>
                  </div>
                  <div className={question.status !== "agreed" ? "is-headline" : undefined}>
                    <small>Range · every run's band</small>
                    <strong>
                      {question.range ? formatBand(question.range.min, question.range.max) : "No band"}
                    </strong>
                  </div>
                  <div>
                    <small>Agreement</small>
                    <strong>
                      {question.agreement.runsWithBand} of {question.agreement.runsTotal} runs banded
                    </strong>
                    {question.agreement.lowRatio != null && question.agreement.highRatio != null && (
                      <span>
                        ×{question.agreement.lowRatio.toFixed(3)} low · ×
                        {question.agreement.highRatio.toFixed(3)} high
                      </span>
                    )}
                  </div>
                </div>
                <dl className="research-disqualifiers">
                  <div>
                    <dt>Unit</dt>
                    <dd>{question.unit ?? "Not stated"}</dd>
                  </div>
                  <div>
                    <dt>Currency</dt>
                    <dd>{question.currency}</dd>
                  </div>
                  <div>
                    <dt>GST</dt>
                    <dd>{question.gstBasis}</dd>
                  </div>
                  <div>
                    <dt>Centre</dt>
                    <dd>{question.centre ?? "Not stated"}</dd>
                  </div>
                  <div>
                    <dt>As of</dt>
                    <dd>{question.asOf ?? "—"}</dd>
                  </div>
                </dl>
                {question.basis && <CollapsibleText text={question.basis} label="basis" />}
              </>
            )}
          </section>
          <section className="research-panel" aria-labelledby="research-runs-heading">
            <header className="research-panel-heading">
              <h2 id="research-runs-heading">{runsDisagree(question) ? "The runs, side by side" : "Runs"}</h2>
              <small>
                {question.runsPlanned === 1
                  ? "Quick ask · one run cannot show disagreement"
                  : question.staged && !question.staged.extended
                    ? `${question.staged.firstRuns} of ${question.runsPlanned} independent runs · two more only if these disagree`
                    : `${question.runsPlanned} independent runs`}
              </small>
            </header>
            <div className="research-runs" role="tablist" aria-label="Runs">
              {question.runs.map((run) => (
                <RunCard
                  key={run.run}
                  run={run}
                  selected={run.run === selectedRun?.run}
                  onSelect={() => setRunId(run.run)}
                />
              ))}
            </div>
            {selectedRun && <RunDetail run={selectedRun} />}
          </section>
        </div>
        <aside className="research-detail-aside">
          <ResearchScopePanel question={question} />
          {Boolean(question.priorAttempts?.length) && (
            <section className="research-panel">
              <h3>Previous attempts</h3>
              <ul className="research-open">
                {question.priorAttempts?.map((attempt) => (
                  <li key={`${attempt.attempt}-${attempt.run}`}>
                    Attempt {attempt.attempt} · {attempt.run} · <code>{attempt.id}</code> ·{" "}
                    {attempt.errorMessage ?? attempt.errorCode ?? attempt.status}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <CitationSummary question={question} />
          <QvSources question={question} />
          {question.webSources.length > 0 && (
            <section className="research-panel">
              <h3>Web pages cited</h3>
              <ul className="research-links">
                {question.webSources.map((url) => (
                  <li key={url}>
                    <a href={url} target="_blank" rel="noreferrer">
                      {url.replace(/^https?:\/\//, "")}
                      <ArrowSquareOut size={14} />
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {question.openQuestions.length > 0 && (
            <section className="research-panel">
              <h3>Open questions · {question.openQuestions.length}</h3>
              <p className="quiet">Everything a run could not establish.</p>
              <ul className="research-open">
                {question.openQuestions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          )}
          <section className="research-panel">
            <h3>Question</h3>
            <p className="quiet">
              {researchEnginePlan(question.engine)} · {researchEngineLabel(question.engine)}
            </p>
            <CollapsibleText text={question.objective} label="scope" />
            <dl className="research-facts">
              <div>
                <dt>Asked</dt>
                <dd>{new Date(question.askedAt).toLocaleString()}</dd>
              </div>
              <div>
                <dt>Elapsed</dt>
                <dd>{question.elapsedMs ? formatDuration(question.elapsedMs) : "Not recorded"}</dd>
              </div>
              <div>
                <dt>Approx. cost</dt>
                <dd>
                  {question.costUsd != null
                    ? `$${question.costUsd.toFixed(2)} API-rate estimate`
                    : "Not recorded"}
                </dd>
              </div>
              <div>
                <dt>Evidence</dt>
                <dd>
                  <code>{question.evidenceSha}</code>
                </dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}

function ReviewCommand({
  question,
  research,
  connected,
  onReviewed,
}: {
  question: ResearchQuestion;
  research: ResearchGateway;
  connected: boolean;
  onReviewed(): void;
}) {
  const [decision, setDecision] = useState<"approved" | "rejected" | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const state = reviewState(question);
  const copy = reviewStateCopy[state];
  const status = researchStatusCopy[question.status];
  async function submit() {
    if (!decision) return;
    setBusy(true);
    setProblem(null);
    try {
      await research.review(question.id, { decision, note, evidenceSha: question.evidenceSha });
      setDecision(null);
      setNote("");
      onReviewed();
    } catch (reason) {
      setProblem(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  async function retryStart() {
    if (!research.retry) return;
    setBusy(true);
    setProblem(null);
    try {
      await research.retry(question.id);
      onReviewed();
    } catch (reason) {
      setProblem(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={`workflow-command research-command tone-${status.tone}`} aria-label="Question review">
      <div className="workflow-command-row">
        <span className="workflow-command-copy">
          <span className="workflow-command-title">
            <strong>{question.title}</strong>
            <em>{status.label}</em>
          </span>
          <small>
            {copy.label}
            {question.review &&
              ` · ${question.review.reviewer}, ${new Date(question.review.decidedAt).toLocaleDateString()}`}
            {" · "}evidence <code>{question.evidenceSha}</code>
          </small>
        </span>
        {question.retryable && research.retry && (
          <button
            type="button"
            className="primary"
            disabled={!connected || busy}
            onClick={() => void retryStart()}
          >
            Retry{" "}
            {question.runsPlanned === 1
              ? "Quick · one run"
              : question.staged
                ? `${question.staged.firstRuns} runs`
                : `${question.runsPlanned} runs`}
          </button>
        )}
        {state !== "not-ready" && !decision && (
          <span className="inline-controls research-command-actions">
            <button type="button" disabled={!connected} onClick={() => setDecision("rejected")}>
              <XCircle size={18} />
              Reject
            </button>
            <button
              type="button"
              className="primary"
              disabled={!connected}
              onClick={() => setDecision("approved")}
            >
              <CheckCircle size={18} />
              {state === "approved" ? "Approve again" : "Approve answer"}
            </button>
          </span>
        )}
      </div>
      {question.review && (
        <div className={`research-review tone-${copy.tone}`}>
          {state === "out-of-date" && <WarningCircle size={18} />}
          <p>
            <strong>{question.review.decision === "approved" ? "Approved" : "Rejected"}</strong>
            {question.review.note ? ` · ${question.review.note}` : ""}
            {state === "out-of-date" &&
              ` The evidence has changed since (reviewed ${question.review.evidenceSha}, now ${question.evidenceSha}). Review it again.`}
          </p>
        </div>
      )}
      {decision && (
        <form
          className="research-review-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label>
            <span>{decision === "approved" ? "Note (optional)" : "Why is it rejected?"}</span>
            <textarea
              value={note}
              required={decision === "rejected"}
              rows={2}
              onChange={(event) => setNote(event.target.value)}
              placeholder={
                decision === "approved"
                  ? "What you checked, or what a reader should know"
                  : "Which run, figure or disqualifier is wrong"
              }
            />
          </label>
          <small>
            Pinned to evidence <code>{question.evidenceSha}</code>. If the evidence changes, this review shows
            as out of date.
          </small>
          {problem && (
            <p role="alert" className="form-error">
              {problem}
            </p>
          )}
          <div className="inline-controls">
            <button type="button" disabled={busy} onClick={() => setDecision(null)}>
              Cancel
            </button>
            <button
              type="submit"
              className="primary"
              disabled={busy || !connected || (decision === "rejected" && !note.trim())}
            >
              {busy ? "Saving…" : decision === "approved" ? "Record approval" : "Record rejection"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function RunCard({
  run,
  selected,
  onSelect,
}: {
  run: ResearchRunRecord;
  selected: boolean;
  onSelect(): void;
}) {
  const checks = run.components.reduce<Partial<Record<ResearchCheck, number>>>((counts, component) => {
    counts[component.check] = (counts[component.check] ?? 0) + 1;
    return counts;
  }, {});
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      className={`research-run run-${run.status} ${selected ? "is-selected" : ""}`}
      onClick={onSelect}
    >
      <span className="research-run-id">{run.run}</span>
      {run.dropped && <small>Not scored: furthest of the runs</small>}
      {run.status === "failed" ? (
        <>
          <strong className="tone-blocked">{runFailureCopy(run)}</strong>
          <small>{run.error?.message}</small>
        </>
      ) : run.status === "running" ? (
        <>
          <strong>Running</strong>
          <small>{run.activity.at(-1)?.label ?? "Started"}</small>
        </>
      ) : run.status === "queued" ? (
        <>
          <strong>Not started</strong>
          <small>Waiting for the research backend</small>
        </>
      ) : (
        <>
          <strong>{run.low != null ? formatBand(run.low, run.high) : "No band"}</strong>
          <small>
            {[run.confidence && `${run.confidence} confidence`, run.resolvedFrom].filter(Boolean).join(" · ")}
          </small>
          <span className="research-run-checks">
            {run.components.length} components
            {checks.allowance ? ` · ${checks.allowance} allowance${checks.allowance > 1 ? "s" : ""}` : ""}
            {run.costUsd != null ? ` · $${run.costUsd.toFixed(2)} est.` : ""}
          </span>
        </>
      )}
    </button>
  );
}

function RunDetail({ run }: { run: ResearchRunRecord }) {
  if (run.status === "running" || run.activity.length)
    return (
      <div className="research-run-detail" role="tabpanel">
        <h3>Activity · {run.run}</h3>
        <ol className="research-activity">
          {run.activity.map((event, index) => (
            // Two tool calls can land in the same millisecond; the position keeps each row its own.
            // biome-ignore lint/suspicious/noArrayIndexKey: the feed is append-only and never reordered.
            <li key={`${index}-${event.at}-${event.label}`} className={`activity-${event.kind}`}>
              <time dateTime={event.at}>
                {new Date(event.at).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </time>
              <strong>{event.label}</strong>
              {event.detail && <span>{event.detail}</span>}
            </li>
          ))}
        </ol>
      </div>
    );
  if (run.status === "queued")
    return (
      <div className="research-run-detail" role="tabpanel">
        <p className="quiet">This run has not started.</p>
      </div>
    );
  return (
    <div className="research-run-detail" role="tabpanel">
      {run.status === "failed" && (
        <p className="research-failure">
          <WarningCircle size={18} />
          {runFailureCopy(run)}. {run.error?.message}
        </p>
      )}
      {run.basis && <CollapsibleText text={run.basis} label={`${run.run} basis`} />}
      {run.components.length > 0 && (
        <div className="research-components-scroll">
          <table className="research-components">
            <thead>
              <tr>
                <th>Component · {run.run}</th>
                <th>Amount</th>
                <th>Check</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {run.components.map((component) => (
                <tr
                  key={`${component.role}|${component.rowId ?? component.source ?? component.basis}|${component.low}|${component.high}`}
                >
                  <td>
                    <strong>{component.role}</strong>
                    {component.caveat && <small>{component.caveat}</small>}
                  </td>
                  <td>
                    {component.low === component.high
                      ? formatNzd(component.low)
                      : formatBand(component.low, component.high)}
                    {component.unit && <small>{component.unit}</small>}
                    {component.rate && component.quantity && (
                      <small>
                        {formatBand(component.rate.low, component.rate.high)}
                        {component.rate.unit ? ` ${component.rate.unit}` : ""} ×{" "}
                        {component.quantity.low === component.quantity.high
                          ? component.quantity.low
                          : `${component.quantity.low}–${component.quantity.high}`}
                        {component.quantity.unit ? ` ${component.quantity.unit}` : ""}
                      </small>
                    )}
                  </td>
                  <td>
                    <ResearchCheckBadge check={component.check} />
                  </td>
                  <td>
                    {component.rowId ? (
                      <code title={component.rowId}>{qvRowLabel(component.rowId)}</code>
                    ) : component.source ? (
                      <a href={component.source.split(" ; ")[0]} target="_blank" rel="noreferrer">
                        {component.source.replace(/^https?:\/\//, "").split(/[/?]/)[0]}
                        {component.page ? ` · p${component.page}` : ""}
                        <ArrowSquareOut size={13} />
                      </a>
                    ) : (
                      <span className="quiet">{component.basis === "allowance" ? "Assumed" : "None"}</span>
                    )}
                    {component.excerpt && (
                      <blockquote>{component.excerpt.replace(/\s+/g, " ").trim()}</blockquote>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {run.notEstablished.length > 0 && (
        <>
          <h3>Not established by {run.run}</h3>
          <ul className="research-open">
            {run.notEstablished.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function CitationSummary({ question }: { question: ResearchQuestion }) {
  const counts = componentCounts(question);
  const shown = (Object.keys(counts) as ResearchCheck[]).filter((check) => counts[check] > 0);
  return (
    <section className="research-panel">
      <h3>Citation checks</h3>
      {!question.citationsChecked && (
        <p className="quiet">
          {question.provenance === "live"
            ? "No checked citations have been recorded for this question yet. Do not treat an uncited figure as verified."
            : "These runs were recorded before the harness checked citations. QV rows were matched against the capture afterwards; web figures were never fetched."}
        </p>
      )}
      {shown.length ? (
        <ul className="research-check-counts">
          {shown.map((check) => (
            <li key={check}>
              <ResearchCheckBadge check={check} />
              <strong>{counts[check]}</strong>
              <small>{researchCheckCopy[check].detail}</small>
            </li>
          ))}
        </ul>
      ) : (
        <p className="quiet">No components cited yet.</p>
      )}
    </section>
  );
}

function QvSources({ question }: { question: ResearchQuestion }) {
  if (!question.qvSources.length) return null;
  const centre = question.centre?.replace(/ assumed$/, "") ?? "Auckland";
  return (
    <section className="research-panel">
      <h3>QV rows cited · {question.qvSources.length}</h3>
      <ul className="research-qv">
        {question.qvSources.map((row) => (
          <li key={row.rowId}>
            <details>
              <summary>
                <span>
                  <strong>{row.desc ?? qvRowLabel(row.rowId)}</strong>
                  <small title={row.rowId}>{row.section ?? "Row text not bundled with this sample"}</small>
                </span>
                <span className="research-qv-rate">
                  {row.regional[centre] ? `$${row.regional[centre]}` : "—"}
                  <small>
                    {row.unit ?? ""} · cited by {row.citedBy}/{question.runs.length}
                  </small>
                </span>
              </summary>
              {row.group && <p className="quiet">{row.group}</p>}
              {Object.keys(row.regional).length > 0 && (
                <dl className="research-regional">
                  {Object.entries(row.regional).map(([place, price]) => (
                    <div key={place} className={place === centre ? "is-centre" : undefined}>
                      <dt>{place}</dt>
                      <dd>${price}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {row.url && (
                <a href={row.url} target="_blank" rel="noreferrer">
                  Open in QV CostBuilder <ArrowSquareOut size={13} />
                </a>
              )}
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** What goes back to a tender for this question, and why. */
function GradingNote({ grading }: { grading: ResearchGrading }) {
  const band = grading.bestBand ? formatBand(grading.bestBand.low, grading.bestBand.high) : null;
  const range = grading.range ? formatBand(grading.range.low, grading.range.high) : null;
  const text =
    grading.grade === "confident"
      ? `Confident: ${band} goes back to the tender.`
      : grading.grade === "unsure"
        ? `Wide estimate: ${band} goes back to the tender, flagged, with the full range ${range}.`
        : grading.grade === "no_price"
          ? "No price: no run could source the main costs, so the tender item reads not established."
          : `Needs review before anything goes back to the tender. ${grading.reasons.join(" ")}`;
  return (
    <p className={`research-grading grade-${grading.grade}`} role="note">
      {text}
    </p>
  );
}
