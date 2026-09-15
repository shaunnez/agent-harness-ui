import { defaultProfileStagePolicies } from "../../../server/policy-defaults.mjs";
import { selectWorkflowProfile } from "../../../server/workflow-profiles.mjs";
import {
  type NewTaskDraft,
  type RolePolicyId,
  type RuntimeAgentPolicy,
  type RuntimeSettings,
  type RuntimeStatus,
  type WorkflowProfileId,
  workflowStages,
} from "../../domain.ts";

const roleDefinitions: { id: RolePolicyId; label: string; skill: string }[] = [
  { id: "triage", label: "Triage", skill: "triage" },
  { id: "scouts", label: "Repository scouts", skill: "investigate-repository" },
  { id: "grill", label: "Grill", skill: "grill-me" },
  { id: "specification", label: "Specification", skill: "specify" },
  { id: "plan", label: "Implementation plan", skill: "plan" },
  { id: "implement", label: "Implement", skill: "implement" },
  { id: "repair", label: "Candidate repair", skill: "repair-candidate" },
  { id: "dev-review", label: "Development review", skill: "dev-review" },
  { id: "test", label: "Test", skill: "test" },
  { id: "final-review", label: "Final review", skill: "final-review" },
];
export const policyRoles = roleDefinitions.map((role) => ({
  ...role,
  skill: workflowStages.find((stage) => stage.id === role.id)?.skill ?? role.skill,
}));
export function draftProfile(draft: NewTaskDraft) {
  return selectWorkflowProfile({
    ...draft,
    requestedProfile: draft.workflowProfile === "auto" ? null : draft.workflowProfile,
  });
}
export function draftPolicies(draft: NewTaskDraft, settings: RuntimeSettings) {
  const profile = draftProfile(draft);
  const inherited = draft.providerConstraint
    ? defaultProfileStagePolicies(draft.providerConstraint)[profile.selected]
    : (settings.profileStagePolicies?.[profile.selected] ?? settings.stagePolicies);
  return Object.fromEntries(
    policyRoles.map(({ id }) => [id, draft.rolePolicyOverrides?.[id] ?? inherited[id]]),
  ) as Record<RolePolicyId, RuntimeAgentPolicy>;
}
export function selectableModels(status: RuntimeStatus | null, provider?: "codex" | "claude") {
  return (
    status?.catalog?.models.filter(
      (model) =>
        model.editable &&
        status.settings?.allowedModels.includes(model.id) &&
        (!provider || model.provider === provider),
    ) ?? []
  );
}

/**
 * The recommended policy matrix for one execution provider. Every server default
 * must be selectable exactly; an unavailable model refuses the preset rather than
 * silently substituting a different treatment.
 */
export function providerPolicyMatrix(
  provider: "codex" | "claude",
  profile: WorkflowProfileId,
  status: RuntimeStatus | null,
): Record<RolePolicyId, RuntimeAgentPolicy> | null {
  const models = selectableModels(status, provider);
  if (!models.length) return null;
  const defaults = defaultProfileStagePolicies(provider)[profile];
  const entries: Array<readonly [RolePolicyId, RuntimeAgentPolicy]> = [];
  for (const { id } of policyRoles) {
    const wanted = defaults[id];
    const model = models.find((item) => item.id === wanted?.model);
    if (!model?.reasoningLevels.includes(wanted?.reasoning ?? "")) return null;
    entries.push([id, { model: model.id, reasoning: wanted.reasoning }]);
  }
  return Object.fromEntries(entries) as Record<RolePolicyId, RuntimeAgentPolicy>;
}

export function providerProfilePolicyMatrices(provider: "codex" | "claude", status: RuntimeStatus | null) {
  const profiles = (["fast", "standard", "high-risk"] as const).map(
    (profile) => [profile, providerPolicyMatrix(provider, profile, status)] as const,
  );
  if (profiles.some(([, matrix]) => matrix === null)) return null;
  return Object.fromEntries(profiles) as Record<WorkflowProfileId, Record<RolePolicyId, RuntimeAgentPolicy>>;
}
