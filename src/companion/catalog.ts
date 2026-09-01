import {
  type ActionProposal,
  assertActionProposal,
  companionActionTypes,
  type EligibilityEvidence,
  type RoleModelProposal,
  type RolePolicyRequest,
} from "./contracts.ts";
import {
  agentRoleIds,
  type AgentRoleId,
  type RuntimeAgentPolicy,
  type RuntimeModelOption,
  workflowStages,
} from "../domain.ts";

export interface TrustedActionCard {
  type: (typeof companionActionTypes)[number];
  proposal: ActionProposal;
}

export interface TrustedRoleOption {
  id: AgentRoleId;
  label: string;
}

/** The fixed roles exposed by the local companion form. */
export const companionPolicyRoleIds: readonly AgentRoleId[] = Object.freeze(
  agentRoleIds.filter((id) => id !== "approval" && !id.startsWith("scout-")),
);
export const companionRoleOptions: readonly TrustedRoleOption[] = Object.freeze(
  companionPolicyRoleIds.map((id) => Object.freeze({ id, label: roleLabel(id) })),
);

/** Reasoning values understood by the local policy form and server contracts. */
export const companionReasoningLevels = ["low", "medium", "high", "xhigh", "max", "ultra", "none"] as const;
export type CompanionReasoningLevel = (typeof companionReasoningLevels)[number];

/**
 * Select only model records that the runtime has discovered and that Settings
 * permits an operator to edit. This is deliberately stricter than merely
 * checking an id in the allowlist: configured/unsupported records never become
 * selectable form options.
 */
export function selectableRolePolicyModels(
  models: readonly RuntimeModelOption[],
  allowedModels: readonly string[],
): RuntimeModelOption[] {
  if (!Array.isArray(models) || !Array.isArray(allowedModels)) return [];
  const seen = new Set<string>();
  return models.filter((model) => {
    if (!isSelectableRolePolicyModel(model, allowedModels) || seen.has(model.id)) return false;
    seen.add(model.id);
    return true;
  });
}

export function isSelectableRolePolicyModel(
  value: unknown,
  allowedModels: readonly string[],
): value is RuntimeModelOption {
  if (!isRecord(value) || !Array.isArray(allowedModels)) return false;
  return (
    typeof value.id === "string" &&
    /^(?:gpt|claude)-[a-z0-9][a-z0-9.-]{1,63}$/i.test(value.id) &&
    allowedModels.includes(value.id) &&
    value.availability === "discovered" &&
    value.editable === true &&
    typeof value.label === "string" &&
    value.label.trim().length > 0 &&
    Array.isArray(value.reasoningLevels) &&
    value.reasoningLevels.length > 0 &&
    value.reasoningLevels.every(isSupportedReasoning) &&
    typeof value.defaultReasoning === "string" &&
    value.reasoningLevels.includes(value.defaultReasoning as CompanionReasoningLevel)
  );
}

export function rolePolicyReasoningOptions(model: RuntimeModelOption | null): CompanionReasoningLevel[] {
  if (!model || !Array.isArray(model.reasoningLevels)) return [];
  return model.reasoningLevels.filter(isSupportedReasoning);
}

/** Keep a valid effort when possible, otherwise reset to the model default. */
export function resetInvalidRolePolicyReasoning(
  model: RuntimeModelOption | null,
  reasoning: string | null,
): string | null {
  const levels = rolePolicyReasoningOptions(model);
  if (!levels.length) return null;
  if (reasoning && levels.includes(reasoning as CompanionReasoningLevel)) return reasoning;
  if (model && levels.includes(model.defaultReasoning as CompanionReasoningLevel))
    return model.defaultReasoning;
  return levels[0] ?? null;
}

/** A request is exact only when it is complete and changes this role's policy. */
export function isExactRolePolicyRequest(
  currentPolicy: RuntimeAgentPolicy | null | undefined,
  request: RolePolicyRequest,
): boolean {
  return (
    nonEmptyString(request.model) &&
    nonEmptyString(request.reasoning) &&
    (currentPolicy === null ||
      currentPolicy === undefined ||
      currentPolicy.model !== request.model ||
      currentPolicy.reasoning !== request.reasoning)
  );
}

export function isTrustedRolePolicyRequest(
  request: RolePolicyRequest,
  roleOptions: readonly TrustedRoleOption[],
  models: readonly RuntimeModelOption[],
  allowedModels: readonly string[],
): boolean {
  const selectedModel =
    models.find((model) => isSelectableRolePolicyModel(model, allowedModels) && model.id === request.model) ??
    null;
  return (
    companionRoleOptions.some((role) => role.id === request.role) &&
    roleOptions.some((role) => role.id === request.role) &&
    selectedModel !== null &&
    isSelectableRolePolicyModel(selectedModel, allowedModels) &&
    request.reasoning !== null &&
    rolePolicyReasoningOptions(selectedModel).includes(request.reasoning as CompanionReasoningLevel)
  );
}

export interface RolePolicyFormOptions {
  models: readonly RuntimeModelOption[];
  allowedModels: readonly string[];
  roleOptions?: readonly TrustedRoleOption[];
  currentPolicy?: RuntimeAgentPolicy | null;
  currentPolicies?: Partial<Record<AgentRoleId, RuntimeAgentPolicy>>;
  resolveEligibility?: (request: RolePolicyRequest) => EligibilityEvidence;
}

export type RolePolicyFormOptionsSource =
  | RolePolicyFormOptions
  | ((proposal: RoleModelProposal) => RolePolicyFormOptions);

function isSupportedReasoning(value: unknown): value is CompanionReasoningLevel {
  return typeof value === "string" && companionReasoningLevels.includes(value as CompanionReasoningLevel);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function roleLabel(id: AgentRoleId) {
  const stage = workflowStages.find((item) => item.id === id);
  if (stage) return stage.label;
  if (id === "repair") return "Repair";
  if (id === "approval") return "Approval";
  return `${id
    .replace(/^scout-/, "")
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")} scout`;
}

/**
 * Return a card only when it is a member of the fixed local catalogue. The
 * catalogue intentionally contains data, not handlers, URLs, endpoints, JSX,
 * repository commands, or model-defined component descriptions.
 */
export function createTrustedActionCard(proposal: ActionProposal): TrustedActionCard {
  assertActionProposal(proposal);
  return { type: proposal.actionType, proposal };
}

export function assertTrustedActionCard(value: unknown): asserts value is TrustedActionCard {
  if (!isRecord(value) || !exactKeys(value, ["type", "proposal"])) {
    throw new Error("Action card must contain only a catalogue type and proposal.");
  }
  if (!isActionType(value.type)) throw new Error(`Unknown action card type: ${String(value.type)}.`);
  assertActionProposal(value.proposal);
  if (value.proposal.actionType !== value.type) {
    throw new Error("Action card type must match the proposal action type.");
  }
}

export function isTrustedActionCard(value: unknown): value is TrustedActionCard {
  try {
    assertTrustedActionCard(value);
    return true;
  } catch {
    return false;
  }
}

export const validateActionCard = isTrustedActionCard;
export { assertActionProposal };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(record: Record<string, unknown>, expected: string[]) {
  const actual = Object.keys(record).sort();
  const keys = [...expected].sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function isActionType(value: unknown): value is (typeof companionActionTypes)[number] {
  return (
    typeof value === "string" && companionActionTypes.includes(value as (typeof companionActionTypes)[number])
  );
}
