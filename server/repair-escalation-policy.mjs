import { normalizeModelId } from "./model-catalog.mjs";
import { WORKFLOW_PROFILE_IDS } from "./workflow-profiles.mjs";
import { isStrongerRepairPolicy } from "./repair-escalation-strength.mjs";

export { isStrongerRepairPolicy };

export function validateRepairEscalationPolicies(input, current, matrices, knownModels, allowedModels) {
  const requested = input === undefined ? (current ?? {}) : input;
  if (!requested || typeof requested !== "object" || Array.isArray(requested)) {
    throw new Error("Repair escalation policies must be a profile map.");
  }
  if (Object.keys(requested).some((profile) => !WORKFLOW_PROFILE_IDS.includes(profile))) {
    throw new Error("Repair escalation has an unknown workflow profile.");
  }
  return Object.fromEntries(
    WORKFLOW_PROFILE_IDS.map((profile) => {
      const policy = requested[profile] ?? null;
      if (policy === null) return [profile, null];
      if (
        typeof policy !== "object" ||
        Array.isArray(policy) ||
        Object.keys(policy).some((key) => !["model", "reasoning"].includes(key)) ||
        typeof policy.model !== "string" ||
        typeof policy.reasoning !== "string"
      )
        throw new Error(`${profile} Repair escalation needs a model and reasoning level, or Off.`);
      const model = normalizeModelId(policy.model);
      const available = knownModels.get(model);
      if (!available || !allowedModels.includes(model))
        throw new Error(`${profile} Repair escalation must use an allowed runtime model.`);
      if (!available.reasoningLevels.includes(policy.reasoning))
        throw new Error(
          `${available.label} does not support ${policy.reasoning} reasoning for Repair escalation.`,
        );
      if (!isStrongerRepairPolicy(matrices[profile]?.repair, { model, reasoning: policy.reasoning }))
        throw new Error(`${profile} Repair escalation must be a stronger policy on the same provider.`);
      return [profile, { model, reasoning: policy.reasoning }];
    }),
  );
}
