import { ArrowRight, Binoculars, FileText, GearSix, Info } from "@phosphor-icons/react";
import type { RuntimeRun } from "../../domain";
import { workflowStages } from "../../domain";
import type { TaskSummary } from "../runtime/contracts";
import {
  attentionAction,
  attentionFor,
  formatApproximateCost,
  formatCount,
  formatDuration,
  modelLabel,
  reasoningLabel,
  stageLabels,
} from "../runtime/presentation";
import { taskWallTime } from "../runtime/usage";

export function SelectionHud({
  task,
  run,
  loading,
  connected,
  onAction,
  onInspect,
  onWatch,
  onArtifact,
  onPolicies,
  portrait = "/assets/mf.worker.standard.portrait.r1.png",
}: {
  task: TaskSummary;
  run?: RuntimeRun;
  loading: boolean;
  connected: boolean;
  onAction(): void;
  onInspect(): void;
  onWatch(): void;
  onArtifact(id: string): void;
  onPolicies(): void;
  portrait?: string;
}) {
  const attention = attentionFor(task);
  const action = attentionAction(task);
  const watchPrimary = connected && action === "Inspect task" && Boolean(run);
  const artifacts = task.artifacts ?? [];
  const latestArtifact = artifacts.reduce<(typeof artifacts)[number] | undefined>(
    (latest, artifact) =>
      !latest || Date.parse(artifact.createdAt) >= Date.parse(latest.createdAt) ? artifact : latest,
    undefined,
  );
  const skill = workflowStages.find((stage) => stage.id === task.currentStage)?.skill;
  const elapsed = taskWallTime(task, Date.now());
  return (
    <section className={`selection-hud panel tone-${attention.kind}`} aria-label="Selected task">
      <div className={`selection-main ${artifacts.length ? "with-artifacts" : ""}`}>
        <div className="selection-identity">
          <img className="worker-portrait" src={portrait} alt="Worker role" />
          <div className="selection-copy">
            <h2>
              {task.id} · {stageLabels[task.currentStage]}
            </h2>
            <p className="selection-title" title={task.title}>
              {task.title}
            </p>
            <strong className="state-copy">
              {connected ? attention.label : `Last known · ${attention.label}`}
            </strong>
            <dl className="selection-fields">
              <div>
                <dt>Skill</dt>
                <dd title="Configured stage skill">{skill ?? "Not configured"}</dd>
              </div>
              <div>
                <dt>Model</dt>
                <dd title={run ? `Recorded ${stageLabels[run.stage]} run` : undefined}>
                  {run
                    ? `${modelLabel(run.model)} · ${reasoningLabel(run.reasoning)}`
                    : loading
                      ? "Loading recorded worker…"
                      : "No recorded run"}
                </dd>
              </div>
            </dl>
          </div>
        </div>
        <div className="selection-actions">
          {(watchPrimary || action !== "Inspect task") && (
            <button type="button" className="primary" onClick={watchPrimary ? onWatch : onAction}>
              {watchPrimary ? "Watch agent" : action}
              <ArrowRight size={18} />
            </button>
          )}
          <button
            type="button"
            className={action === "Inspect task" && !watchPrimary ? "primary" : undefined}
            onClick={onInspect}
          >
            <Binoculars size={18} />
            Inspect
          </button>
          <button type="button" onClick={onPolicies}>
            <GearSix size={18} />
            Configure agent
          </button>
        </div>
        {latestArtifact && (
          <section className="selection-artifacts" aria-label="Latest task artifact">
            <header>
              <span>Artifacts</span>
              {artifacts.length > 1 && (
                <button type="button" className="link-button" onClick={onInspect}>
                  See more
                </button>
              )}
            </header>
            <div className="selection-artifact-cards">
              <button
                type="button"
                className={`selection-artifact stage-${latestArtifact.stage}`}
                onClick={() => onArtifact(latestArtifact.id)}
              >
                <FileText size={23} />
                <strong>{latestArtifact.name}</strong>
                <small>{stageLabels[latestArtifact.stage]}</small>
              </button>
            </div>
          </section>
        )}
      </div>
      <section className="selection-usage" aria-label="Recorded task usage">
        <span>Usage</span>
        <strong>{formatCount(task.usage.totalTokens)} tokens</strong>
        <span title="Task elapsed time">{formatDuration(elapsed)}</span>
        <span>Approx. cost {formatApproximateCost(task.usage.cost, task.usage.pricingVersion)}</span>
        <Info size={17} aria-label="API-rate estimates are not attributable ChatGPT-plan charges" />
        <small title={task.usage.pricingVersion ?? "No recorded usage with a supported rate card"}>
          {task.usage.pricingVersion ? "API-rate estimate" : "Rate card unavailable"}
        </small>
      </section>
    </section>
  );
}
