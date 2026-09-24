// Which engine and model answer a research run. Separate from every delivery policy: a
// research run is not a task, has no stages and never reads `stagePolicies`, and a change here
// never moves a delivery task onto another model.
//
// Shared by the server (validation, and the snapshot each run takes when it starts) and the
// Settings screen (the same validation, before the operator saves).

import type { ResearchRole } from "./domain/research.ts";

export type ResearchEngineId = "claude-cli" | "codex-cli" | "opencode-cli";
export type ResearchProviderId = "claude" | "codex" | "opencode";

export const RESEARCH_ENGINES: Readonly<
  Record<ResearchEngineId, { provider: ResearchProviderId; label: string; plan: string }>
> = Object.freeze({
  "claude-cli": { provider: "claude", label: "Claude CLI", plan: "Claude subscription" },
  "codex-cli": { provider: "codex", label: "Codex CLI", plan: "ChatGPT plan" },
  "opencode-cli": { provider: "opencode", label: "OpenCode CLI", plan: "OpenCode Go plan" },
});

/** The models the OpenCode engine offers research. Its own list, not the delivery catalogue or
 *  allowlist: these models never answer a delivery stage, so they must not appear in its pickers.
 *  "default" is the only reasoning: the eval ran DeepSeek with no variant, and `#max` was no
 *  more consistent (`30-EVAL-RESULT.md`). */
export const OPENCODE_RESEARCH_MODELS: readonly {
  id: string;
  label: string;
  reasoningLevels: readonly string[];
}[] = Object.freeze([
  { id: "opencode-go/deepseek-v4.1-flash", label: "DeepSeek 4.1 Flash", reasoningLevels: ["default"] },
]);

/** The four-role comparison runs every role through the Claude CLI. */
export const RESEARCH_ROLES_ENGINE = "claude-cli-roles";
export const RESEARCH_ROLE_IDS: readonly ResearchRole[] = Object.freeze([
  "planner",
  "researcher",
  "verifier",
  "synthesiser",
]);

export interface ResearchAgentPolicy {
  runtime: ResearchEngineId;
  provider: ResearchProviderId;
  model: string;
  reasoning: string;
}

export interface ResearchRolePolicy {
  provider: "claude";
  model: string;
  reasoning: string;
}

export interface RuntimeResearchPolicies {
  /** The single research agent: the engine a research run uses unless it names another. */
  agent: ResearchAgentPolicy;
  /** The four-role comparison (`claude-cli-roles`), one Claude model per role. */
  roles: Record<ResearchRole, ResearchRolePolicy>;
}

const OPUS_HIGH = Object.freeze({ provider: "claude", model: "claude-opus-5-5", reasoning: "high" } as const);

const DEEPSEEK_AGENT = Object.freeze({
  runtime: "opencode-cli",
  provider: "opencode",
  model: "opencode-go/deepseek-v4.1-flash",
  reasoning: "default",
} as const);

/** DeepSeek 4.1 Flash on OpenCode for the research agent: 7 of 13 on the 24 September eval,
 *  against Opus 5.5's 5, at about $0.09 a question (`30-EVAL-RESULT.md`; Shaun made it the
 *  default). Opus 5.5 for the four-role comparison, which runs every role on the Claude CLI. */
export const DEFAULT_RESEARCH_POLICIES: Readonly<RuntimeResearchPolicies> = Object.freeze({
  agent: DEEPSEEK_AGENT,
  roles: Object.freeze({
    planner: OPUS_HIGH,
    researcher: OPUS_HIGH,
    verifier: OPUS_HIGH,
    synthesiser: OPUS_HIGH,
  }),
});

/**
 * Saved settings from before this section existed carry no research policies; they read as the
 * defaults. An allowlist saved before Opus 5.5 existed does not offer the default, and a default
 * the allowlist refuses would block every later save, so such settings read as their Claude
 * Design policy instead: a Claude model the server has already accepted for this allowlist.
 */
