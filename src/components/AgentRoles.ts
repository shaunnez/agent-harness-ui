import {
  scoutRoleIds,
  type AgentRoleId,
  type RuntimeAgentPolicy,
  type RuntimeStatus,
  workflowStages,
} from "../domain";

export interface AgentRoleDefinition {
  id: AgentRoleId;
  label: string;
  skill: string;
  provider: "codex" | "harness";
}

export const agentRoles: AgentRoleDefinition[] = [
  ...workflowStages
    .filter((stage) => stage.id !== "approval")
    .map((stage) => ({ id: stage.id, label: stage.label, skill: stage.skill, provider: "codex" as const })),
  { id: "repair", label: "Candidate repair", skill: "repair-candidate", provider: "codex" },
  ...scoutRoleIds.map((id) => ({
    id,
    label: id.replace(/^scout-/, "").replaceAll("-", " ").replace(/^./, (value) => value.toUpperCase()),
    skill: id,
    provider: "codex" as const,
  })),
  { id: "approval", label: "Human approval", skill: "request-approval", provider: "harness" },
];

export function policyIdForRole(roleId: AgentRoleId) {
  return roleId.startsWith("scout-") ? "scouts" : roleId;
}

export function rolePolicy(runtimeStatus: RuntimeStatus | null, roleId: AgentRoleId): RuntimeAgentPolicy | null {
  if (roleId === "approval") return null;
  return runtimeStatus?.settings?.stagePolicies?.[policyIdForRole(roleId)] ?? null;
}
