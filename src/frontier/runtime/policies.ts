import { selectWorkflowProfile } from "../../../server/workflow-profiles.mjs";
import {
  workflowStages,
  type NewTaskDraft,
  type RolePolicyId,
  type RuntimeAgentPolicy,
  type RuntimeSettings,
  type RuntimeStatus,
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
