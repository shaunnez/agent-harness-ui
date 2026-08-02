import {
  formatApproximateCost,
  formatCacheRate,
  formatTokenCount,
  type RuntimeTask,
} from "../../domain";

export function RuntimeWorkspaceFooter({
  task,
  activeModel,
}: {
  task: RuntimeTask;
  activeModel: string;
}) {
  return (
<footer className="workspace-footer">
        <span>
          <small>Updated</small>
          <strong className="mono">
            {new Date(task.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </strong>
        </span>
        <span>
          <small>Input</small>
          <strong className="mono">{formatTokenCount(task.usage.inputTokens)}</strong>
        </span>
        <span>
          <small>Output</small>
          <strong className="mono">{formatTokenCount(task.usage.outputTokens)}</strong>
        </span>
        <span>
          <small>Cache rate</small>
          <strong className="mono text-green">{formatCacheRate(task.usage)}</strong>
        </span>
        <span>
          <small>Artifacts</small>
          <strong className="mono">{task.artifacts.length}</strong>
        </span>
        <span className="workspace-footer__usage">
          <small>Configured models</small>
          <i className="provider-dot provider-dot--codex" />
          {[...new Set(task.models.map((item) => item.model))].join(" + ") || activeModel}
        </span>
        <span>
          <small>Work credits</small>
          <strong className="mono">{task.usage.credits == null ? "\u2014" : task.usage.credits.toFixed(3)}</strong>
        </span>
        <span>
          <small>Approx. cost</small>
          <strong className="mono" title="API-rate estimate; ChatGPT-plan charge is not provider-reported">{formatApproximateCost(task.usage.cost)}</strong>
        </span>
      </footer>
  );
}
