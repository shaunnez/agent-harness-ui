import {
  defaultProfileStagePolicies,
  normalizeModelId,
  POLICY_IDS,
  providerForModelId,
} from "./model-catalog.mjs";
import { WORKFLOW_PROFILE_IDS } from "./workflow-profiles.mjs";

// Apply explicit roles to every profile so deterministic profile escalation retains
// the operator's choices. Omitted roles continue to inherit each profile's defaults.
export function snapshotTaskPolicies(input, settings, knownModels, workflowProfile, legacyPolicy) {
  const hasMatrix = Object.hasOwn(input, "rolePolicyOverrides");
  const hasBlanket = input.model != null || input.reasoning != null;
  const providerConstraint = input.providerConstraint ?? null;
  if (providerConstraint != null && !["codex", "claude"].includes(providerConstraint))
    throw new Error("Provider constraint must be codex or claude.");
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
      if (providerConstraint && providerForModelId(model) !== providerConstraint)
        throw new Error(
          `${role} must use a ${providerConstraint} model while that provider preset is selected.`,
        );
      overrides[role] = { model, reasoning: policy.reasoning };
    }
  }
  const presetProfiles = providerConstraint
    ? validatePresetProfiles(providerConstraint, settings, knownModels)
    : null;
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
                  presetProfiles?.[profile]?.[role] ??
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
    providerConstraint,
    repairEscalationPolicies: repairEscalationPolicies(
      profileStagePolicies,
      settings,
      knownModels,
      providerConstraint,
    ),
    rolePolicySources: Object.fromEntries(
      POLICY_IDS.map((role) => [
        role,
        hasBlanket
          ? "legacy-task-override"
          : Object.hasOwn(overrides, role)
            ? "task-override"
            : providerConstraint
              ? "provider-preset"
              : "settings-default",
      ]),
    ),
  };
}

function validatePresetProfiles(provider, settings, knownModels) {
  const profiles = defaultProfileStagePolicies(provider);
  for (const [profile, matrix] of Object.entries(profiles)) {
    for (const [role, policy] of Object.entries(matrix)) {
      assertEligiblePolicy(policy, `${profile} ${role}`, settings, knownModels, provider);
    }
  }
  return profiles;
}

function repairEscalationPolicies(profileStagePolicies, settings, knownModels, providerConstraint) {
  return Object.fromEntries(
    WORKFLOW_PROFILE_IDS.flatMap((profile) => {
      const selected = profileStagePolicies[profile]?.repair;
      const provider = providerForModelId(selected?.model);
      if (!provider || (providerConstraint && provider !== providerConstraint)) return [];
      const stronger = defaultProfileStagePolicies(provider)[profile]?.plan;
      if (!stronger || (stronger.model === selected.model && stronger.reasoning === selected.reasoning))
        return [];
      try {
        assertEligiblePolicy(stronger, `${profile} repair escalation`, settings, knownModels, provider);
        return [[profile, structuredClone(stronger)]];
      } catch {
        return [];
      }
    }),
  );
}

function assertEligiblePolicy(policy, label, settings, knownModels, provider) {
  const model = normalizeModelId(policy?.model);
  const available = knownModels.get(model);
  if (!available || !settings.allowedModels.includes(model)) {
    throw new Error(
      `${label} requires ${model}, which is unavailable or disallowed. Allow that ${provider} model or choose a different policy.`,
    );
  }
  if (providerForModelId(model) !== provider)
    throw new Error(`${label} requires a ${provider} model, but ${model} belongs to another provider.`);
  if (!available.reasoningLevels.includes(policy.reasoning))
    throw new Error(`${available.label} does not support ${policy.reasoning} reasoning for ${label}.`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
