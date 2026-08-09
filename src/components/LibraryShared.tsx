import { CheckCircle } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import {
  formatApproximateCost,
  formatCacheRate,
  formatTokenCount,
  type AgentRoleId,
  type RuntimeTaskSummary,
} from "../domain";
import { isModelRunArtifact, resolveScoutUsage, sumArtifactUsage } from "../artifactPresentation";

export function Metric({ label, value }: { label: string; value: string }) {
  return <div><span><CheckCircle size={16} /> {label}</span><strong>{value}</strong></div>;
}

export function SettingRow({ title, copy, control }: { title: string; copy: string; control: ReactNode }) {
  return <div className="setting-row"><span><strong>{title}</strong><small>{copy}</small></span><div>{control}</div></div>;
}

export function stageUsage(tasks: RuntimeTaskSummary[], stageId: AgentRoleId) {
  const artifacts = stageId === "scouts" || stageId.startsWith("scout-")
    ? tasks.flatMap((task) => {
        const resolved = resolveScoutUsage(task);
        if (stageId === "scouts") return resolved.matchedArtifacts;
        return resolved.perScout.find((entry) => entry.scout.name === stageId)?.artifacts ?? [];
      })
    : tasks
        .flatMap((task) => task.artifacts)
        .filter((artifact) => isModelRunArtifact(artifact) && (artifact.agentRole ?? artifact.stage) === stageId);
  const usage = sumArtifactUsage(artifacts);
  return {
    artifacts,
    tokens: usage.totalTokens,
    ...usage,
  };
}

export function UsageSummary({ tasks, roleId }: { tasks: RuntimeTaskSummary[]; roleId: AgentRoleId }) {
  const usage = stageUsage(tasks, roleId);
  return (
    <div className="detail-metrics detail-metrics--truthful">
      <Metric label="Recorded runs" value={String(usage.runs)} />
      <Metric label="Input / output" value={`${formatTokenCount(usage.inputTokens)} / ${formatTokenCount(usage.outputTokens)}`} />
      <Metric label="Cache rate" value={formatCacheRate(usage)} />
      <Metric label="Approx. cost" value={usage.pricedRuns ? formatApproximateCost(usage.cost) : "Unavailable"} />
      <Metric label="Work credits" value={usage.creditRuns ? usage.credits?.toFixed(3) ?? "Unavailable" : "Unavailable for provider"} />
    </div>
  );
}
