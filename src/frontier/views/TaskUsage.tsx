import { ChartBar, Clock } from "@phosphor-icons/react";
import type { StageId } from "../../domain";
import type { TaskEvidence } from "../runtime/contracts";
import { formatCount, formatDuration, stageLabels } from "../runtime/presentation";
import { finite, stageUsage, type sumRecorded, taskWallTime } from "../runtime/usage";

export function recordedMetric(
  metric: ReturnType<typeof sumRecorded>,
  format: (value: number) => string,
  partialHistory = false,
) {
  if (metric.value == null) return "Unavailable";
  const partial = partialHistory || metric.known < metric.total;
  return `${format(metric.value)}${partial ? " · partial" : ""}`;
}

export function TaskUsage({
  evidence,
  stage,
  onMore,
}: {
  evidence: TaskEvidence;
  stage: StageId;
  onMore(): void;
}) {
  const now = Date.now();
  const usage = stageUsage(evidence, stage, now);
  const task = evidence.core;
  const count = (value: unknown) => (finite(value) == null ? "Unavailable" : formatCount(value as number));
  const dollars = (value: number) => `$${value.toFixed(4)}`;
  const metric = (value: ReturnType<typeof sumRecorded>, format = formatCount) =>
    recordedMetric(value, format, usage.partialHistory);
  const elapsed = taskWallTime(task, now);
  return (
    <>
      <section className="stage-usage" aria-label={`Stage usage — ${stageLabels[stage]}`}>
        <h3>
          <ChartBar size={18} />
          Stage usage — {stageLabels[stage]}
        </h3>
        <dl className="inspector-key-values">
          <dt>Execution time</dt>
          <dd>{metric(usage.execution, formatDuration)}</dd>
          <dt>Input tokens</dt>
          <dd>{metric(usage.input)}</dd>
          <dt>Output tokens</dt>
          <dd>{metric(usage.output)}</dd>
          <dt>Cached tokens</dt>
          <dd>{metric(usage.cached)}</dd>
          <dt>Cache rate</dt>
          <dd>
            {usage.cacheRate == null
              ? "Unavailable"
              : `${Math.round(usage.cacheRate * 100)}%${usage.partialHistory ? " · partial" : ""}`}
          </dd>
          <dt>Approx. cost</dt>
          <dd>{metric(usage.cost, dollars)}</dd>
        </dl>
        <small>
          API-rate estimate · Recorded runs, including retries. Execution time sums agent runs; parallel work
          can overlap.
        </small>
        <small>
          {usage.runCount} stage runs loaded{usage.partialHistory ? " · Partial task run history" : ""}.
        </small>
        {evidence.runs.nextCursor && (
          <button type="button" onClick={onMore}>
            Load earlier runs
          </button>
        )}
      </section>
      <section className="task-usage-total" aria-label="Task total usage">
        <h3>
          <Clock size={18} />
          Task total
        </h3>
        <dl className="inspector-key-values">
          <dt>Task elapsed</dt>
          <dd>{elapsed == null ? "Unavailable" : formatDuration(elapsed)}</dd>
          <dt>Total tokens</dt>
          <dd>{count(task.usage?.totalTokens)}</dd>
          <dt>Approx. cost</dt>
          <dd>
            {task.usage?.pricingVersion && finite(task.usage.cost) != null
              ? dollars(task.usage.cost as number)
              : "Unavailable"}
          </dd>
        </dl>
        <small>
          API-rate estimate
          {task.usage?.pricingVersion ? ` · ${task.usage.pricingVersion}` : " · Rate card unavailable"}
        </small>
      </section>
    </>
  );
}
