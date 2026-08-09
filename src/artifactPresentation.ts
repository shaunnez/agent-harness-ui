import type { RuntimeArtifact, RuntimeTask, RuntimeUsage } from "./domain";

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

export const SCOUT_USAGE_NOT_RETAINED = "Usage was not retained";

type ScoutDispatchEntry = NonNullable<RuntimeTask["scoutDispatch"]>["selected"][number];
type ScoutUsage = ReturnType<typeof sumArtifactUsage>;

export type ScoutUsageMatch = {
  scout: ScoutDispatchEntry;
  artifacts: RuntimeArtifact[];
  usage: ScoutUsage | null;
  matchedBy: "agent-role" | "run-id" | "artifact-name" | null;
  state: "matched" | "unmatched";
  unmatchedReason: "missing" | "ambiguous" | null;
};

export interface ScoutUsageResolution {
  aggregate: ScoutUsage;
  perScout: ScoutUsageMatch[];
  matchedArtifacts: RuntimeArtifact[];
  unmatched: ScoutUsageMatch[];
}

function scoutArtifactName(value: string) {
  const basename = value.replaceAll("\\", "/").split("/").at(-1) ?? value;
  const withoutMarkdownExtension = basename.replace(/\.(?:md|markdown)$/i, "");
  return withoutMarkdownExtension
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function scoutNameVariants(value: string) {
  const normalized = scoutArtifactName(value);
  const withoutScoutPrefix = normalized.replace(/^scout-/, "");
  return new Set([normalized, withoutScoutPrefix]);
}

function isRepositoryScoutHandoff(artifact: RuntimeArtifact) {
  const basename = artifact.name.replaceAll("\\", "/").split("/").at(-1)?.toLowerCase();
  return basename === "repository-scout.md" || artifact.model === "deterministic-aggregation";
}

function distinctArtifacts(artifacts: RuntimeArtifact[]) {
  const seen = new Set<string>();
  return artifacts.filter((artifact) => {
    if (seen.has(artifact.id)) return false;
    seen.add(artifact.id);
    return true;
  });
}

function scoutRunIds(task: RuntimeTask, scout: ScoutDispatchEntry) {
  return new Set(
    (task.runs ?? []).filter((run) => run.stage === "scouts" && run.role === scout.name).map((run) => run.id),
  );
}

function matchesNormalizedScoutName(artifact: RuntimeArtifact, scout: ScoutDispatchEntry) {
  const artifactNames = scoutNameVariants(artifact.name);
  return [...scoutNameVariants(scout.name)].some((name) => artifactNames.has(name));
}

/**
 * Resolves usage for the selected repository scouts only.
 *
 * This is deliberately a presentation-layer resolver. It does not infer a
 * missing zero-token run: an absent or ambiguous historical match remains
 * explicitly unmatched so callers can render `SCOUT_USAGE_NOT_RETAINED`.
 */
export function resolveScoutUsage(task: RuntimeTask): ScoutUsageResolution {
  const eligibleArtifacts = distinctArtifacts(
    task.artifacts.filter(
      (artifact) =>
        artifact.stage === "scouts" && isModelRunArtifact(artifact) && !isRepositoryScoutHandoff(artifact),
    ),
  );
  const claimedArtifactIds = new Set<string>();
  const perScout = (task.scoutDispatch?.selected ?? []).map<ScoutUsageMatch>((scout) => {
    const roleMatches = eligibleArtifacts.filter(
      (artifact) => artifact.agentRole === scout.name && !claimedArtifactIds.has(artifact.id),
    );
    let matchedBy: ScoutUsageMatch["matchedBy"] = null;
    let candidates = roleMatches;
    let unmatchedReason: ScoutUsageMatch["unmatchedReason"] = null;

    if (candidates.length) {
      matchedBy = "agent-role";
    } else {
      const runIds = scoutRunIds(task, scout);
      candidates = eligibleArtifacts.filter(
        (artifact) =>
          Boolean(artifact.runId && runIds.has(artifact.runId)) && !claimedArtifactIds.has(artifact.id),
      );
      if (candidates.length) {
        matchedBy = "run-id";
      } else {
        const nameMatches = eligibleArtifacts.filter(
          (artifact) => matchesNormalizedScoutName(artifact, scout) && !claimedArtifactIds.has(artifact.id),
        );
        if (nameMatches.length === 1) {
          candidates = nameMatches;
          matchedBy = "artifact-name";
        } else {
          candidates = [];
          unmatchedReason = nameMatches.length > 1 ? "ambiguous" : "missing";
        }
      }
    }

    const artifacts = distinctArtifacts(candidates);
    for (const artifact of artifacts) claimedArtifactIds.add(artifact.id);
    return {
      scout,
      artifacts,
      usage: artifacts.length ? sumArtifactUsage(artifacts) : null,
      matchedBy,
      state: artifacts.length ? "matched" : "unmatched",
      unmatchedReason: artifacts.length ? null : (unmatchedReason ?? "missing"),
    };
  });
  const matchedArtifacts = perScout.flatMap((entry) => entry.artifacts);

  return {
    aggregate: sumArtifactUsage(matchedArtifacts),
    perScout,
    matchedArtifacts,
    unmatched: perScout.filter((entry) => entry.state === "unmatched"),
  };
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
