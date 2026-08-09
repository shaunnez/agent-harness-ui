import { CheckCircle } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import {
  formatApproximateCost,
  formatCacheRate,
  formatTokenCount,
  type AgentRoleId,
  type RuntimeArtifactMetadata,
  type RuntimeTaskSummary,
} from "../domain";
import { isModelRunArtifact, resolveScoutUsage, SCOUT_USAGE_NOT_RETAINED, sumArtifactUsage } from "../artifactPresentation";

export function Metric({ label, value }: { label: string; value: string }) {
  return <div><span><CheckCircle size={16} /> {label}</span><strong>{value}</strong></div>;
}

export function SettingRow({ title, copy, control }: { title: string; copy: string; control: ReactNode }) {
  return <div className="setting-row"><span><strong>{title}</strong><small>{copy}</small></span><div>{control}</div></div>;
}

export function stageUsage(tasks: RuntimeTaskSummary[], stageId: AgentRoleId) {
  if ((stageId as string) === "scouts" || stageId.startsWith("scout-")) {
    const matches = tasks.flatMap((task) =>
      resolveScoutUsage(task).perScout.filter((entry) => (stageId as string) === "scouts" || entry.scout.name === stageId),
    );
    const artifacts = distinctArtifacts(matches.flatMap((entry) => entry.artifacts));
    const usage = sumArtifactUsage(artifacts);
    return { artifacts, tokens: usage.totalTokens, ...usage, usageNotRetained: matches.some((entry) => entry.state === "unmatched") };
  }
  const artifacts = tasks
    .flatMap((task) => task.artifacts)
    .filter((artifact) => {
      if (!isModelRunArtifact(artifact)) return false;
      if (stageId === "scouts") return artifact.stage === "scouts" && artifact.agentRole?.startsWith("scout-");
      return (artifact.agentRole ?? artifact.stage) === stageId;
    });
  const usage = sumArtifactUsage(artifacts);
  return { artifacts, tokens: usage.totalTokens, ...usage, usageNotRetained: false };
}

export function recordedRunsLabel(usage: ReturnType<typeof stageUsage>, emptyLabel: string) {
  if (usage.usageNotRetained) return usage.runs ? `${usage.runs} resolved · ${SCOUT_USAGE_NOT_RETAINED}` : SCOUT_USAGE_NOT_RETAINED;
  return usage.runs ? String(usage.runs) : emptyLabel;
}

export function usageValueLabel(usage: ReturnType<typeof stageUsage>, value: string, emptyLabel: string) {
  return usage.usageNotRetained && usage.runs === 0 ? SCOUT_USAGE_NOT_RETAINED : usage.runs ? value : emptyLabel;
}

function distinctArtifacts(artifacts: RuntimeArtifactMetadata[]) {
  const seen = new Set<string>();
  return artifacts.filter((artifact) => !seen.has(artifact.id) && (seen.add(artifact.id), true));
}

export function UsageSummary({ tasks, roleId }: { tasks: RuntimeTaskSummary[]; roleId: AgentRoleId }) {
  const usage = stageUsage(tasks, roleId);
  return (
    <div className="detail-metrics detail-metrics--truthful">
      <Metric label="Recorded runs" value={recordedRunsLabel(usage, "0")} />
      <Metric label="Input / output" value={usageValueLabel(usage, `${formatTokenCount(usage.inputTokens)} / ${formatTokenCount(usage.outputTokens)}`, "0 / 0")} />
      <Metric label="Cache rate" value={usageValueLabel(usage, formatCacheRate(usage), "—")} />
      <Metric label="Approx. cost" value={usageValueLabel(usage, usage.pricedRuns ? formatApproximateCost(usage.cost) : "Unavailable", "Unavailable")} />
      <Metric label="Work credits" value={usageValueLabel(usage, usage.creditRuns ? usage.credits?.toFixed(3) ?? "Unavailable" : "Unavailable for provider", "Unavailable for provider")} />
    </div>
  );
}
