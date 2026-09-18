// Research budget policy — one definition shared by the server and the UI, so a ceiling
// shown to an operator is the ceiling a runtime is handed (architecture §9.3).

import type {
  ResearchBudget,
  ResearchBudgetState,
  ResearchHardCeiling,
  ResearchProfile,
  ResearchUsage,
} from "./domain/research";

/** The spike caps researchers at three regardless of profile (`03-DEEP-AGENTS-JS-SPIKE.md`).
 *  Raising it is a policy decision, not a larger number in a request body. */
export const SPIKE_MAX_RESEARCHERS = 3;

// `maxToolCalls` is not in the architecture's profile table; it is derived as three tool calls
// per permitted search so that a researcher can fetch, read and submit around each search
// without the tool ceiling binding before the search ceiling does.
const TOOL_CALLS_PER_SEARCH = 3;

const PROFILE_CEILINGS = {
  quick: {
    maxResearchers: 2,
    maxConcurrentResearchers: 2,
    maxRuntimeMs: 5 * 60_000,
    maxModelCalls: 30,
    maxSearchCalls: 20,
  },
  standard: {
    maxResearchers: 5,
    maxConcurrentResearchers: 3,
    maxRuntimeMs: 20 * 60_000,
    maxModelCalls: 100,
    maxSearchCalls: 60,
  },
  deep: {
    maxResearchers: 8,
    maxConcurrentResearchers: 4,
    maxRuntimeMs: 45 * 60_000,
    maxModelCalls: 200,
    maxSearchCalls: 120,
  },
} as const satisfies Record<ResearchProfile, Record<string, number>>;

/** Depth is 1 in every profile. Delegation depth is a structural property of how a runtime is
 *  composed, not a dial: a profile that asked for depth 2 could not be honoured. */
const MAX_DEPTH = 1;

// LangGraph's `recursionLimit` counts every graph superstep, not model calls — a middleware
// pipeline (subagent, call-limit, tool-limit) can burn several steps per model turn. It must
// stay well above `maxModelCalls`/`maxToolCalls` so the budget's own ceilings (which report a
// clean, attributable error) always trip first; `GraphRecursionError` is a backstop against a
// true runaway loop, not a budget in its own right, so the multiplier below is deliberately
// generous rather than tightly tuned.
const RECURSION_STEPS_PER_MODEL_CALL_ESTIMATE = 6;
const RECURSION_LIMIT_SAFETY_MARGIN = 20;

/** The `recursionLimit` a Deep Agents graph invocation should be given for this budget, so a
 *  larger `maxModelCalls`/`maxToolCalls` (e.g. a higher profile, or a request override) can
 *  never be silently capped by a stale recursion literal. */
export function graphRecursionLimitForBudget(budget: Pick<ResearchBudget, "maxModelCalls" | "maxToolCalls">): number {
  return (budget.maxModelCalls + budget.maxToolCalls) * RECURSION_STEPS_PER_MODEL_CALL_ESTIMATE + RECURSION_LIMIT_SAFETY_MARGIN;
}

export function researchBudgetForProfile(profile: ResearchProfile): ResearchBudget {
  const ceilings = PROFILE_CEILINGS[profile];
  return {
    maxResearchers: Math.min(ceilings.maxResearchers, SPIKE_MAX_RESEARCHERS),
    maxConcurrentResearchers: Math.min(ceilings.maxConcurrentResearchers, SPIKE_MAX_RESEARCHERS),
    maxDepth: MAX_DEPTH,
    maxRuntimeMs: ceilings.maxRuntimeMs,
    maxModelCalls: ceilings.maxModelCalls,
    maxToolCalls: ceilings.maxSearchCalls * TOOL_CALLS_PER_SEARCH,
    maxSearchCalls: ceilings.maxSearchCalls,
  };
}

const HARD_CEILINGS = [
  "maxResearchers",
  "maxConcurrentResearchers",
  "maxDepth",
  "maxRuntimeMs",
  "maxModelCalls",
  "maxToolCalls",
  "maxSearchCalls",
] as const satisfies readonly ResearchHardCeiling[];

/** Resolve the budget a run will actually be given.
 *
 *  An override may only *lower* a ceiling. A request cannot buy itself more budget than its
 *  profile allows, which is the whole point of having profiles, and it means the API accepts
 *  a budget object from a caller without that caller becoming a policy authority. */
export function resolveResearchBudget(
  profile: ResearchProfile,
  overrides?: Partial<ResearchBudget> | null,
): ResearchBudget {
  const budget = researchBudgetForProfile(profile);
  for (const ceiling of HARD_CEILINGS) {
    const requested = overrides?.[ceiling];
    if (requested == null) continue;
    if (!Number.isFinite(requested) || !Number.isInteger(requested) || requested < 1)
      throw new Error(`${ceiling} must be a positive whole number.`);
    budget[ceiling] = Math.min(budget[ceiling], requested);
  }
  for (const soft of ["maxUsd", "maxTokens"] as const) {
    const requested = overrides?.[soft];
    if (requested == null) continue;
    if (!Number.isFinite(requested) || requested <= 0) throw new Error(`${soft} must be a positive number.`);
    budget[soft] = requested;
  }
  return budget;
}

export function emptyResearchBudgetState(): ResearchBudgetState {
  return {
    modelCallsUsed: 0,
    toolCallsUsed: 0,
    searchCallsUsed: 0,
    researchersStarted: 0,
    elapsedMs: 0,
  };
}

export function emptyResearchUsage(): ResearchUsage {
  return { inputTokens: 0, outputTokens: 0, modelCalls: 0, toolCalls: 0, searchCalls: 0, partial: false };
}

/** Which hard ceiling the observed usage has reached, if any. Reporting only — the runtime
 *  enforces; this tells an operator (and `ResearchResult.truncatedBy`) which wall was hit. */
export function researchCeilingReached(
  budget: ResearchBudget,
  state: ResearchBudgetState,
): ResearchHardCeiling | null {
  if (state.researchersStarted >= budget.maxResearchers) return "maxResearchers";
  if (state.modelCallsUsed >= budget.maxModelCalls) return "maxModelCalls";
  if (state.searchCallsUsed >= budget.maxSearchCalls) return "maxSearchCalls";
  if (state.toolCallsUsed >= budget.maxToolCalls) return "maxToolCalls";
  if (state.elapsedMs >= budget.maxRuntimeMs) return "maxRuntimeMs";
  return null;
}

/** Soft ceilings cannot be enforced before the spend happens (§9.2), so they are reported as
 *  overruns after the fact rather than as truncation. */
export function researchSoftOverruns(
  budget: ResearchBudget,
  usage: ResearchUsage,
): Array<"maxUsd" | "maxTokens"> {
  const overruns: Array<"maxUsd" | "maxTokens"> = [];
  if (budget.maxUsd != null && (usage.estimatedCostUsd ?? 0) > budget.maxUsd) overruns.push("maxUsd");
  const tokens = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
  if (budget.maxTokens != null && tokens > budget.maxTokens) overruns.push("maxTokens");
  return overruns;
}