export function researchPoliciesOf(
  settings: {
    researchPolicies?: RuntimeResearchPolicies;
    allowedModels?: readonly string[];
    designPolicies?: { "claude-design"?: { model: string; reasoning: string | null } };
  } | null,
): RuntimeResearchPolicies {
  if (settings?.researchPolicies) return structuredClone(settings.researchPolicies);
  const defaults = structuredClone(DEFAULT_RESEARCH_POLICIES) as RuntimeResearchPolicies;
  const design = settings?.designPolicies?.["claude-design"];
  if (!settings?.allowedModels || settings.allowedModels.includes(OPUS_HIGH.model) || !design?.reasoning)
    return defaults;
  const fallback = { provider: "claude" as const, model: design.model, reasoning: design.reasoning };
  return {
    agent: defaults.agent,
    roles: Object.fromEntries(RESEARCH_ROLE_IDS.map((role) => [role, { ...fallback }])) as Record<
      ResearchRole,
      ResearchRolePolicy
    >,
  };
}

export interface ResearchPolicyModel {
  id: string;
  label?: string;
  provider?: string | null;
  editable?: boolean;
  reasoningLevels: readonly string[];
}

/** Why these policies cannot be saved, or null. The same check runs in Settings and on the
 *  server, so a policy the screen accepts is one the server accepts. */
export function researchPoliciesIssue(
  policies: RuntimeResearchPolicies | null | undefined,
  models: readonly ResearchPolicyModel[],
  allowedModels: readonly string[],
): string | null {
  if (!policies || typeof policies !== "object") return "Choose a research agent policy.";
  const check = (
    name: string,
    policy: { model?: unknown; reasoning?: unknown },
    provider: ResearchProviderId,
  ) => {
    const model = models.find((entry) => entry.id === policy?.model);
    if (!model || model.editable === false || !allowedModels.includes(model.id))
      return `${name} needs an allowed model.`;
    if (model.provider !== provider)
      return `${name} needs a ${provider === "claude" ? "Claude" : "Codex"} model.`;
    if (typeof policy.reasoning !== "string" || !model.reasoningLevels.includes(policy.reasoning))
      return `${model.label ?? model.id} does not support ${String(policy.reasoning ?? "that")} reasoning.`;
    return null;
  };
  const engine = RESEARCH_ENGINES[policies.agent?.runtime as ResearchEngineId];
  if (!engine) return "Choose Claude CLI, Codex CLI or OpenCode CLI for the research agent.";
  if (policies.agent.provider !== engine.provider)
    return `The research agent's ${engine.label} runs ${engine.provider} models only.`;
  const agentIssue =
    engine.provider === "opencode"
      ? openCodeIssue(policies.agent)
      : check("The research agent", policies.agent, engine.provider);
  if (agentIssue) return agentIssue;
  for (const role of RESEARCH_ROLE_IDS) {
    const policy = policies.roles?.[role];
    if (!policy || policy.provider !== "claude") return `The ${role} role needs a Claude model.`;
    const issue = check(`The ${role} role`, policy, "claude");
    if (issue) return issue;
  }
  return null;
}

function openCodeIssue(policy: { model?: unknown; reasoning?: unknown }): string | null {
  const model = OPENCODE_RESEARCH_MODELS.find((entry) => entry.id === policy?.model);
  if (!model) return "The research agent needs an OpenCode research model.";
  if (typeof policy.reasoning !== "string" || !model.reasoningLevels.includes(policy.reasoning))
    return `${model.label} does not support ${String(policy.reasoning ?? "that")} reasoning.`;
  return null;
}

/** The policies with only the fields the settings store keeps. */
export function normalizeResearchPolicies(policies: RuntimeResearchPolicies): RuntimeResearchPolicies {
  const engine = RESEARCH_ENGINES[policies.agent.runtime];
  return {
    agent: {
      runtime: policies.agent.runtime,
      provider: engine.provider,
      model: policies.agent.model,
      reasoning: policies.agent.reasoning,
    },
    roles: Object.fromEntries(
      RESEARCH_ROLE_IDS.map((role) => [
        role,
        { provider: "claude", model: policies.roles[role].model, reasoning: policies.roles[role].reasoning },
      ]),
    ) as Record<ResearchRole, ResearchRolePolicy>,
  };
}
