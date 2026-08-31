import { normalizeModelId, POLICY_IDS, readExecutionProviderCatalog } from "./model-catalog.mjs";
import { runActionAdmission } from "./action-policy.mjs";
import { withActionEligibility } from "./retry-admission-policy.mjs";

const GATE_ACTIONS = Object.freeze({
  "dev-review": "review",
  test: "test",
  "final-review": "final-review",
  approval: "open-pr",
});

const REQUIRED_AUTHORITY_FIELDS = ["id", "selectedRevision", "targetRef", "capturedAt"];

export const companionGateActions = GATE_ACTIONS;
export const companionPolicyRoles = Object.freeze([...POLICY_IDS]);

/**
 * A denial is data rather than an exception so the HTTP boundary can retain the
 * reason on an action card. Model text and browser supplied eligibility are never
 * used as authority; callers pass the stored task to these functions.
 */
export function companionDenial(code, reason, evidence = [], status = 409) {
  return {
    ok: false,
    status,
    code,
    reason,
    evidence: [reason, ...evidence].filter((item, index, all) => item && all.indexOf(item) === index),
  };
}

export function companionSuccess(value) {
  return { ok: true, ...value };
}

/** Resolve a role policy against the current discovered catalogue and settings. */
export function resolveRolePolicyEligibility(task, input, settings, catalog) {
  if (!task?.id) return companionDenial("unauthorized", "The selected task is no longer available.");
  if (!task.agentConfig || !isRecord(task.agentConfig.stagePolicies)) {
    return companionDenial("invalid-policy", "The selected task has no mutable policy snapshot.", [
      "This task must be migrated or recreated before a role policy can be changed.",
    ]);
  }
  if (!isRecord(input) || !exactKeys(input, ["role", "model", "reasoning"])) {
    return companionDenial(
      "invalid-policy",
      "A task policy change must contain only role, model, and reasoning.",
      [],
      400,
    );
  }
  if (typeof input.role !== "string" || !companionPolicyRoles.includes(input.role)) {
    return companionDenial("invalid-policy", "The requested agent role is not a task model role.", [], 400);
  }
  if (typeof input.model !== "string" || !input.model.trim()) {
    return companionDenial(
      "invalid-policy",
      "Choose a model before confirming the task policy change.",
      [],
      400,
    );
  }
  if (typeof input.reasoning !== "string" || !input.reasoning.trim()) {
    return companionDenial(
      "invalid-policy",
      "Choose a reasoning level before confirming the task policy change.",
      [],
      400,
    );
  }

  const modelId = normalizeModelId(input.model);
  const model = (catalog?.models ?? []).find((entry) => entry.id === modelId);
  const allowed = Array.isArray(settings?.allowedModels) && settings.allowedModels.includes(modelId);
  if (!model || !allowed || model.editable !== true) {
    return companionDenial(
      "invalid-policy",
      "The requested model is not in the discovered, editable runtime allowlist.",
      [`Requested model: ${modelId}.`, `Allowed models: ${settings?.allowedModels?.join(", ") || "none"}.`],
      400,
    );
  }
  const reasoning = input.reasoning.trim().toLowerCase();
  if (!model.reasoningLevels?.includes(reasoning)) {
    return companionDenial(
      "invalid-policy",
      `${model.label ?? modelId} does not support ${reasoning} reasoning for this role.`,
      [`Supported reasoning: ${(model.reasoningLevels ?? []).join(", ") || "none"}.`],
      400,
    );
  }

  return companionSuccess({
    role: input.role,
    policy: { model: modelId, reasoning },
    evidence: [
      `Task ${task.id} policy snapshot will be updated only for ${input.role}.`,
      `${model.label ?? modelId} is discovered, editable, and allowed by Settings.`,
    ],
  });
}

/**
 * Apply exactly one task snapshot policy. The caller must have resolved the
 * policy first; this function deliberately does not touch global settings,
 * task-level fallback fields, models, runs, or historical artifacts.
 */
