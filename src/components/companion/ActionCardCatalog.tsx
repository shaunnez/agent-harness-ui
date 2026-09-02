import { CheckCircle, CircleNotch, Info, WarningCircle, X, XCircle } from "@phosphor-icons/react";
import { useState } from "react";
import {
  createTrustedActionCard,
  type RolePolicyFormOptions,
  type RolePolicyFormOptionsSource,
  type TrustedActionCard,
} from "../../companion/catalog";
import type { ActionProposal, CompanionGateStage } from "../../companion/contracts";
import { type AgentRoleId, type NewTaskDraft, workflowStages } from "../../domain";
import { RolePolicyActionCard } from "./RolePolicyActionCard";

export type CompanionActionHandler = (proposal: ActionProposal) => void | Promise<void>;

export interface ActionCardCatalogProps {
  proposals: readonly ActionProposal[];
  onConfirmAction: CompanionActionHandler;
  onDismissAction: CompanionActionHandler;
  pendingProposalId?: string | null;
  rolePolicyOptions?: RolePolicyFormOptionsSource;
}

/**
 * Render proposals through the local catalogue only. The callbacks are
 * supplied by the application boundary and are never read from proposal data.
 */
export function ActionCardCatalog({
  proposals,
  onConfirmAction,
  onDismissAction,
  pendingProposalId = null,
  rolePolicyOptions,
}: ActionCardCatalogProps) {
  const [internalPendingId, setInternalPendingId] = useState<string | null>(null);
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const cards = proposals.flatMap((proposal) => {
    try {
      return [createTrustedActionCard(proposal)];
    } catch {
      return [];
    }
  });
  const rejectedCount = proposals.length - cards.length;

  if (!proposals.length) return null;

  const confirm = async (card: TrustedActionCard) => {
    const { proposal } = card;
    if (
      proposal.state !== "proposed" ||
      !proposal.eligibility.eligible ||
      (proposal.actionType === "create-task" && proposal.target.draft === null) ||
      pendingProposalId === proposal.id ||
      internalPendingId !== null
    ) {
      return;
    }

    setLocalErrors((current) => withoutKey(current, proposal.id));
    setInternalPendingId(proposal.id);
    try {
      await onConfirmAction(proposal);
    } catch (error) {
      setLocalErrors((current) => ({
        ...current,
        [proposal.id]: error instanceof Error ? error.message : "The confirmation could not be completed.",
      }));
    } finally {
      setInternalPendingId(null);
    }
  };

  const dismiss = async (card: TrustedActionCard) => {
    const { proposal } = card;
    if (proposal.state !== "proposed" || pendingProposalId === proposal.id || internalPendingId !== null) {
      return;
    }

    setLocalErrors((current) => withoutKey(current, proposal.id));
    setInternalPendingId(proposal.id);
    try {
      await onDismissAction(proposal);
    } catch (error) {
      setLocalErrors((current) => ({
        ...current,
        [proposal.id]: error instanceof Error ? error.message : "The proposal could not be dismissed.",
      }));
    } finally {
      setInternalPendingId(null);
    }
  };

  return (
    <section className="companion-action-catalog" aria-label="Governed action proposals">
      {rejectedCount ? (
        <div className="companion-catalog-warning" role="alert">
          <WarningCircle aria-hidden size={16} weight="fill" />
          {rejectedCount === 1
            ? "One action proposal was rejected because it is not in the trusted catalogue."
            : `${rejectedCount} action proposals were rejected because they are not in the trusted catalogue.`}
        </div>
      ) : null}
      <div className="companion-action-catalog__list">
        {cards.map((card) => (
          <ActionCard
            key={card.proposal.id}
            card={card}
            pending={pendingProposalId === card.proposal.id || internalPendingId === card.proposal.id}
            anyPending={pendingProposalId !== null || internalPendingId !== null}
            localError={localErrors[card.proposal.id]}
            onConfirm={(nextProposal) =>
              void confirm(nextProposal ? createTrustedActionCard(nextProposal) : card)
            }
            onDismiss={() => void dismiss(card)}
            rolePolicyOptions={rolePolicyOptionsForCard(card, rolePolicyOptions)}
          />
        ))}
      </div>
    </section>
  );
}

