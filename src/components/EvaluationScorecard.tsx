import { CaretDown } from "@phosphor-icons/react";
import { formatApproximateCost, type RuntimeEvaluationSummary, type RuntimeExperimentVariant } from "../domain";

function percentage(successes: number, total: number, rate: number | null) {
  return total ? `${successes}/${total} (${Math.round((rate ?? 0) * 100)}%)` : "No gates";
}

function duration(milliseconds: number | null) {
  if (milliseconds == null) return "—";
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.round((milliseconds % 60_000) / 1_000);
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function quality(variant: RuntimeExperimentVariant) {
  const human = variant.averageHumanScore == null ? null : `Human ${variant.averageHumanScore.toFixed(1)}`;
  const blind = variant.averageBlindScore == null ? null : `Blind ${variant.averageBlindScore.toFixed(1)}`;
  return [human, blind].filter(Boolean).join(" · ") || "No task rating";
}

export function EvaluationScorecard({ summary }: { summary: RuntimeEvaluationSummary | null }) {
  const experiments = summary?.experiments;
  const observations = summary?.observations;
  return (
    <>
      <div className="settings-section__head">
        <span>
          <h3>Controlled experiments</h3>
          <p>{experiments?.methodology ?? "Frozen task variants appear here after they are explicitly attached to an experiment."} {experiments?.taskCount ?? 0} task samples.</p>
        </span>
      </div>
      <div className="evaluation-table">
        <div className="evaluation-table__header"><span>Variant</span><span>Samples</span><span>First pass</span><span>Eventual</span><span>Repairs</span><span>Quality</span></div>
        {(experiments?.variants ?? []).map((variant) => (
          <div className="evaluation-table__row" key={`${variant.groupId}:${variant.variantId}`}>
            <span>
              <strong>{variant.groupId} · {variant.variantId}</strong>
              <small title={variant.frozenBaseSha}>Base {variant.frozenBaseSha.slice(0, 8)} · {variant.taskBriefHashes.length} brief hash{variant.taskBriefHashes.length === 1 ? "" : "es"}</small>
            </span>
            <code>{variant.sampleCount}</code>
            <code>{percentage(variant.firstPassGateSuccesses, variant.gateAttempts, variant.firstPassGateSuccessRate)}</code>
            <code>{percentage(variant.eventualGateSuccesses, variant.gateAttempts, variant.eventualGateSuccessRate)}</code>
            <code>{variant.repairCount} / {variant.retryCount} retry</code>
            <code>{quality(variant)}</code>
          </div>
        ))}
        {!experiments?.variants?.length ? <div className="evaluation-table__empty">No controlled samples yet. Historical runs remain below and are never promoted into experiments automatically.</div> : null}
      </div>
      {(experiments?.variants ?? []).map((variant) => (
        <details className="evaluation-evidence" key={`evidence:${variant.groupId}:${variant.variantId}`}>
          <summary><span><strong>{variant.groupId} · {variant.variantId}</strong><small>Measurement evidence and confound checks</small></span><span>{variant.sampleCount} samples <CaretDown size={15} /></span></summary>
          <div className="evaluation-evidence__metrics">
            <span><small>Avg. wall time</small><strong>{duration(variant.averageWallTimeMs)}</strong></span>
            <span><small>Input / output</small><strong>{variant.inputTokens.toLocaleString()} / {variant.outputTokens.toLocaleString()}</strong></span>
            <span><small>Cache rate</small><strong>{variant.cacheRate == null ? "Unavailable" : `${Math.round(variant.cacheRate * 100)}%`}</strong></span>
            <span><small>Work credits</small><strong>{variant.credits == null ? "Unavailable" : variant.credits.toFixed(2)}</strong></span>
            <span><small>API-rate estimate</small><strong>{variant.apiEstimate == null ? "Unavailable" : formatApproximateCost(variant.apiEstimate)}</strong></span>
            <span><small>Est. context</small><strong>{variant.estimatedContextTokens.toLocaleString()} tokens</strong></span>
          </div>
          <p>{variant.policyMatrices.length} policy snapshot{variant.policyMatrices.length === 1 ? "" : "s"} · {variant.acceptanceDefinitions.length} acceptance definition{variant.acceptanceDefinitions.length === 1 ? "" : "s"} · {variant.verificationDefinitions.length} verification definition{variant.verificationDefinitions.length === 1 ? "" : "s"}. Differences within a variant signal a confound; this view does not claim statistical significance.</p>
        </details>
      ))}

      <div className="settings-section__head settings-section__head--nested">
        <span>
          <h3>Historical observations</h3>
          <p>{observations?.methodology ?? "Observed retained model runs grouped by exact role, model, and reasoning."} Only roles that actually ran appear; deterministic handoffs and unrun skills are omitted. Quality is shown only after an operator records a task evaluation. {observations?.evaluatedTasks ?? summary?.evaluatedTasks ?? 0} tasks currently have ratings.</p>
        </span>
      </div>
      <div className="evaluation-table">
        <div className="evaluation-table__header"><span>Variant</span><span>Runs</span><span>Cache</span><span>Credits</span><span>API est.</span><span>Quality</span></div>
        {(observations?.variants ?? summary?.variants ?? []).map((variant) => (
          <div className="evaluation-table__row" key={`${variant.role}:${variant.model}:${variant.reasoning}`}>
            <span><strong>{variant.role}</strong><small>{variant.model} · {variant.reasoning}</small></span>
            <code>{variant.runs}</code>
            <code>{variant.cacheRate == null ? "—" : `${Math.round(variant.cacheRate * 100)}%`}</code>
            <code>{variant.credits == null ? "—" : variant.credits.toFixed(2)}</code>
            <code>{variant.cost == null ? "—" : formatApproximateCost(variant.cost)}</code>
            <code>{variant.averageHumanScore == null ? "No task rating" : `${variant.averageHumanScore.toFixed(1)} / 5`}</code>
          </div>
        ))}
        {!(observations?.variants ?? summary?.variants)?.length ? <div className="evaluation-table__empty">No observed agent runs yet. The scorecard uses retained runtime evidence and does not invent success rates.</div> : null}
      </div>
    </>
  );
}
