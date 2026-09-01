import { type AgentRoleId, agentRoleIds, type NewTaskDraft, type StageId } from "../domain.ts";

export const companionActionTypes = ["create-task", "change-role-model", "promote-gate"] as const;
export type CompanionActionType = (typeof companionActionTypes)[number];

export const companionGateStages = ["dev-review", "test", "final-review", "approval"] as const;
export type CompanionGateStage = (typeof companionGateStages)[number];

export type CompanionIntent =
  | { kind: "context" }
  | { kind: "navigate"; target: "tasks" }
  | { kind: "navigate"; target: "task"; taskId: string }
  | { kind: "create-task" }
  | {
      kind: "change-role-model";
      role: AgentRoleId;
      model: string | null;
      reasoning: string | null;
    }
  | { kind: "promote-gate"; nextStage: CompanionGateStage };

export type ProposalState = "proposed" | "confirmed" | "executed" | "dismissed";

export interface CompanionContext {
  route: string;
  taskId?: string;
  activeStage: StageId | null;
  viewedStage: StageId | null;
  candidateId?: string;
  candidateRevision?: number;
}

export interface EligibilityEvidence {
  eligible: boolean;
  rationale: string;
  evidence: string[];
}

export type ProposalFailureCode =
  | "stale-csrf"
  | "unauthorized"
  | "repository-authority"
  | "stale-candidate"
  | "invalid-policy"
  | "ineligible"
  | "unknown";

export interface ProposalFailure {
  code: ProposalFailureCode;
  reason: string;
  retainedAt: string;
}

export interface CreateTaskTarget {
  kind: "new-task";
  draft: NewTaskDraft | null;
}

export interface RoleModelTarget {
  kind: "task-agent-policy";
  scope: "task_snapshot";
  taskId: string;
  role: AgentRoleId;
  model: string | null;
  reasoning: string | null;
}

/** The only policy values a trusted role-policy form may request. */
export interface RolePolicyRequest {
  role: AgentRoleId;
  model: string | null;
  reasoning: string | null;
}

export interface GatePromotionTarget {
  kind: "candidate-gate";
  scope: "candidate";
  taskId: string;
  candidateId: string;
  candidateRevision: number;
  nextStage: CompanionGateStage;
}

export type ActionTarget = CreateTaskTarget | RoleModelTarget | GatePromotionTarget;

interface ActionProposalBase {
  id: string;
  summary: string;
  eligibility: EligibilityEvidence;
  confirmationRequired: true;
  state: ProposalState;
  createdAt: string;
  confirmedAt?: string;
  executedAt?: string;
  dismissedAt?: string;
  dismissedReason?: string;
  failure?: ProposalFailure;
}

export type CreateTaskProposal = ActionProposalBase & {
  actionType: "create-task";
  target: CreateTaskTarget;
};

export type RoleModelProposal = ActionProposalBase & {
  actionType: "change-role-model";
  target: RoleModelTarget;
};

export type GatePromotionProposal = ActionProposalBase & {
  actionType: "promote-gate";
  target: GatePromotionTarget;
};

export type ActionProposal = CreateTaskProposal | RoleModelProposal | GatePromotionProposal;

type ActionProposalInputBase = Omit<
  ActionProposalBase,
  | "confirmationRequired"
  | "state"
  | "createdAt"
  | "confirmedAt"
  | "executedAt"
  | "dismissedAt"
  | "dismissedReason"
  | "failure"
> & {
  createdAt?: string;
};

export type ActionProposalInput =
  | (ActionProposalInputBase & { actionType: "create-task"; target: CreateTaskTarget })
  | (ActionProposalInputBase & { actionType: "change-role-model"; target: RoleModelTarget })
  | (ActionProposalInputBase & { actionType: "promote-gate"; target: GatePromotionTarget });

export interface ProposalConfirmation {
  at?: string;
}

export interface ProposalDismissal {
  reason?: string;
  at?: string;
}