function ActionCard({
  card,
  pending,
  anyPending,
  localError,
  onConfirm,
  onDismiss,
  rolePolicyOptions,
}: {
  card: TrustedActionCard;
  pending: boolean;
  anyPending: boolean;
  localError?: string;
  onConfirm: (proposal?: ActionProposal) => void;
  onDismiss: () => void;
  rolePolicyOptions?: RolePolicyFormOptions;
}) {
  const { proposal } = card;
  if (proposal.actionType === "change-role-model") {
    return (
      <RolePolicyActionCard
        {...(rolePolicyOptions ?? { models: [], allowedModels: [] })}
        proposal={proposal}
        pending={pending}
        anyPending={anyPending}
        localError={localError}
        onConfirm={onConfirm}
        onDismiss={onDismiss}
      />
    );
  }
  const titleId = `companion-action-${proposal.id}-title`;
  const canConfirm =
    proposal.state === "proposed" &&
    proposal.eligibility.eligible &&
    !(proposal.actionType === "create-task" && proposal.target.draft === null);

  return (
    <article
      className={`companion-action-card companion-action-card--${proposal.actionType} companion-action-card--${proposal.state}`}
      data-action-type={proposal.actionType}
      data-proposal-id={proposal.id}
      data-proposal-state={proposal.state}
      aria-labelledby={titleId}
    >
      <header className="companion-action-card__header">
        <div className="companion-action-card__heading">
          <span className="companion-action-card__eyebrow">Governed action</span>
          <h3 id={titleId}>{actionTitle(proposal.actionType)}</h3>
        </div>
        <ProposalState state={proposal.state} pending={pending} />
      </header>

      <p className="companion-action-card__summary">{proposal.summary}</p>
      <ActionScope proposal={proposal} />

      <section
        className={`companion-action-card__eligibility ${proposal.eligibility.eligible ? "is-eligible" : "is-ineligible"}`}
      >
        <div className="companion-action-card__eligibility-title">
          {proposal.eligibility.eligible ? (
            <CheckCircle aria-hidden size={15} weight="fill" />
          ) : (
            <XCircle aria-hidden size={15} weight="fill" />
          )}
          <strong>{proposal.eligibility.eligible ? "Eligible to propose" : "Not eligible"}</strong>
        </div>
        <p>{proposal.eligibility.rationale}</p>
        {proposal.eligibility.evidence.length ? (
          <ul>
            {proposal.eligibility.evidence.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : null}
      </section>

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
            <Info aria-hidden size={14} /> Explicit confirmation is required before this mutation is sent.
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
              onClick={() => onConfirm()}
              disabled={!canConfirm || anyPending}
              title={
                !proposal.eligibility.eligible
                  ? "The server must resolve eligibility before this action can be confirmed."
                  : proposal.actionType === "create-task" && proposal.target.draft === null
                    ? "A validated task draft is required before confirmation."
                    : undefined
              }
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
          <CheckCircle aria-hidden size={15} weight="fill" /> Confirmed; waiting for the server-authoritative
          result.
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

function rolePolicyOptionsForCard(
  card: TrustedActionCard,
  source?: RolePolicyFormOptionsSource,
): RolePolicyFormOptions | undefined {
  if (card.proposal.actionType !== "change-role-model") {
    return typeof source === "function" ? undefined : source;
  }
  if (typeof source !== "function") return source;
  return source(card.proposal);
}

function ActionScope({ proposal }: { proposal: ActionProposal }) {
  if (proposal.actionType === "create-task") {
    const draft = proposal.target.draft;
    return (
      <>
        <dl className="companion-action-card__scope">
          <div>
            <dt>Scope</dt>
            <dd>New task</dd>
          </div>
          <div>
            <dt>Captured proposal draft</dt>
            <dd>{draft ? "Ready for separate confirmation" : "Capture is required before confirmation"}</dd>
          </div>
          {draft ? (
            <>
              <div>
                <dt>Title</dt>
                <dd>{draft.title}</dd>
              </div>
              <div>
                <dt>Repository</dt>
                <dd className="mono">{draft.repositoryPath}</dd>
              </div>
              <div>
                <dt>Workflow / priority</dt>
                <dd>
                  {draft.workflow} / {draft.priority}
                </dd>
              </div>
              <div>
                <dt>Workflow profile</dt>
                <dd>{draft.workflowProfile === undefined ? "Not specified" : draft.workflowProfile}</dd>
              </div>
              <div>
                <dt>Design prototypes</dt>
                <dd>
                  {draft.designRequested === undefined
                    ? "Not specified"
                    : draft.designRequested
                      ? "Requested"
                      : "Not requested"}
                </dd>
              </div>
              {draft.designRequested && draft.designPolicies ? (
                <>
                  <div>
                    <dt>Claude Design</dt>
                    <dd className="mono">
                      {draft.designPolicies["claude-design"].model} ·{" "}
                      {draft.designPolicies["claude-design"].reasoning}
                    </dd>
                  </div>
                  <div>
                    <dt>Codex Design</dt>
                    <dd className="mono">
                      {draft.designPolicies["codex-design"].model} ·{" "}
                      {draft.designPolicies["codex-design"].reasoning}
                    </dd>
                  </div>
                </>
              ) : null}
              <div>
                <dt>Model</dt>
                <dd className="mono">{draft.model ?? "Not specified"}</dd>
              </div>
              <div>
                <dt>Reasoning</dt>
                <dd>{draft.reasoning ?? "Not specified"}</dd>
              </div>
              <div className="companion-action-card__scope-wide">
                <dt>Description</dt>
                <dd>{draft.description}</dd>
              </div>
              <DraftExperimentScope experiment={draft.experiment} />
              <DraftAttachmentsScope attachments={draft.attachments} />
            </>
          ) : null}
        </dl>
        {draft ? (
          <p className="companion-action-card__capture-note">
            Capture only attaches this draft to the proposal. A separate confirmation creates the task.
          </p>
        ) : (
          <p className="companion-action-card__capture-note">
            Capture only attaches a draft to this proposal; no task is created until you confirm the exact
            draft.
          </p>
        )}
      </>
    );
  }

  if (proposal.actionType === "change-role-model") {
    const { target } = proposal;
    return (
      <dl className="companion-action-card__scope">
        <div>
          <dt>Scope</dt>
          <dd>Task snapshot only</dd>
        </div>
        <div>
          <dt>Task</dt>
          <dd className="mono">{target.taskId}</dd>
        </div>
        <div>
          <dt>Agent role</dt>
          <dd>{roleLabel(target.role)}</dd>
        </div>
        <div>
          <dt>Model</dt>
          <dd className="mono">{target.model ?? "No model specified"}</dd>
        </div>
        <div>
          <dt>Reasoning</dt>
          <dd>{target.reasoning ?? "No reasoning policy specified"}</dd>
        </div>
        <div className="companion-action-card__scope-wide">
          <dt>Global settings</dt>
          <dd>Unchanged; historical run configuration is retained.</dd>
        </div>
      </dl>
    );
  }

  const { target } = proposal;
  return (
    <dl className="companion-action-card__scope">
      <div>
        <dt>Scope</dt>
        <dd>Exact candidate revision</dd>
      </div>
      <div>
        <dt>Task</dt>
        <dd className="mono">{target.taskId}</dd>
      </div>
      <div>
        <dt>Candidate</dt>
        <dd className="mono">
          {target.candidateId} · r{target.candidateRevision}
        </dd>
      </div>
      <div>
        <dt>Next gate</dt>
        <dd>{gateLabel(target.nextStage)}</dd>
      </div>
    </dl>
  );
}

function DraftExperimentScope({ experiment }: { experiment: NewTaskDraft["experiment"] }) {
  return (
    <div className="companion-action-card__scope-wide">
      <dt>Experiment</dt>
      <dd>
        {experiment === undefined ? (
          "Not specified"
        ) : experiment === null ? (
          "None"
        ) : (
          <ul>
            <li>Group: {experiment.groupId}</li>
            <li>Variant: {experiment.variantId}</li>
            <li>Frozen base: {experiment.frozenBaseSha}</li>
            <li>Acceptance criteria: {experiment.acceptanceCriteria.join(" · ")}</li>
            <li>Verification commands: {experiment.verificationCommands.join(" · ")}</li>
          </ul>
        )}
      </dd>
    </div>
  );
}

function DraftAttachmentsScope({ attachments }: { attachments: NewTaskDraft["attachments"] }) {
  return (
    <div className="companion-action-card__scope-wide">
      <dt>Attachment selections</dt>
      <dd>
        {attachments === undefined ? (
          "Not specified"
        ) : attachments.length === 0 ? (
          "None"
        ) : (
          <ul>
            {attachments.map((attachment) => (
              <li key={`${attachment.name}-${attachment.size}-${attachment.data.slice(0, 16)}`}>
                {attachment.name} · {attachment.type} · {attachment.size} bytes ·{" "}
                {attachment.data ? `${attachment.data.length} encoded characters captured` : "empty content"}
              </li>
            ))}
          </ul>
        )}
      </dd>
    </div>
  );
}

function ProposalState({ state, pending }: { state: ActionProposal["state"]; pending: boolean }) {
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

function actionTitle(actionType: ActionProposal["actionType"]) {
  if (actionType === "create-task") return "Create a new task";
  if (actionType === "change-role-model") return "Change task agent model";
  return "Promote task through gate";
}

function roleLabel(role: AgentRoleId) {
  const stage = workflowStages.find((item) => item.id === role);
  if (stage) return stage.label;
  return role
    .split("-")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function gateLabel(stage: CompanionGateStage) {
  return workflowStages.find((item) => item.id === stage)?.label ?? stage;
}

function withoutKey(values: Record<string, string>, key: string) {
  const next = { ...values };
  delete next[key];
  return next;
}
