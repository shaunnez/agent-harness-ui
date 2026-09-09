import { normalizeModelId, POLICY_IDS } from "./model-catalog.mjs";
import { WORKFLOW_PROFILE_IDS } from "./workflow-profiles.mjs";

// Apply explicit roles to every profile so deterministic profile escalation retains
// the operator's choices. Omitted roles continue to inherit each profile's defaults.
export function snapshotTaskPolicies(input, settings, knownModels, workflowProfile, legacyPolicy) {
  const hasMatrix = Object.hasOwn(input, "rolePolicyOverrides");
  const hasBlanket = input.model != null || input.reasoning != null;
  if (hasMatrix && hasBlanket)
    throw new Error("Choose per-role overrides or legacy model/reasoning overrides, not both.");
  const overrides = {};
  if (hasMatrix) {
    if (!isRecord(input.rolePolicyOverrides)) throw new Error("Role policy overrides must be an object.");
    for (const [role, policy] of Object.entries(input.rolePolicyOverrides)) {
      if (!POLICY_IDS.includes(role)) throw new Error(`Unknown role policy: ${role}.`);
      if (
        !isRecord(policy) ||
        Object.keys(policy).some((key) => !["model", "reasoning"].includes(key)) ||
        typeof policy.model !== "string" ||
        typeof policy.reasoning !== "string"
      )
        throw new Error(`Provide only model and reasoning for ${role}.`);
      const model = normalizeModelId(policy.model);
      const available = knownModels.get(model);
      if (!available || !settings.allowedModels.includes(model))
        throw new Error(`Choose an allowed runtime model for ${role}.`);
      if (!available.reasoningLevels.includes(policy.reasoning))
        throw new Error(`${available.label} does not support ${policy.reasoning} reasoning for ${role}.`);
      overrides[role] = { model, reasoning: policy.reasoning };
    }
  }
  const profileStagePolicies = Object.fromEntries(
    WORKFLOW_PROFILE_IDS.map((profile) => [
      profile,
      Object.fromEntries(
        POLICY_IDS.map((role) => [
          role,
          structuredClone(
            hasBlanket
              ? legacyPolicy
              : (overrides[role] ??
                  settings.profileStagePolicies?.[profile]?.[role] ??
                  settings.stagePolicies[role]),
          ),
        ]),
      ),
    ]),
  );
  return {
    profileStagePolicies,
    stagePolicies: structuredClone(profileStagePolicies[workflowProfile.selected]),
    rolePolicyOverrides: overrides,
    rolePolicySources: Object.fromEntries(
      POLICY_IDS.map((role) => [
        role,
        hasBlanket
          ? "legacy-task-override"
          : Object.hasOwn(overrides, role)
            ? "task-override"
            : "settings-default",
      ]),
    ),
  };
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
