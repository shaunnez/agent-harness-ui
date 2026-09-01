import { CheckCircle, CircleNotch, Info, WarningCircle, X, XCircle } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import {
  companionRoleOptions,
  isExactRolePolicyRequest,
  isTrustedRolePolicyRequest,
  resetInvalidRolePolicyReasoning,
  rolePolicyReasoningOptions,
  selectableRolePolicyModels,
  type RolePolicyFormOptions,
} from "../../companion/catalog";
import {
  type ActionProposal,
  type RoleModelProposal,
  type RolePolicyRequest,
  assertActionProposal,
  updateRoleModelProposal,
} from "../../companion/contracts";
import type { AgentRoleId } from "../../domain";

export interface RolePolicyActionCardProps extends RolePolicyFormOptions {
  proposal: RoleModelProposal;
  pending?: boolean;
  anyPending?: boolean;
  localError?: string;
  onConfirm: (proposal: ActionProposal) => void;
  onDismiss: () => void;
}

/**
 * The role-policy card is a trusted local form. Model and reasoning options are
 * projected from the discovered runtime catalogue; proposal data never supplies
 * JSX, HTML, handlers, URLs, endpoints, or repository paths.
 */
export function RolePolicyActionCard({
  proposal,
  models,
  allowedModels,
  roleOptions = companionRoleOptions,
  currentPolicy,
  currentPolicies,
  resolveEligibility,
  pending = false,
  anyPending = false,
  localError,
  onConfirm,
  onDismiss,
}: RolePolicyActionCardProps) {
  assertActionProposal(proposal);
  const trustedRoleOptions = companionRoleOptions.filter((knownRole) =>
    roleOptions.some((role) => role.id === knownRole.id),
  );
  const selectableModels = useMemo(
    () => selectableRolePolicyModels(models, allowedModels),
    [models, allowedModels],
  );
  const [request, setRequest] = useState<RolePolicyRequest>(() => ({
    role: proposal.target.role,
    model: proposal.target.model,
    reasoning: proposal.target.reasoning,
  }));
  const [reasoningReset, setReasoningReset] = useState<string | null>(null);
  const selectedModel = selectableModels.find((model) => model.id === request.model) ?? null;
  const selectedReasoning = rolePolicyReasoningOptions(selectedModel);
  const selectedRolePolicy =
    currentPolicies?.[request.role] ?? (request.role === proposal.target.role ? currentPolicy : null);
  const projectedEligibility = resolveEligibility
    ? resolveEligibility(request)
    : sameRequest(request, proposal.target)
      ? proposal.eligibility
      : editedRequestEligibility();
  const trustedRequest = isTrustedRolePolicyRequest(
    request,
    trustedRoleOptions,
    selectableModels,
    allowedModels,
  );
  const exactRequest = isExactRolePolicyRequest(selectedRolePolicy, request);
  const canConfirm =
    proposal.state === "proposed" &&
    trustedRequest &&
    exactRequest &&
    projectedEligibility.eligible &&
    !anyPending;
  const titleId = `companion-action-${proposal.id}-title`;
  const requestLabel =
    request.model && request.reasoning ? `${request.model} · ${request.reasoning}` : "Incomplete";

  const updateModel = (modelId: string) => {
    const nextModel = selectableModels.find((model) => model.id === modelId) ?? null;
    const nextReasoning = resetInvalidRolePolicyReasoning(nextModel, request.reasoning);
    const didReset = Boolean(nextModel && request.reasoning && nextReasoning !== request.reasoning);
    setRequest((current) => ({ ...current, model: nextModel?.id ?? null, reasoning: nextReasoning }));
    setReasoningReset(
      didReset
        ? `Reasoning reset to ${nextReasoning ?? "none"} because ${nextModel?.label ?? "the selected model"} does not support the previous level.`
        : null,
    );
  };

  const updateRole = (role: AgentRoleId) => {
    const rolePolicy = currentPolicies?.[role] ?? (role === proposal.target.role ? currentPolicy : null);
    const roleModel = selectableModels.find((model) => model.id === rolePolicy?.model) ?? null;
    const fallbackModel = roleModel ?? selectableModels[0] ?? null;
    const nextReasoning = resetInvalidRolePolicyReasoning(fallbackModel, rolePolicy?.reasoning ?? null);
    setRequest({ role, model: fallbackModel?.id ?? null, reasoning: nextReasoning });
    setReasoningReset(null);
  };

  const confirm = () => {
    if (!canConfirm) return;
    onConfirm(updateRoleModelProposal(proposal, request, projectedEligibility));
  };

  return (
    <article
      className={`companion-action-card companion-action-card--change-role-model companion-action-card--${proposal.state}`}
      data-action-type="change-role-model"
      data-proposal-id={proposal.id}
      data-proposal-state={proposal.state}
      data-role-policy-form="trusted"
      data-request-exact={String(exactRequest)}
      data-request-eligible={String(projectedEligibility.eligible)}
      aria-labelledby={titleId}
    >
      <header className="companion-action-card__header">
        <div className="companion-action-card__heading">
          <span className="companion-action-card__eyebrow">Governed action · trusted form</span>
          <h3 id={titleId}>Change task agent model</h3>
        </div>
        <RolePolicyProposalState state={proposal.state} pending={pending} />
      </header>

      <p className="companion-action-card__summary">{proposal.summary}</p>
      <dl className="companion-action-card__scope">
        <div>
          <dt>Scope</dt>
          <dd>Task snapshot only</dd>
        </div>
        <div>
          <dt>Task identity</dt>
          <dd className="mono">{proposal.target.taskId}</dd>
        </div>
        <div>
          <dt>Current policy</dt>
          <dd className="mono" data-current-policy>
            {selectedRolePolicy
              ? `${selectedRolePolicy.model} · ${selectedRolePolicy.reasoning}`
              : "Not recorded"}
          </dd>
        </div>
        <div>
          <dt>Requested policy</dt>
          <dd className="mono" data-requested-policy>
            {requestLabel}
          </dd>
        </div>
        <div className="companion-action-card__scope-wide">
          <dt>Global settings</dt>
          <dd>Unchanged; historical run configuration is retained.</dd>
        </div>
      </dl>

      <form
        className="companion-role-policy-form"
        aria-label="Change task agent model form"
        onSubmit={(event) => {
          event.preventDefault();
          confirm();
        }}
      >
        <label>
          Known workflow role
          <select
            name="role"
            value={request.role}
            disabled={proposal.state !== "proposed" || anyPending}
            onChange={(event) => updateRole(event.target.value as AgentRoleId)}
          >
            {trustedRoleOptions.map((role) => (
              <option key={role.id} value={role.id}>
                {role.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Discovered, editable model
          <select
            name="model"
            value={request.model ?? ""}
            disabled={proposal.state !== "proposed" || anyPending || selectableModels.length === 0}
            onChange={(event) => updateModel(event.target.value)}
          >
            <option value="">Select a discovered model</option>
            {selectableModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label} · {model.id}
              </option>
            ))}
          </select>
        </label>
        <label>
          Supported reasoning
          <select
            name="reasoning"
            value={request.reasoning ?? ""}
            disabled={proposal.state !== "proposed" || anyPending || selectedModel === null}
            onChange={(event) => {
              setReasoningReset(null);
              setRequest((current) => ({ ...current, reasoning: event.target.value || null }));
            }}
          >
            <option value="">Select reasoning</option>
            {selectedReasoning.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </label>
        {reasoningReset ? (
          <p className="companion-role-policy-form__notice" role="status">
            {reasoningReset}
          </p>
        ) : null}
        {!selectableModels.length ? (
          <p className="companion-role-policy-form__notice" role="alert">
            No discovered, editable, Settings-allowed model is available for this form.
          </p>
        ) : null}
      </form>

      <RolePolicyEligibility eligibility={projectedEligibility} />
      {proposal.failure ? (
        <div className="companion-action-card__failure" role="alert">
          <XCircle aria-hidden size={15} weight="fill" />
          <span>
            <strong>Confirmation not executed.</strong> {proposal.failure.reason}
          </span>
        </div>
      ) : null}
      {localError ? (
        <div className="companion-action-card__failure" role="alert">
          <XCircle aria-hidden size={15} weight="fill" />
          <span>
            <strong>Confirmation not executed.</strong> {localError} The proposal remains reviewable.
          </span>
        </div>
      ) : null}

      {proposal.state === "proposed" ? (
        <footer className="companion-action-card__footer">
          <p className="companion-action-card__confirmation-note">
            <Info aria-hidden size={14} /> Explicit confirmation is required; the server revalidates task
            identity, authority, catalogue, and lifecycle.
          </p>
          <div className="companion-action-card__actions">
            <button
              type="button"
              className="button button--ghost button--compact"
              onClick={onDismiss}
              disabled={anyPending}
            >
              <X aria-hidden size={15} weight="bold" />
              Dismiss
            </button>
            <button
              type="button"
              className="button button--primary button--compact"
              onClick={confirm}
              disabled={!canConfirm}
              title={confirmationTitle({
                trustedRequest,
                exactRequest,
                eligible: projectedEligibility.eligible,
              })}
            >
              {pending ? (
                <CircleNotch aria-hidden size={15} className="spin" />
              ) : (
                <CheckCircle aria-hidden size={15} />
              )}
              {pending ? "Confirming…" : "Confirm"}
            </button>
          </div>
        </footer>
      ) : null}
      {proposal.state === "confirmed" ? (
        <p
          className="companion-action-card__terminal companion-action-card__terminal--confirmed"
          role="status"
        >
          <WarningCircle aria-hidden size={15} weight="fill" /> Confirmed; waiting for the
          server-authoritative result.
        </p>
      ) : null}
      {proposal.state === "executed" ? (
        <p
          className="companion-action-card__terminal companion-action-card__terminal--executed"
          role="status"
        >
          <CheckCircle aria-hidden size={15} weight="fill" /> Executed after server confirmation.
        </p>
      ) : null}
      {proposal.state === "dismissed" ? (
        <p
          className="companion-action-card__terminal companion-action-card__terminal--dismissed"
          role="status"
        >
          <XCircle aria-hidden size={15} weight="fill" /> Dismissed
          {proposal.dismissedReason ? ` — ${proposal.dismissedReason}` : ""}
        </p>
      ) : null}
    </article>
  );
}

function RolePolicyEligibility({
  eligibility,
}: {
  eligibility: RolePolicyActionCardProps["proposal"]["eligibility"];
}) {
  return (
    <section
      className={`companion-action-card__eligibility ${eligibility.eligible ? "is-eligible" : "is-ineligible"}`}
      data-role-policy-eligibility={eligibility.eligible ? "eligible" : "ineligible"}
    >
      <div className="companion-action-card__eligibility-title">
        {eligibility.eligible ? (
          <CheckCircle aria-hidden size={15} weight="fill" />
        ) : (
          <XCircle aria-hidden size={15} weight="fill" />
        )}
        <strong>{eligibility.eligible ? "Eligible to propose" : "Not eligible"}</strong>
      </div>
      <p>{eligibility.rationale}</p>
      {eligibility.evidence.length ? (
        <ul>
          {eligibility.evidence.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function RolePolicyProposalState({ state, pending }: { state: ActionProposal["state"]; pending: boolean }) {
  if (pending) {
    return (
      <span className="companion-proposal-state companion-proposal-state--pending">
        <CircleNotch aria-hidden size={13} className="spin" /> Confirming
      </span>
    );
  }
  const Icon =
    state === "executed"
      ? CheckCircle
      : state === "dismissed"
        ? XCircle
        : state === "proposed"
          ? CircleNotch
          : WarningCircle;
  return (
    <span className={`companion-proposal-state companion-proposal-state--${state}`}>
      <Icon aria-hidden size={13} weight={state === "proposed" ? "bold" : "fill"} />
      {state[0]?.toUpperCase() + state.slice(1)}
    </span>
  );
}

function confirmationTitle({
  trustedRequest,
  exactRequest,
  eligible,
}: {
  trustedRequest: boolean;
  exactRequest: boolean;
  eligible: boolean;
}) {
  if (!trustedRequest)
    return "Choose a known role, discovered editable model, and supported reasoning level.";
  if (!exactRequest) return "The requested policy must differ from the current policy.";
  if (!eligible) return "The current task lifecycle or repository state is not eligible.";
  return undefined;
}

function editedRequestEligibility() {
  return {
    eligible: false,
    rationale: "This edited request needs a fresh eligibility projection before confirmation.",
    evidence: [
      "The form selection differs from the proposal snapshot.",
      "Server revalidation remains authoritative.",
    ],
  };
}

function sameRequest(request: RolePolicyRequest, target: RoleModelProposal["target"]) {
  return (
    request.role === target.role && request.model === target.model && request.reasoning === target.reasoning
  );
}
