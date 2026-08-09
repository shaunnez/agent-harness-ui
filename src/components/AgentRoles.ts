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
  provider: "model" | "harness";
  parentId?: AgentRoleId;
}

function workflowRole(id: AgentRoleId): AgentRoleDefinition {
  const stage = workflowStages.find((item) => item.id === id);
  if (!stage) throw new Error(`Unknown workflow role: ${id}`);
  return { id, label: stage.label, skill: stage.skill, provider: id === "approval" ? "harness" : "model" };
}

export const agentRoles: AgentRoleDefinition[] = [
  workflowRole("triage"),
  workflowRole("scouts"),
  ...scoutRoleIds.map((id) => ({
    id,
    label: id.replace(/^scout-/, "").replaceAll("-", " ").replace(/^./, (value) => value.toUpperCase()),
    skill: id,
    provider: "model" as const,
    parentId: "scouts" as const,
  })),
  workflowRole("grill"),
  workflowRole("specification"),
  workflowRole("plan"),
  workflowRole("implement"),
  { id: "repair", label: "Candidate repair", skill: "repair-candidate", provider: "model" },
  workflowRole("dev-review"),
  workflowRole("test"),
  workflowRole("final-review"),
  workflowRole("approval"),
];

export function policyIdForRole(roleId: AgentRoleId) {
  return roleId.startsWith("scout-") ? "scouts" : roleId;
}

export function rolePolicy(runtimeStatus: RuntimeStatus | null, roleId: AgentRoleId): RuntimeAgentPolicy | null {
  if (roleId === "approval") return null;
  return runtimeStatus?.settings?.stagePolicies?.[policyIdForRole(roleId)] ?? null;
}