export interface ProposalDenial {
  code: ProposalFailureCode;
  reason: string;
  at?: string;
}

const defaultProposalTimestamp = () => new Date().toISOString();
const proposalInputKeys = ["id", "actionType", "summary", "eligibility", "target"];
const proposalInputOptionalKeys = ["createdAt"];
const proposalRequiredKeys = [
  "id",
  "actionType",
  "summary",
  "eligibility",
  "confirmationRequired",
  "state",
  "createdAt",
  "target",
];
const proposalOptionalKeys = ["confirmedAt", "executedAt", "dismissedAt", "dismissedReason", "failure"];
const eligibilityKeys = ["eligible", "rationale", "evidence"];
const failureKeys = ["code", "reason", "retainedAt"];

/**
 * Construct the only pre-mutation state. Creating a proposal has no transport,
 * callback, endpoint, repository path, or other executable capability.
 */
export function createActionProposal(input: ActionProposalInput): ActionProposal {
  if (
    !isRecord(input) ||
    !requiredKeys(input, proposalInputKeys) ||
    Object.keys(input).some((key) => ![...proposalInputKeys, ...proposalInputOptionalKeys].includes(key))
  ) {
    throw new Error("Action proposal input contains an unknown or missing field.");
  }
  const proposal = {
    ...input,
    createdAt: input.createdAt ?? defaultProposalTimestamp(),
    confirmationRequired: true as const,
    state: "proposed" as const,
  } as ActionProposal;
  assertActionProposal(proposal);
  return proposal;
}

/**
 * Replace only the unexecuted task-snapshot request represented by a role-model
 * proposal. This is a local projection helper; the server remains authoritative
 * when the proposal is confirmed.
 */
export function updateRoleModelProposal(
  proposal: ActionProposal,
  request: RolePolicyRequest,
  eligibility = proposal.eligibility,
): RoleModelProposal {
  assertActionProposal(proposal);
  if (proposal.actionType !== "change-role-model") {
    throw new Error("Only role-model proposals can receive a role policy request.");
  }
  if (proposal.state !== "proposed") {
    throw new Error(`Only proposed role-model actions can be edited; received ${proposal.state}.`);
  }
  const next = {
    ...proposal,
    summary: `Use ${request.model ?? "a discovered model"} for the ${request.role} agent on ${proposal.target.taskId}.`,
    eligibility,
    target: {
      ...proposal.target,
      role: request.role,
      model: request.model,
      reasoning: request.reasoning,
    },
  };
  delete next.failure;
  assertActionProposal(next);
  return next;
}

/** Confirm locally after the operator has reviewed the card; this still does not invoke an API. */
export function confirmActionProposal(proposal: ActionProposal, confirmation: ProposalConfirmation = {}) {
  assertActionProposal(proposal);
  if (proposal.state !== "proposed") {
    throw new Error(`Only proposed actions can be confirmed; received ${proposal.state}.`);
  }
  if (!proposal.eligibility.eligible) {
    throw new Error("This action is not eligible for confirmation.");
  }
  const next = withoutProposalLifecycleFields(proposal);
  return {
    ...next,
    state: "confirmed" as const,
    confirmedAt: lifecycleTimestamp(confirmation.at, "Confirmation time"),
  } as ActionProposal;
}

/** Mark the server-authorised mutation as complete only after its endpoint succeeds. */
export function executeActionProposal(proposal: ActionProposal, at = defaultProposalTimestamp()) {
  assertActionProposal(proposal);
  if (proposal.state !== "confirmed") {
    throw new Error(`Only confirmed actions can be executed; received ${proposal.state}.`);
  }
  return {
    ...proposal,
    state: "executed" as const,
    executedAt: lifecycleTimestamp(at, "Execution time"),
  } as ActionProposal;
}

