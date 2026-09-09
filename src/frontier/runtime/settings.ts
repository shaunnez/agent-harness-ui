import type { RuntimeSettings, RuntimeStatus } from "../../domain.ts";
import { policyRoles } from "./policies.ts";

export type SettingsInput = Pick<
  RuntimeSettings,
  "allowedModels" | "defaultModel" | "defaultReasoning" | "stagePolicies" | "grillPolicy" | "designPolicies"
> & { profileStagePolicies: NonNullable<RuntimeSettings["profileStagePolicies"]> };
export function settingsInput(settings: RuntimeSettings): SettingsInput {
  return structuredClone({
    allowedModels: settings.allowedModels,
    defaultModel: settings.defaultModel,
    defaultReasoning: settings.defaultReasoning,
    stagePolicies: settings.stagePolicies,
    profileStagePolicies: settings.profileStagePolicies ?? {
      fast: settings.stagePolicies,
      standard: settings.stagePolicies,
      "high-risk": settings.stagePolicies,
    },
    grillPolicy: settings.grillPolicy,
    designPolicies: settings.designPolicies,
  });
}
export function settingsIssue(input: SettingsInput, status: RuntimeStatus): string | null {
  const models = status.catalog?.models ?? [];
  const valid = (modelId: string, reasoning: string | null, provider: string) => {
    const model = models.find((item) => item.id === modelId && item.editable && item.provider === provider);
    return (
      model && input.allowedModels.includes(modelId) && reasoning && model.reasoningLevels.includes(reasoning)
    );
  };
  if (!valid(input.defaultModel, input.defaultReasoning, "codex"))
    return "Choose an allowed Codex default model and supported effort.";
  for (const [profile, policies] of Object.entries(input.profileStagePolicies ?? {}))
    for (const role of policyRoles) {
      const policy = policies[role.id];
      if (!policy || !valid(policy.model, policy.reasoning, "codex"))
        return `${profile} / ${role.label} needs an allowed model and supported effort.`;
    }
  for (const [provider, policy] of Object.entries(input.designPolicies))
    if (!valid(policy.model, policy.reasoning, policy.provider))
      return `${provider} needs an allowed provider model and supported effort.`;
  return null;
}
