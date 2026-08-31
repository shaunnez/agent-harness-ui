import { formatApproximateCost, formatTokenCount, type RuntimeTask } from "../../domain";
import { buildOperatorFinalReviewRows } from "./operatorFinalReviewModel";

export function RuntimeOperatorFinalReview({ task }: { task: RuntimeTask }) {
  const rows = buildOperatorFinalReviewRows(task);
  const candidate = task.candidates?.at(-1);

  return (
    <section className="runtime-operator-final-review" aria-label="Prior-stage final review summary">
      <header>
        <span>
          <small>Workflow record</small>
          <strong>Every prior stage</strong>
        </span>
        <small>{candidate ? `${candidate.id} r${candidate.revisionNumber}` : "No candidate assembled"}</small>
      </header>
      <div className="runtime-operator-final-review__table">
        <div className="runtime-operator-final-review__row runtime-operator-final-review__row--head">
          <span>Stage</span>
          <span>State</span>
          <span>Tokens</span>
          <span>API-rate estimate</span>
          <span>Key outcome</span>
        </div>
        {rows.map((row) => (
          <div className="runtime-operator-final-review__row" key={row.stageId}>
            <strong>{row.label}</strong>
            <span className={`runtime-operator-tone--${row.tone}`}>{row.state}</span>
            <span className="mono">{formatTokenCount(row.tokens)}</span>
            <span>
              {row.apiEstimate == null
                ? "Unavailable"
                : `${formatApproximateCost(row.apiEstimate)}${row.estimatePartial ? " · partial" : ""}`}
            </span>
            <span title={row.detail}>
              <strong>{row.outcome}</strong>
              <small>{row.detail}</small>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
