import type { RuntimeArtifact, RuntimeUsage } from "./domain";

type AggregatedUsage = Omit<RuntimeUsage, "cacheWriteTokens"> & {
  cacheWriteTokens: number;
  pricedRuns: number;
  creditRuns: number;
};

const STRUCTURED_PAYLOAD_TAGS = [
  "scout-dispatch",
  "scout-report",
  "grill-questions",
  "work-packages",
  "gate-evidence",
  "focused-test-evidence",
  "repair-evidence",
  "verification-proposal",
  "pricing-rates",
  "no-changes-needed",
] as const;

export function stripStructuredArtifactPayloads(content: string) {
  return STRUCTURED_PAYLOAD_TAGS.reduce(
    (visible, tag) => visible.replace(new RegExp(`\\n?<${tag}>[\\s\\S]*?<\\/${tag}>\\n?`, "gi"), "\n"),
    content,
  ).replace(/\n{3,}/g, "\n\n").trim();
}

export function isModelRunArtifact(artifact: RuntimeArtifact) {
  if (!artifact.model || artifact.model === "deterministic-aggregation") return false;
  return Boolean(artifact.runId || artifact.usage.totalTokens > 0);
}

export function sumArtifactUsage(artifacts: RuntimeArtifact[]) {
  const usage = artifacts.reduce(
    (total, artifact) => {
      total.inputTokens += artifact.usage.inputTokens;
      total.cachedInputTokens += artifact.usage.cachedInputTokens;
      total.cacheWriteTokens += artifact.usage.cacheWriteTokens ?? 0;
      total.outputTokens += artifact.usage.outputTokens;
      total.totalTokens += artifact.usage.totalTokens;
      if (artifact.usage.cost != null) {
        total.cost = (total.cost ?? 0) + artifact.usage.cost;
        total.pricedRuns += 1;
      }
      if (artifact.usage.credits != null) {
        total.credits = (total.credits ?? 0) + artifact.usage.credits;
        total.creditRuns += 1;
      }
      return total;
    },
    {
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cost: null,
      credits: null,
      pricedRuns: 0,
      creditRuns: 0,
    } as AggregatedUsage,
  );
  const uncachedInputTokens = Math.max(
    0,
    usage.inputTokens - usage.cachedInputTokens - usage.cacheWriteTokens,
  );
  return {
    ...usage,
    cost: usage.cost == null ? null : Math.round(usage.cost * 1_000_000) / 1_000_000,
    credits: usage.credits == null ? null : Math.round(usage.credits * 1_000_000) / 1_000_000,
    runs: artifacts.length,
    uncachedInputTokens,
    cacheRate: usage.inputTokens > 0 ? (usage.cachedInputTokens / usage.inputTokens) * 100 : 0,
  };
}
