import { formatApproximateCost, formatTokenCount, type RuntimeTask } from "../../domain";
import { buildOperatorFinalReviewRows } from "./operatorFinalReviewModel";

export function RuntimeOperatorFinalReview({
  task,
  onInspectStage,
}: {
  task: RuntimeTask;
  onInspectStage: (stageId: ReturnType<typeof buildOperatorFinalReviewRows>[number]["stageId"]) => void;
}) {
  const rows = buildOperatorFinalReviewRows(task);
  const candidate = task.candidates?.at(-1);
  const totalTokens = rows.reduce((total, row) => total + row.tokens, 0);
  const estimatedRows = rows.filter((row) => row.apiEstimate != null);
  const totalEstimate = estimatedRows.reduce((total, row) => total + (row.apiEstimate ?? 0), 0);
  const estimateLabel = estimatedRows.length
    ? `${formatApproximateCost(totalEstimate)}${estimatedRows.length < rows.length ? " · partial" : ""}`
    : "Unavailable for this task";

  return (
    <section className="runtime-operator-final-review" aria-label="Prior-stage final review summary">
      <header>
        <span>
          <small>Workflow record</small>
          <strong>Every prior stage</strong>
        </span>
        <span className="runtime-operator-final-review__totals">
          <small>{formatTokenCount(totalTokens)} tokens</small>
          <small>API-rate estimate {estimateLabel}</small>
          <small>
            {candidate ? `${candidate.id} r${candidate.revisionNumber}` : "No candidate assembled"}
          </small>
        </span>
      </header>
      <div className="runtime-operator-final-review__table">
        <div className="runtime-operator-final-review__row runtime-operator-final-review__row--head">
          <span>Stage</span>
          <span>State</span>
          <span>Tokens</span>
          <span>Key outcome</span>
        </div>
        {rows.map((row) => (
          <button
            type="button"
            className={`runtime-operator-final-review__row ${row.tone === "red" || row.tone === "amber" ? "is-exception" : ""}`}
            key={row.stageId}
            onClick={() => onInspectStage(row.stageId)}
            aria-label={`Open ${row.label} evidence: ${row.state}`}
          >
            <strong>{row.label}</strong>
            <span className={`runtime-operator-tone--${row.tone}`}>{row.state}</span>
            <span className="mono">{formatTokenCount(row.tokens)}</span>
            <span>
              <strong>{row.outcome}</strong>
              <small>{row.detail}</small>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