export function dismissActionProposal(proposal: ActionProposal, dismissal: ProposalDismissal = {}) {
  assertActionProposal(proposal);
  if (proposal.state !== "proposed") {
    throw new Error(`Only proposed actions can be dismissed; received ${proposal.state}.`);
  }
  if (dismissal.reason !== undefined && !nonEmptyString(dismissal.reason)) {
    throw new Error("Dismissal reason must be a non-empty string when present.");
  }
  const next = withoutProposalLifecycleFields(proposal);
  return {
    ...next,
    state: "dismissed" as const,
    dismissedAt: lifecycleTimestamp(dismissal.at, "Dismissal time"),
    ...(dismissal.reason ? { dismissedReason: dismissal.reason } : {}),
  } as ActionProposal;
}

/** Retain server denial evidence and return to reviewable proposed state. */
export function retainProposalDenial(proposal: ActionProposal, denial: ProposalDenial) {
  assertActionProposal(proposal);
  if (proposal.state !== "proposed" && proposal.state !== "confirmed") {
    throw new Error(`A ${proposal.state} action cannot retain a confirmation denial.`);
  }
  if (!isRecord(denial) || !isFailureCode(denial.code) || !nonEmptyString(denial.reason)) {
    throw new Error("Confirmation denial must contain a stable code and reason.");
  }
  const next = withoutProposalLifecycleFields(proposal);
  return {
    ...next,
    state: "proposed" as const,
    failure: {
      code: denial.code,
      reason: denial.reason,
      retainedAt: lifecycleTimestamp(denial.at, "Denial time"),
    },
  } as ActionProposal;
}

function lifecycleTimestamp(value: unknown, label: string) {
  if (value === undefined) return defaultProposalTimestamp();
  if (!nonEmptyString(value)) throw new Error(`${label} must be a non-empty string when present.`);
  return value;
}

function withoutProposalLifecycleFields(proposal: ActionProposal) {
  const next = { ...proposal } as Partial<ActionProposal>;
  delete next.confirmedAt;
  delete next.executedAt;
  delete next.dismissedAt;
  delete next.dismissedReason;
  delete next.failure;
  return next;
}

/** Validate the serialisable part of the trusted catalogue at the boundary. */
export function assertActionProposal(value: unknown): asserts value is ActionProposal {
  if (
    !isRecord(value) ||
    !requiredKeys(value, proposalRequiredKeys) ||
    Object.keys(value).some((key) => ![...proposalRequiredKeys, ...proposalOptionalKeys].includes(key))
  ) {
    throw new Error("Action proposal contains an unknown or missing field.");
  }
  if (!isActionType(value.actionType)) throw new Error("Action proposal has an unknown action type.");
  if (!nonEmptyString(value.id) || !nonEmptyString(value.summary) || !nonEmptyString(value.createdAt)) {
    throw new Error("Action proposal identity, summary, and creation time are required.");
  }
  if (value.confirmationRequired !== true) throw new Error("All companion mutations require confirmation.");
  if (!isProposalState(value.state)) throw new Error("Action proposal has an unknown lifecycle state.");
  assertEligibility(value.eligibility);
  if (
    value.actionType === "create-task" &&
    isRecord(value.target) &&
    value.target.draft === null &&
    value.eligibility.eligible
  ) {
    throw new Error("Create-task proposals require a validated draft before confirmation.");
  }
  assertTarget(value.actionType, value.target);
  if (value.failure !== undefined) assertFailure(value.failure);
  for (const key of ["confirmedAt", "executedAt", "dismissedAt", "dismissedReason"]) {
    if (value[key] !== undefined && typeof value[key] !== "string") {
      throw new Error(`${key} must be a string when present.`);
    }
  }

  const has = (key: string) => value[key] !== undefined;
  if (value.state === "proposed") {
    if (has("confirmedAt") || has("executedAt") || has("dismissedAt") || has("dismissedReason")) {
      throw new Error("Proposed action proposals cannot retain a terminal lifecycle timestamp.");
    }
  } else if (value.state === "confirmed") {
    if (
      !nonEmptyString(value.confirmedAt) ||
      has("executedAt") ||
      has("dismissedAt") ||
      has("dismissedReason")
    ) {
      throw new Error("Confirmed action proposals must retain only their confirmation time.");
    }
  } else if (value.state === "executed") {
    if (
      !nonEmptyString(value.confirmedAt) ||
      !nonEmptyString(value.executedAt) ||
      has("dismissedAt") ||
      has("dismissedReason")
    ) {
      throw new Error("Executed action proposals must retain confirmation and execution times only.");
    }
  } else if (!nonEmptyString(value.dismissedAt) || has("confirmedAt") || has("executedAt")) {
    throw new Error("Dismissed action proposals must retain only their dismissal time.");
  }
  if (value.state !== "proposed" && value.failure !== undefined) {
    throw new Error("Confirmation failure evidence belongs to the reviewable proposed state.");
  }
}

