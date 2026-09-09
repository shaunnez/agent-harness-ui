import type { RolePolicyId } from "../src/domain.ts";
import type { RuntimeAgentPolicy, WorkflowProfileId } from "../src/domain/runtime.ts";
export const DEFAULT_RUNTIME_MODEL: string;
export const DEFAULT_RUNTIME_REASONING: string;
export const DEFAULT_CODEX_MODEL: string;
export const PROVIDER_RUNTIME_DEFAULTS: Record<"codex" | "claude", RuntimeAgentPolicy>;
export function providerRuntimeDefaults(provider?: "codex" | "claude"): RuntimeAgentPolicy;
export function defaultStagePolicies(
  provider?: "codex" | "claude",
): Record<RolePolicyId, RuntimeAgentPolicy>;
export function defaultProfileStagePolicies(
  provider?: "codex" | "claude",
): Record<WorkflowProfileId, Record<RolePolicyId, RuntimeAgentPolicy>>;