export function applyTaskRolePolicy(task, role, policy) {
  if (!task?.agentConfig || !isRecord(task.agentConfig.stagePolicies)) {
    throw new Error("The selected task has no mutable stage-policy snapshot.");
  }
  task.agentConfig.stagePolicies[role] = { model: policy.model, reasoning: policy.reasoning };
}

export async function updateTaskRolePolicy({ store, taskId, input, catalog } = {}) {
  const task = await store?.get(taskId);
  if (!task) return companionDenial("unauthorized", "The selected task is no longer available.", [], 404);
  const authority = repositoryAuthorityEligibility(task);
  if (!authority.ok) return authority;
  const settings = await store.settings();
  const resolvedCatalog = catalog ?? (await readExecutionProviderCatalog());
  const eligibility = resolveRolePolicyEligibility(task, input, settings, resolvedCatalog);
  if (!eligibility.ok) return eligibility;

  let authorityDenial;
  let updated;
  try {
    updated = await store.transition(
      taskId,
      (draft) => {
        if (!draft.agentConfig?.stagePolicies || draft.id !== taskId) return false;
        const currentAuthority = repositoryAuthorityEligibility(draft);
        if (!currentAuthority.ok) authorityDenial = currentAuthority;
        return currentAuthority.ok;
      },
      (draft) => applyTaskRolePolicy(draft, eligibility.role, eligibility.policy),
    );
  } catch (error) {
    if (error?.code === "TASK_TRANSITION_CONFLICT") {
      if (authorityDenial) return authorityDenial;
      return companionDenial(
        "unauthorized",
        "The task changed before its policy snapshot could be updated. Review the task and try again.",
      );
    }
    throw error;
  }
  if (!updated) return companionDenial("unauthorized", "The selected task is no longer available.", [], 404);
  return companionSuccess({ task: updated, role: eligibility.role, policy: eligibility.policy });
}

export function gateActionForStage(nextStage) {
  return typeof nextStage === "string" ? (GATE_ACTIONS[nextStage] ?? null) : null;
}

export function exactCandidateBinding(task, input) {
  const candidate = task?.candidates?.at(-1) ?? null;
  const expected = {
    candidateId: input?.candidateId,
    candidateRevision: input?.candidateRevision,
    candidateHeadRevision: input?.candidateHeadRevision,
  };
  if (
    !candidate ||
    !nonEmptyString(expected.candidateId) ||
    !Number.isSafeInteger(expected.candidateRevision) ||
    expected.candidateRevision < 1 ||
    !nonEmptyString(expected.candidateHeadRevision)
  ) {
    return companionDenial(
      "stale-candidate",
      "Confirmation must include the exact current candidate ID, revision, and head revision.",
      [candidate ? candidateEvidence(candidate) : "No integration candidate is retained on this task."],
    );
  }
  if (
    candidate.id !== expected.candidateId ||
    candidate.revisionNumber !== expected.candidateRevision ||
    candidate.headRevision !== expected.candidateHeadRevision
  ) {
    return companionDenial(
      "stale-candidate",
      "The candidate changed after this action was proposed. The proposal remains reviewable and must be refreshed.",
      [
        `Expected ${expected.candidateId} revision ${expected.candidateRevision} @ ${expected.candidateHeadRevision}.`,
        `Current ${candidateEvidence(candidate)}.`,
      ],
    );
  }
  return companionSuccess({ candidate });
}

export function repositoryAuthorityEligibility(task) {
  const authority = task?.repositoryAuthority;
  if (task?.repositoryAuthorityStatus !== "bound" || !isRecord(authority)) {
    return companionDenial(
      "repository-authority",
      "The task is not bound to a verified repository authority, so this governed action is not permitted.",
      [
        "Revalidate the retained plan and repository authority before changing task policy or promoting a candidate.",
      ],
    );
  }
  const missing = REQUIRED_AUTHORITY_FIELDS.filter((field) => !nonEmptyString(authority[field]));
  if (missing.length) {
    return companionDenial(
      "repository-authority",
      "The task repository authority binding is incomplete, so candidate promotion is not permitted.",
      [`Missing authority fields: ${missing.join(", ")}.`],
    );
  }
  if (authority.upstreamRef && authority.remoteVerification?.status !== "verified") {
    return companionDenial(
      "repository-authority",
      "The tracked repository authority could not be verified, so candidate promotion is not permitted.",
      [authority.remoteVerification?.error ?? "Remote repository verification is not current."],
    );
  }
  return companionSuccess({ authority });
}

