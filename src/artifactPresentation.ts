import type {
  RuntimeArtifact,
  RuntimeArtifactMetadata,
  RuntimeTask,
  RuntimeTaskSummary,
  RuntimeUsage,
} from "./domain";

type UsageArtifact =
  | Pick<RuntimeArtifact, "model" | "runId" | "usage">
  | Pick<RuntimeArtifactMetadata, "model" | "runId" | "usage">;
type UsageArtifactWithName = UsageArtifact & { name?: string };

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
  )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function isModelRunArtifact(artifact: UsageArtifactWithName) {
  if (isRepositoryScoutHandoff(artifact)) return false;
  if (!artifact.model || artifact.model === "deterministic-aggregation") return false;
  return Boolean(artifact.runId || artifact.usage.totalTokens > 0);
}

export const SCOUT_USAGE_NOT_RETAINED = "Usage was not retained";

type ScoutTask = RuntimeTask | RuntimeTaskSummary;
type ScoutArtifact = RuntimeArtifact | RuntimeArtifactMetadata;
type ScoutDispatchEntry = NonNullable<ScoutTask["scoutDispatch"]>["selected"][number];
type ScoutUsage = ReturnType<typeof sumArtifactUsage>;

export type ScoutUsageMatch<Artifact extends ScoutArtifact = ScoutArtifact> = {
  scout: ScoutDispatchEntry;
  artifacts: Artifact[];
  representativeArtifact: Artifact | null;
  usage: ScoutUsage;
  matchedBy: "agent-role" | "run-id" | "artifact-name" | null;
  state: "matched" | "unmatched";
  unmatchedReason: "missing" | "ambiguous" | null;
};

export interface ScoutUsageResolution<Artifact extends ScoutArtifact = ScoutArtifact> {
  aggregate: ScoutUsage;
  perScout: ScoutUsageMatch<Artifact>[];
  matchedArtifacts: Artifact[];
  unmatched: ScoutUsageMatch<Artifact>[];
}

function artifactBasename(value: string) {
  return value.replaceAll("\\", "/").split("/").at(-1) ?? value;
}

function isRepositoryScoutHandoff(artifact: { name?: string }) {
  return artifact.name != null && artifactBasename(artifact.name).toLowerCase() === "repository-scout.md";
}

function distinctArtifacts(artifacts: ScoutArtifact[]) {
  const seen = new Set<string>();
  return artifacts.filter((artifact) => {
    if (seen.has(artifact.id)) return false;
    seen.add(artifact.id);
    return true;
  });
}

function scoutRunIds(task: ScoutTask, scout: ScoutDispatchEntry) {
  return new Set(
    (task.runs ?? []).filter((run) => run.stage === "scouts" && run.role === scout.name).map((run) => run.id),
  );
}

function matchesScoutRun(
  task: ScoutTask,
  artifact: ScoutArtifact,
  scout: ScoutDispatchEntry,
  runIds: Set<string>,
) {
  return Boolean(
    (artifact.runId && runIds.has(artifact.runId)) ||
      (task.runs ?? []).some(
        (run) => run.stage === "scouts" && run.role === scout.name && run.artifactId === artifact.id,
      ),
  );
}

function matchesScoutArtifactName(artifact: ScoutArtifact, scout: ScoutDispatchEntry) {
  const basename = artifactBasename(artifact.name);
  return basename === scout.name || basename === `${scout.name}.md`;
}

/**
 * Resolve presentation usage for the selected repository scouts only.
 *
 * Matching is intentionally priority-ordered and each artifact can be claimed
 * by only one dispatch row. An unmatched row keeps a real zero-valued usage
 * object so callers never imply tokens for a historical run that is absent.
 */
export function resolveScoutUsage(task: RuntimeTask): ScoutUsageResolution<RuntimeArtifact>;
export function resolveScoutUsage(task: RuntimeTaskSummary): ScoutUsageResolution<RuntimeArtifactMetadata>;
export function resolveScoutUsage(task: ScoutTask): ScoutUsageResolution<ScoutArtifact> {
  const eligibleArtifacts = distinctArtifacts(
    task.artifacts.filter((artifact) => artifact.stage === "scouts" && isModelRunArtifact(artifact)),
  );
  const claimedArtifactIds = new Set<string>();
  const zeroUsage = sumArtifactUsage([]);
  const perScout = (task.scoutDispatch?.selected ?? []).map((scout) => ({
    scout,
    artifacts: [] as ScoutArtifact[],
    matchedBy: null as ScoutUsageMatch["matchedBy"],
  }));

  const assignMatches = (
    matchedBy: NonNullable<ScoutUsageMatch["matchedBy"]>,
    matches: (artifact: ScoutArtifact, scout: ScoutDispatchEntry) => boolean,
  ) => {
    perScout.forEach((entry) => {
      eligibleArtifacts.forEach((artifact) => {
        if (claimedArtifactIds.has(artifact.id) || !matches(artifact, entry.scout)) return;
        claimedArtifactIds.add(artifact.id);
        entry.artifacts.push(artifact);
        entry.matchedBy ??= matchedBy;
      });
    });
  };

  // Resolve identity strength globally so a weaker match from an earlier row
  // cannot claim an artifact before a stronger match on a later row.
  assignMatches("agent-role", (artifact, scout) => artifact.agentRole === scout.name);
  assignMatches("run-id", (artifact, scout) =>
    matchesScoutRun(task, artifact, scout, scoutRunIds(task, scout)),
  );
  assignMatches("artifact-name", (artifact, scout) => matchesScoutArtifactName(artifact, scout));

  const resolvedPerScout: ScoutUsageMatch<ScoutArtifact>[] = perScout.map((entry) => ({
    ...entry,
    representativeArtifact: entry.artifacts[0] ?? null,
    usage: entry.artifacts.length ? sumArtifactUsage(entry.artifacts) : zeroUsage,
    matchedBy: entry.artifacts.length ? entry.matchedBy : null,
    state: entry.artifacts.length ? "matched" : "unmatched",
    unmatchedReason: entry.artifacts.length ? null : "missing",
  }));
  const matchedArtifacts = resolvedPerScout.flatMap((entry) => entry.artifacts);

  return {
    aggregate: sumArtifactUsage(matchedArtifacts),
    perScout: resolvedPerScout,
    matchedArtifacts,
    unmatched: resolvedPerScout.filter((entry) => entry.state === "unmatched"),
  };
}

export function sumArtifactUsage(artifacts: UsageArtifact[]) {
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