function assertEligibility(value: unknown): asserts value is EligibilityEvidence {
  if (
    !isRecord(value) ||
    !exactKeys(value, eligibilityKeys) ||
    typeof value.eligible !== "boolean" ||
    !nonEmptyString(value.rationale) ||
    !Array.isArray(value.evidence) ||
    value.evidence.some((item) => !nonEmptyString(item))
  ) {
    throw new Error("Action proposal eligibility must contain rationale and evidence.");
  }
}

function assertFailure(value: unknown): asserts value is ProposalFailure {
  if (!isRecord(value) || !exactKeys(value, failureKeys))
    throw new Error("Retained proposal failure is malformed.");
  if (!isFailureCode(value.code) || !nonEmptyString(value.reason) || !nonEmptyString(value.retainedAt)) {
    throw new Error("Retained proposal failure must contain a stable code and reason.");
  }
}

function assertTarget(
  actionType: ActionProposal["actionType"],
  value: unknown,
): asserts value is ActionTarget {
  if (!isRecord(value)) throw new Error("Action proposal target is missing.");
  if (actionType === "create-task") {
    if (!exactKeys(value, ["kind", "draft"]) || value.kind !== "new-task") {
      throw new Error("Create-task proposals require the fixed new-task target.");
    }
    if (value.draft !== null) assertNewTaskDraft(value.draft);
    return;
  }
  if (actionType === "change-role-model") {
    if (
      !exactKeys(value, ["kind", "scope", "taskId", "role", "model", "reasoning"]) ||
      value.kind !== "task-agent-policy" ||
      value.scope !== "task_snapshot" ||
      !safeIdentity(value.taskId) ||
      typeof value.role !== "string" ||
      !agentRoleIds.includes(value.role as AgentRoleId) ||
      !(value.model === null || (typeof value.model === "string" && validModelId(value.model))) ||
      !(value.reasoning === null || (typeof value.reasoning === "string" && validReasoning(value.reasoning)))
    ) {
      throw new Error("Role-model proposals require a task snapshot scope and fixed policy fields.");
    }
    return;
  }
  if (
    !exactKeys(value, ["kind", "scope", "taskId", "candidateId", "candidateRevision", "nextStage"]) ||
    value.kind !== "candidate-gate" ||
    value.scope !== "candidate" ||
    !safeIdentity(value.taskId) ||
    !safeIdentity(value.candidateId) ||
    !positiveSafeInteger(value.candidateRevision) ||
    !isGateStage(value.nextStage)
  ) {
    throw new Error("Gate proposals require exact task, candidate, revision, and next-gate scope.");
  }
}

