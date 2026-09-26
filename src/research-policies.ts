// Which engine and model answer a research run. Separate from every delivery policy: a
// research run is not a task, has no stages and never reads `stagePolicies`, and a change here
// never moves a delivery task onto another model.
//
// Shared by the server (validation, and the snapshot each run takes when it starts) and the
// Settings screen (the same validation, before the operator saves).
//
// One engine since 26 September 2026: Shaun retired the Claude CLI, Codex CLI, OpenCode CLI, pack
// and four-role research runtimes and kept the API loop, DeepSeek 4.1 Flash with the host checking
// each answer (eval arm A10: 10 of 15 held-out questions against Claude Opus 5.5's 5). The Claude
// and Codex CLIs still answer every delivery stage; nothing here touches them.

export type ResearchEngineId = "api-loop";
export type ResearchProviderId = "api";

export const RESEARCH_ENGINES: Readonly<
  Record<ResearchEngineId, { provider: ResearchProviderId; label: string; plan: string }>
> = Object.freeze({
  // No CLI: the companion calls the model's chat API itself, with a key from its environment
  // (`server/research/api-loop/`).
  "api-loop": { provider: "api", label: "API loop", plan: "provider API key" },
});

/** The models the API loop offers research: DeepSeek on OpenCode Go's API for testing, and on
 *  Fireworks' US-only endpoint or Baseten for production. DeepSeek's own API is deliberately absent (traffic stays out of China).
 *  "default" is the only reasoning: the eval ran DeepSeek with no variant. */
export const API_LOOP_RESEARCH_MODELS: readonly {
  id: string;
  label: string;
  reasoningLevels: readonly string[];
}[] = Object.freeze([
  {
    id: "opencode-go/deepseek-v4.1-flash",
    label: "DeepSeek 4.1 Flash · OpenCode Go API",
    reasoningLevels: ["default"],
  },
  {
    id: "fireworks-us/accounts/fireworks/routers/deepseek-v4p1-flash-us",
    label: "DeepSeek 4.1 Flash · Fireworks (US only)",
    reasoningLevels: ["default"],
  },
  {
    id: "baseten/deepseek-ai/DeepSeek-V4.1-Flash",
    label: "DeepSeek 4.1 Flash · Baseten",
    reasoningLevels: ["default"],
  },
]);

export interface ResearchAgentPolicy {
  runtime: ResearchEngineId;
  provider: ResearchProviderId;
  model: string;
  reasoning: string;
}

export interface RuntimeResearchPolicies {
  /** The research agent: the engine and model a research run uses. */
  agent: ResearchAgentPolicy;
}

export const DEFAULT_RESEARCH_POLICIES: Readonly<RuntimeResearchPolicies> = Object.freeze({
  agent: Object.freeze({
    runtime: "api-loop",
    provider: "api",
    model: "opencode-go/deepseek-v4.1-flash",
    reasoning: "default",
  } as const),
});

/**
 * The research policies saved settings hold, or the defaults. A choice saved for a retired engine
 * (Claude, Codex or OpenCode CLI) reads as the default, which is what those runs now use; the
 * four-role comparison's roles are dropped with it.
 */
export function researchPoliciesOf(
  settings: { researchPolicies?: { agent?: Partial<ResearchAgentPolicy> } | null } | null,
): RuntimeResearchPolicies {
  const agent = settings?.researchPolicies?.agent;
  const model = API_LOOP_RESEARCH_MODELS.find((entry) => entry.id === agent?.model);
  if (agent?.runtime !== "api-loop" || !model) return structuredClone(DEFAULT_RESEARCH_POLICIES);
  const reasoning =
    typeof agent.reasoning === "string" && model.reasoningLevels.includes(agent.reasoning)
      ? agent.reasoning
      : (model.reasoningLevels[0] ?? "default");
  return { agent: { runtime: "api-loop", provider: "api", model: model.id, reasoning } };
}

/** Why these policies cannot be saved, or null. The same check runs in Settings and on the
 *  server, so a policy the screen accepts is one the server accepts. */
export function researchPoliciesIssue(policies: RuntimeResearchPolicies | null | undefined): string | null {
  if (!policies || typeof policies !== "object" || !policies.agent) return "Choose a research agent policy.";
  if (policies.agent.runtime !== "api-loop") return "Research runs on the API loop only.";
  if (policies.agent.provider !== "api") return "The API loop runs api models only.";
  const model = API_LOOP_RESEARCH_MODELS.find((entry) => entry.id === policies.agent.model);
  if (!model) return "The research agent needs one of the API loop's research models.";
  if (
    typeof policies.agent.reasoning !== "string" ||
    !model.reasoningLevels.includes(policies.agent.reasoning)
  )
    return `${model.label} does not support ${String(policies.agent.reasoning ?? "that")} reasoning.`;
  return null;
}

/** The policies with only the fields the settings store keeps. */
export function normalizeResearchPolicies(policies: RuntimeResearchPolicies): RuntimeResearchPolicies {
  return {
    agent: {
      runtime: "api-loop",
      provider: "api",
      model: policies.agent.model,
      reasoning: policies.agent.reasoning,
    },
  };
}
