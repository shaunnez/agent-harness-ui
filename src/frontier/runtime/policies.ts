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
  const inherited = settings.profileStagePolicies?.[profile.selected] ?? settings.stagePolicies;
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
 * The recommended policy matrix for one execution provider, clamped to what the
 * runtime will actually accept. Server defaults name the provider's own models,
 * but an operator may have removed one from the allowlist, so every role falls
 * back to a selectable model of the same provider and a reasoning level that
 * model declares.
 */
export function providerPolicyMatrix(
  provider: "codex" | "claude",
  profile: WorkflowProfileId,
  status: RuntimeStatus | null,
): Record<RolePolicyId, RuntimeAgentPolicy> | null {
  const models = selectableModels(status, provider);
  const first = models[0];
  if (!first) return null;
  const defaults = defaultProfileStagePolicies(provider)[profile];
  return Object.fromEntries(
    policyRoles.map(({ id }) => {
      const wanted = defaults[id];
      const model = models.find((item) => item.id === wanted?.model) ?? first;
      const reasoning = model.reasoningLevels.includes(wanted?.reasoning ?? "")
        ? (wanted?.reasoning ?? model.defaultReasoning)
        : model.defaultReasoning;
      return [id, { model: model.id, reasoning }];
    }),
  ) as Record<RolePolicyId, RuntimeAgentPolicy>;
}
