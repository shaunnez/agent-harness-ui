import { normalizeRepairLimits, repairLimitsIssue, type RepairLimits } from "../../repair-limits.ts";
import type { RuntimeSettings, RuntimeStatus } from "../../domain.ts";
import {
  researchPoliciesIssue,
  researchPoliciesOf,
  type RuntimeResearchPolicies,
} from "../../research-policies.ts";
import { policyRoles } from "./policies.ts";
import { isStrongerRepairPolicy } from "../../../server/repair-escalation-strength.mjs";

export type SettingsInput = Pick<
  RuntimeSettings,
  | "allowedModels"
  | "defaultModel"
  | "defaultReasoning"
  | "stagePolicies"
  | "grillPolicy"
  | "gatePolicies"
  | "designPolicies"
> & {
  repairLimits: RepairLimits;
  profileStagePolicies: NonNullable<RuntimeSettings["profileStagePolicies"]>;
  repairEscalationPolicies: NonNullable<RuntimeSettings["repairEscalationPolicies"]>;
  researchPolicies: RuntimeResearchPolicies;
};
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
    repairLimits: normalizeRepairLimits(settings.repairLimits),
    repairEscalationPolicies: settings.repairEscalationPolicies ?? {
      fast: null,
      standard: null,
      "high-risk": null,
    },
    gatePolicies: { ...settings.gatePolicies },
    designPolicies: settings.designPolicies,
    researchPolicies: researchPoliciesOf(settings),
  });
}
export function settingsIssue(input: SettingsInput, status: RuntimeStatus): string | null {
  const limitIssue = repairLimitsIssue(input.repairLimits);
  if (limitIssue) return limitIssue;
  const models = status.catalog?.models ?? [];
  // Stage policies may mix providers — each stage runs on the runtime its own model
  // belongs to — so a policy is checked against its model's own provider, matching what
  // `PUT /api/settings` accepts. Only design policies pin a provider, and they say which.
  const valid = (modelId: string, reasoning: string | null, provider?: string) => {
    const model = models.find(
      (item) => item.id === modelId && item.editable && (!provider || item.provider === provider),
    );
    return (
      model && input.allowedModels.includes(modelId) && reasoning && model.reasoningLevels.includes(reasoning)
    );
  };
  if (!valid(input.defaultModel, input.defaultReasoning))
    return "Choose an allowed default model and supported effort.";
  for (const [profile, policies] of Object.entries(input.profileStagePolicies ?? {}))
    for (const role of policyRoles) {
      const policy = policies[role.id];
      if (!policy || !valid(policy.model, policy.reasoning))
        return `${profile} / ${role.label} needs an allowed model and supported effort.`;
    }
  for (const [profile, policy] of Object.entries(input.repairEscalationPolicies)) {
    if (!policy) continue;
    if (!valid(policy.model, policy.reasoning))
      return `${profile} Repair escalation needs an allowed model and supported effort.`;
    if (
      !isStrongerRepairPolicy(
        input.profileStagePolicies[profile as keyof typeof input.profileStagePolicies]?.repair,
        policy,
      )
    )
      return `${profile} Repair escalation must be stronger than Repair on the same provider.`;
  }
  for (const [provider, policy] of Object.entries(input.designPolicies))
    if (!valid(policy.model, policy.reasoning, policy.provider))
      return `${provider} needs an allowed provider model and supported effort.`;
  return researchPoliciesIssue(input.researchPolicies, models, input.allowedModels);
}