function assertNewTaskDraft(value: unknown): asserts value is NewTaskDraft {
  if (!isRecord(value)) throw new Error("Create-task proposal draft is malformed.");
  const required = ["title", "description", "repositoryPath", "workflow", "priority"];
  const optional = ["designRequested", "workflowProfile", "model", "reasoning", "experiment", "attachments"];
  if (
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => ![...required, ...optional].includes(key)) ||
    required.some((key) => !nonEmptyString(value[key])) ||
    !["investigate", "implement"].includes(String(value.workflow)) ||
    !["low", "medium", "high"].includes(String(value.priority))
  ) {
    throw new Error("Create-task proposals must carry the validated NewTaskDraft fields.");
  }
  if (value.designRequested !== undefined && typeof value.designRequested !== "boolean") {
    throw new Error("NewTaskDraft.designRequested must be boolean.");
  }
  if (
    value.workflowProfile !== undefined &&
    !["auto", "fast", "standard", "high-risk"].includes(String(value.workflowProfile))
  ) {
    throw new Error("NewTaskDraft.workflowProfile is invalid.");
  }
  if (value.model !== undefined && (typeof value.model !== "string" || !validModelId(value.model))) {
    throw new Error("NewTaskDraft.model is invalid.");
  }
  if (
    value.reasoning !== undefined &&
    (typeof value.reasoning !== "string" || !validReasoning(value.reasoning))
  ) {
    throw new Error("NewTaskDraft.reasoning is invalid.");
  }
  if (value.experiment !== undefined && value.experiment !== null) {
    if (!isRecord(value.experiment)) throw new Error("NewTaskDraft.experiment is invalid.");
    const experiment = value.experiment;
    const experimentKeys = [
      "groupId",
      "variantId",
      "frozenBaseSha",
      "acceptanceCriteria",
      "verificationCommands",
    ];
    if (
      !exactKeys(experiment, experimentKeys) ||
      experimentKeys.slice(0, 3).some((key) => !nonEmptyString(experiment[key])) ||
      !stringArray(experiment.acceptanceCriteria) ||
      !stringArray(experiment.verificationCommands)
    ) {
      throw new Error("NewTaskDraft.experiment is invalid.");
    }
  }
  if (value.attachments !== undefined) {
    if (!Array.isArray(value.attachments)) throw new Error("NewTaskDraft.attachments is invalid.");
    for (const attachment of value.attachments) {
      if (!isRecord(attachment)) throw new Error("NewTaskDraft attachment is invalid.");
      if (
        !exactKeys(attachment, ["name", "type", "size", "data"]) ||
        !nonEmptyString(attachment.name) ||
        !nonEmptyString(attachment.type) ||
        typeof attachment.size !== "number" ||
        !Number.isSafeInteger(attachment.size) ||
        attachment.size < 0 ||
        typeof attachment.data !== "string"
      ) {
        throw new Error("NewTaskDraft attachment is invalid.");
      }
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(record: Record<string, unknown>, expected: string[]) {
  const actual = Object.keys(record).sort();
  const keys = [...expected].sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function requiredKeys(record: Record<string, unknown>, required: string[]) {
  return required.every((key) => Object.hasOwn(record, key));
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function safeIdentity(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value);
}

function validModelId(value: string) {
  return /^(?:gpt|claude)-[a-z0-9][a-z0-9.-]{1,63}$/i.test(value);
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function validReasoning(value: string) {
  return /^(?:low|medium|high|xhigh|max|ultra|none)$/i.test(value);
}

function isActionType(value: unknown): value is CompanionActionType {
  return typeof value === "string" && companionActionTypes.includes(value as CompanionActionType);
}

function isProposalState(value: unknown): value is ProposalState {
  return value === "proposed" || value === "confirmed" || value === "executed" || value === "dismissed";
}

function isGateStage(value: unknown): value is CompanionGateStage {
  return typeof value === "string" && companionGateStages.includes(value as CompanionGateStage);
}

function isFailureCode(value: unknown): value is ProposalFailureCode {
  return (
    value === "stale-csrf" ||
    value === "unauthorized" ||
    value === "repository-authority" ||
    value === "stale-candidate" ||
    value === "invalid-policy" ||
    value === "ineligible" ||
    value === "unknown"
  );
}