/**
 * Resolve a candidate-bound gate from canonical task state. `actionEligibility`
 * is recomputed here instead of trusting a browser projection, and the lower
 * level runActionAdmission result remains the final workflow policy source.
 */
export function resolveGatePromotionEligibility(task, input) {
  const unsupportedFields = Object.keys(input ?? {}).filter(
    (key) =>
      !["action", "nextStage", "candidateId", "candidateRevision", "candidateHeadRevision", "note"].includes(
        key,
      ),
  );
  if (unsupportedFields.length) {
    return companionDenial(
      "unknown",
      "Gate confirmation contains unsupported fields and was not admitted.",
      [`Unsupported fields: ${unsupportedFields.join(", ")}.`],
      400,
    );
  }
  const requestedAction =
    typeof input?.action === "string" ? input.action : gateActionForStage(input?.nextStage);
  const action = requestedAction === "approve-merge" ? "open-pr" : requestedAction;
  if (!action || !Object.values(GATE_ACTIONS).includes(action)) {
    return companionDenial("ineligible", "The requested companion gate is not supported by this runtime.");
  }
  const nextStageAction = gateActionForStage(input?.nextStage);
  if (input?.nextStage !== undefined && nextStageAction !== action) {
    return companionDenial(
      "ineligible",
      "The confirmed gate does not match the requested next stage.",
      [`Requested next stage: ${String(input.nextStage)}.`],
      400,
    );
  }
  const authority = repositoryAuthorityEligibility(task);
  if (!authority.ok) return authority;
  const binding = exactCandidateBinding(task, input);
  if (!binding.ok) return binding;
  if (
    nonEmptyString(binding.candidate.baseRevision) &&
    binding.candidate.baseRevision !== authority.authority.selectedRevision
  ) {
    return companionDenial(
      "repository-authority",
      "The candidate is based on a different repository revision than the task authority, so promotion is not permitted.",
      [
        `Candidate base revision: ${binding.candidate.baseRevision}.`,
        `Bound repository revision: ${authority.authority.selectedRevision}.`,
      ],
    );
  }

  const projected = withActionEligibility(task).actionEligibility?.actions?.[action];
  const admission = action === "open-pr" ? null : runActionAdmission(task, action);
  const executable = action === "open-pr" ? projected?.allowed === true : admission?.mode === "execute";
  if (!projected?.allowed || !executable) {
    return companionDenial(
      "ineligible",
      admission?.reason ?? projected?.reason ?? `The task is not eligible for the ${action} gate.`,
      [
        `Canonical eligibility: ${projected?.allowed ? "allowed" : "denied"}.`,
        admission?.mode
          ? `Admission mode: ${admission.mode}.`
          : "The approval admission is not a run reservation.",
      ],
    );
  }
  return companionSuccess({
    action,
    candidate: binding.candidate,
    evidence: [
      `Repository authority ${authority.authority.id} is bound to ${authority.authority.selectedRevision}.`,
      `${binding.candidate.id} revision ${binding.candidate.revisionNumber} @ ${binding.candidate.headRevision}.`,
      `Canonical ${action} admission is executable for the current task state.`,
    ],
  });
}

export function companionActionResponse(result) {
  if (result?.ok) return null;
  return {
    error: result?.reason ?? "The companion action was denied.",
    code: result?.code ?? "unknown",
    evidence: result?.evidence ?? [result?.reason ?? "No retained denial evidence was available."],
  };
}

function candidateEvidence(candidate) {
  return `${candidate.id} revision ${candidate.revisionNumber} @ ${candidate.headRevision ?? "no head revision"}`;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(record, expected) {
  const actual = Object.keys(record).sort();
  const keys = [...expected].sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}
