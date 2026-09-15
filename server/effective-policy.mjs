import { normalizeModelId, providerForModelId } from "./model-catalog.mjs";

export const EFFECTIVE_POLICY_VERSION = 1;

const PROVIDERS = new Set(["codex", "claude"]);
const MATERIAL_SEVERITIES = new Set(["P0", "P1"]);
const ARCHITECTURAL_RISK =
  /\b(security|authentication|authorization|permission|credential|secret|encryption|privacy|schema|migration|database|backfill|data[- ]integrity|concurrency|race condition|locking|deadlock|atomicity|architecture|architectural|cross[- ]cutting|rewrite|multi[- ]package)\b/i;

/**
 * Resolve the policy that owns an attempt before any provider process is started.
 * The returned record is persisted on the workflow reservation and is the only
 * policy authority execution may consume for that attempt.
 */
export function resolveEffectiveRunPolicy(task, role) {
  const selected = task?.agentConfig?.stagePolicies?.[role];
  if (!selected?.model || !selected?.reasoning) {
    throw new Error(
      `No recorded ${role} policy is available. Choose an eligible model and reasoning level before retrying.`,
    );
  }
  const selectedModel = normalizeModelId(selected.model);
  const selectedProvider = providerForModelId(selectedModel);
  if (!selectedProvider) {
    throw new Error(
      `The recorded ${role} model ${selectedModel} has no supported execution provider. Change this future role policy before retrying.`,
    );
  }
  const providerConstraint = task.agentConfig?.providerConstraint ?? null;
  if (providerConstraint != null && !PROVIDERS.has(providerConstraint)) {
    throw new Error(`The task has an unsupported provider constraint: ${providerConstraint}.`);
  }
  if (providerConstraint && selectedProvider !== providerConstraint) {
    throw new Error(
      `The ${role} policy uses ${selectedProvider}, outside this task's ${providerConstraint}-only constraint. Change or reset the future role policy before retrying.`,
    );
  }

  const source = policySource(task, role);
  let effective = { model: selectedModel, reasoning: String(selected.reasoning) };
  let effectiveProvider = selectedProvider;
  let escalationReason = null;
  if (role === "repair" && !isPinnedSource(source)) {
    const reason = eligibleRepairEscalationReason(task);
    const stronger =
      task.agentConfig?.repairEscalationPolicies?.[task.workflowProfile?.selected ?? "standard"];
    if (reason && stronger?.model && stronger?.reasoning) {
      const strongerModel = normalizeModelId(stronger.model);
      const strongerProvider = providerForModelId(strongerModel);
      if (!strongerProvider || strongerProvider !== selectedProvider) {
        throw new Error(
          `Repair escalation has no eligible ${selectedProvider} policy. Change the unpinned Repair policy before retrying.`,
        );
      }
      if (providerConstraint && strongerProvider !== providerConstraint) {
        throw new Error(
          `Repair escalation would cross this task's ${providerConstraint}-only constraint. Change the unpinned Repair policy before retrying.`,
        );
      }
      effective = { model: strongerModel, reasoning: String(stronger.reasoning) };
      effectiveProvider = strongerProvider;
      escalationReason = reason;
    }
  }

  return {
    policyVersion: EFFECTIVE_POLICY_VERSION,
    profile: task.workflowProfile?.selected ?? "standard",
    role,
    source,
    providerConstraint,
    selectedProvider,
    selectedModel,
    selectedReasoning: String(selected.reasoning),
    provider: effectiveProvider,
    model: effective.model,
    reasoning: effective.reasoning,
    escalationReason,
  };
}

/** Read an already-persisted policy without consulting mutable task/settings state. */
export function effectivePolicyFromReservation(reservation, expectedRole) {
  const policy = reservation?.effectivePolicy;
  if (!policy || policy.policyVersion !== EFFECTIVE_POLICY_VERSION) {
    throw new Error(
      "The active workflow reservation predates the effective-policy contract. Retry the stage to create a new policy-bound reservation.",
    );
  }
  if (policy.role !== expectedRole) {
    throw new Error(
      `The active workflow reservation is bound to ${policy.role}, but execution requested ${expectedRole}. Retry the stage.`,
    );
  }
  if (reservation.provider !== policy.provider) {
    throw new Error(
      `The active workflow reservation records provider ${reservation.provider}, but its effective policy requires ${policy.provider}. Retry the stage.`,
    );
  }
  return structuredClone(policy);
}

function policySource(task, role) {
  return (
    task?.agentConfig?.rolePolicySources?.[role] ??
    (Object.hasOwn(task?.agentConfig?.rolePolicyOverrides ?? {}, role)
      ? "legacy-task-override"
      : "legacy-recorded-policy")
  );
}

function isPinnedSource(source) {
  return ["task-override", "legacy-task-override", "future-role-override"].includes(source);
}

function eligibleRepairEscalationReason(task) {
  const candidate = task.candidates?.at(-1);
  if (!candidate) return null;
  const gate = [...(task.runs ?? [])]
    .reverse()
    .find(
      (run) =>
        ["dev-review", "test", "final-review"].includes(run.stage) &&
        run.candidateId === candidate.id &&
        run.candidateRevision === candidate.revisionNumber &&
        run.gateResult?.verdict === "REPAIR",
    );
  const finding = gate?.gateResult?.findings?.find(
    (item) =>
      item?.kind === "candidate-defect" &&
      item?.blocking === true &&
      (MATERIAL_SEVERITIES.has(item.severity) ||
        ARCHITECTURAL_RISK.test(`${item.title ?? ""} ${item.detail ?? ""} ${item.file ?? ""}`)),
  );
  if (!finding) return null;
  return `Verified ${finding.severity ?? "material"} candidate defect from ${gate.stage}: ${String(
    finding.title ?? "repair required",
  ).slice(0, 500)}`;
}
