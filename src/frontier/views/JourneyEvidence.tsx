import { ClockCounterClockwise } from "@phosphor-icons/react";
import { type StageId, stageIds } from "../../domain";
import type { TaskEvidence } from "../runtime/contracts";
import { formatCount, formatDuration, latestStageArtifact, stageLabels } from "../runtime/presentation";
import { stageUsage } from "../runtime/usage";
import { stageRecorded, stageState } from "../runtime/workflow";
import { recordedMetric } from "./TaskUsage";

export function JourneyEvidence({
  evidence,
  onStage,
  stage,
}: {
  evidence: TaskEvidence;
  stage: "final-review" | "approval";
  onStage(stage: StageId): void;
}) {
  const task = evidence.core;
  const stages = stageIds.slice(0, stage === "approval" ? 9 : 8);
  return (
    <section className="workflow-card journey-evidence">
      <header className="panel-heading">
        <span>
          <ClockCounterClockwise size={18} />
          <h3>Recorded journey</h3>
        </span>
        <small>{stages.length} prior stages</small>
      </header>
      <div className="journey-table-scroll">
        <table className="journey-table">
          <thead>
            <tr>
              <th>Stage</th>
              <th>State</th>
              <th>Tokens</th>
              <th>Execution time</th>
              <th>Approx. cost</th>
              <th>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {stages.map((stage) => {
              const usage = stageUsage(evidence, stage, Date.now());
              const artifact = latestStageArtifact(task.artifacts, stage);
              const recorded = stageRecorded(evidence, stage);
              const metric = (value: typeof usage.tokens, format = formatCount) =>
                recordedMetric(value, format, usage.partialHistory);
              return (
                <tr key={stage}>
                  <td>
                    <button
                      type="button"
                      className="plain-link"
                      disabled={!recorded}
                      onClick={() => onStage(stage)}
                    >
                      {stageLabels[stage]}
                    </button>
                  </td>
                  <td>{recorded ? stageState(task, stage) : "Not started"}</td>
                  <td>{metric(usage.tokens)}</td>
                  <td>{metric(usage.execution, formatDuration)}</td>
                  <td>
                    {usage.cost.value == null ? "—" : metric(usage.cost, (value) => `$${value.toFixed(4)}`)}
                  </td>
                  <td>{task.stageDispositions?.[stage]?.reason ?? artifact?.name ?? "No retained output"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="panel-content quiet">
        <p>
          Execution time sums agent runs, including retries; parallel runs can overlap. Task elapsed time is
          shown separately in the inspector.
        </p>
        <small>
          API-rate estimate · — means cost unavailable. {evidence.runs.items.length} of {evidence.runs.total}{" "}
          task runs loaded. Partial values are labelled; unloaded runs are not counted as zero.
        </small>
      </div>
    </section>
  );
}
