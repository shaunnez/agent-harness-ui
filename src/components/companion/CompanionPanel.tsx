import { ChatCircleDots, Compass, X } from "@phosphor-icons/react";
import { type ReactNode, type Ref, useEffect, useId, useRef, useState } from "react";
import type { RolePolicyFormOptionsSource } from "../../companion/catalog";
import { contextualAnswer } from "../../companion/context";
import type { ActionProposal, CompanionContext, CompanionIntent } from "../../companion/contracts";
import { companionIntentExamples, parseCompanionIntent } from "../../companion/intentParser";
import { workflowStages } from "../../domain";
import { ActionCardCatalog, type CompanionActionHandler } from "./ActionCardCatalog";
import { CompanionComposer } from "./CompanionComposer";
import "./companion.css";

export interface CompanionMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt?: string;
}

export interface CompanionPanelProps {
  context: CompanionContext;
  messages?: readonly CompanionMessage[];
  proposals?: readonly ActionProposal[];
  onIntent?: (intent: CompanionIntent) => void | Promise<void>;
  onSubmitText?: (value: string) => void | Promise<void>;
  onConfirmAction: CompanionActionHandler;
  onDismissAction: CompanionActionHandler;
  pendingProposalId?: string | null;
  isSubmitting?: boolean;
  className?: string;
  draft?: string;
  onDraftChange?: (value: string) => void;
  composerRef?: Ref<HTMLTextAreaElement>;
  onClose?: () => void;
  rolePolicyOptions?: RolePolicyFormOptionsSource;
}

/**
 * Evidence-first companion presentation. This component can parse the small
 * local intent vocabulary for a standalone preview, while an integrated parent
 * may take ownership through onSubmitText or onIntent.
 */
export function CompanionPanel({
  context,
  messages,
  proposals = [],
  onIntent,
  onSubmitText,
  onConfirmAction,
  onDismissAction,
  pendingProposalId = null,
  isSubmitting = false,
  className = "",
  draft,
  onDraftChange,
  composerRef: externalComposerRef,
  onClose,
  rolePolicyOptions,
}: CompanionPanelProps) {
  const panelId = useId();
  const internalComposerRef = useRef<HTMLTextAreaElement>(null);
  const localMessageNumber = useRef(0);
  const [localMessages, setLocalMessages] = useState<CompanionMessage[]>(() => [welcomeMessage(context)]);
  const [announcement, setAnnouncement] = useState("Contextual companion ready.");
  const isControlledThread = messages !== undefined;
  const thread = messages ?? localMessages;

  useEffect(() => {
    if (isControlledThread) return;
    const nextWelcome = welcomeMessage(context);
    setLocalMessages((current) =>
      current.length === 1 &&
      current[0]?.id === "companion-welcome" &&
      current[0].content !== nextWelcome.content
        ? [nextWelcome]
        : current,
    );
  }, [context, isControlledThread]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!isCompanionFocusShortcut(event)) return;
      event.preventDefault();
      internalComposerRef.current?.focus();
      setAnnouncement("Companion composer focused.");
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  useEffect(() => {
    const latest = proposals.at(-1);
    if (!latest) return;
    if (latest.state === "executed") {
      setAnnouncement(`Action executed: ${latest.summary}`);
    } else if (latest.failure) {
      setAnnouncement(`Action confirmation failed: ${latest.failure.reason}`);
    } else if (latest.state === "dismissed") {
      setAnnouncement(`Action dismissed: ${latest.summary}`);
    }
  }, [proposals]);

  const appendLocalMessage = (message: Omit<CompanionMessage, "id">) => {
    if (isControlledThread) return;
    localMessageNumber.current += 1;
    setLocalMessages((current) => [
      ...current,
      { ...message, id: `companion-message-${localMessageNumber.current}` },
    ]);
  };

  const submit = async (value: string) => {
    appendLocalMessage({ role: "user", content: value });
    if (onSubmitText) {
      await onSubmitText(value);
      onDraftChange?.("");
      setAnnouncement("Message sent to the contextual companion.");
      return;
    }

    const parsed = parseCompanionIntent(value);
    if (parsed.status === "rejected") {
      appendLocalMessage({
        role: "assistant",
        content: `${parsed.message}\n\nTry one of these:\n${parsed.examples.join("\n")}`,
      });
      setAnnouncement(parsed.message);
      return;
    }

    const intent = parsed.intent;
    try {
      await onIntent?.(intent);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "The request could not be prepared.";
      appendLocalMessage({ role: "assistant", content: `I could not prepare that request. ${reason}` });
      setAnnouncement(`Request failed: ${reason}`);
      return;
    }

    if (intent.kind === "context") {
      appendLocalMessage({ role: "assistant", content: contextualAnswer(context) });
      onDraftChange?.("");
      setAnnouncement("Current route and workflow context described.");
      return;
    }
    if (intent.kind === "navigate") {
      appendLocalMessage({ role: "assistant", content: navigationAnswer(intent) });
      onDraftChange?.("");
      setAnnouncement(navigationAnswer(intent));
      return;
    }

    const actionLabel =
      intent.kind === "create-task"
        ? "create a new task"
        : intent.kind === "change-role-model"
          ? "change a task-scoped agent model"
          : `promote this task to ${stageLabel(intent.nextStage)}`;
    appendLocalMessage({
      role: "assistant",
      content: `I can ${actionLabel}. Review the governed action card below; no mutation is sent until you confirm it.`,
    });
    onDraftChange?.("");
    setAnnouncement(`Governed proposal requested to ${actionLabel}.`);
  };

  return (
    <section
      className={`companion-panel ${className}`.trim()}
      aria-labelledby={`${panelId}-title`}
      aria-keyshortcuts="Control+K Meta+K"
    >
      <div className="companion-panel__scroll" data-scroll-owner="companion">
        <header className="companion-panel__header">
          <div className="companion-panel__title">
            <span className="companion-panel__mark" aria-hidden>
              <ChatCircleDots size={18} weight="fill" />
            </span>
            <div>
              <p className="companion-panel__eyebrow">Evidence Gate companion</p>
              <h2 id={`${panelId}-title`}>Contextual assistant</h2>
            </div>
          </div>
          <div className="companion-panel__header-actions">
            <span className="companion-panel__mode">
              <i aria-hidden /> Local · governed
            </span>
            {onClose ? (
              <button type="button" className="icon-button" onClick={onClose} aria-label="Close companion">
                <X size={17} />
              </button>
            ) : null}
          </div>
        </header>

        <ContextRibbon context={context} />

        <div className="companion-thread-wrap">
          <ol className="companion-thread" role="log" aria-label="Companion conversation" aria-live="polite">
            {thread.map((message) => (
              <li className={`companion-message companion-message--${message.role}`} key={message.id}>
                <div className="companion-message__meta">
                  <span>{messageRoleLabel(message.role)}</span>
                  {message.createdAt ? <time>{message.createdAt}</time> : null}
                </div>
                <p>{message.content}</p>
              </li>
            ))}
            <li className="companion-thread__cards">
              <ActionCardCatalog
                proposals={proposals}
                onConfirmAction={onConfirmAction}
                onDismissAction={onDismissAction}
                pendingProposalId={pendingProposalId}
                rolePolicyOptions={rolePolicyOptions}
              />
            </li>
          </ol>

          <fieldset className="companion-intent-chips" aria-label="Suggested companion requests">
            <legend className="companion-intent-chips__label">Try asking</legend>
            <div>
              {companionIntentExamples.map((example) => (
                <button
                  type="button"
                  className="companion-intent-chip"
                  key={example}
                  onClick={() => void submit(example)}
                  disabled={isSubmitting}
                >
                  {example}
                </button>
              ))}
            </div>
          </fieldset>
        </div>

        <p className="companion-live-announcement" role="status" aria-live="polite" aria-atomic="true">
          {announcement}
        </p>
        <CompanionComposer
          onSubmit={submit}
          isSubmitting={isSubmitting}
          textareaRef={composeRefs(internalComposerRef, externalComposerRef)}
          value={draft}
          onChange={onDraftChange}
        />
      </div>
    </section>
  );
}

function composeRefs<T>(internal: { current: T | null }, external?: Ref<T>): Ref<T> {
  return (value) => {
    internal.current = value;
    if (typeof external === "function") external(value);
    else if (external) external.current = value;
  };
}

export function isCompanionFocusShortcut(event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey">) {
  return event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey);
}

export function ContextRibbon({ context }: { context: CompanionContext }) {
  const viewed = describeViewedStage(context);
  return (
    <section className="companion-context-ribbon" aria-label="Current workflow context">
      <ContextFact
        label="Route"
        value={context.route}
        detail="Current page"
        icon={<Compass aria-hidden size={15} />}
      />
      <ContextFact
        label="Selected task"
        value={context.taskId ?? "No task selected"}
        detail={context.taskId ? "Task identity" : "Open a task to govern actions"}
      />
      <ContextFact
        label="Runtime"
        value={stageLabel(context.activeStage)}
        detail="Active stage"
        tone="active"
      />
      <ContextFact label="Inspector" value={viewed.value} detail={viewed.detail} tone={viewed.tone} />
      <ContextFact
        label="Candidate"
        value={
          context.candidateId && context.candidateRevision !== undefined
            ? `${context.candidateId} · r${context.candidateRevision}`
            : "No candidate recorded"
        }
        detail="Exact revision"
      />
    </section>
  );
}

function ContextFact({
  label,
  value,
  detail,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail: string;
  icon?: ReactNode;
  tone?: "neutral" | "active" | "stale" | "future";
}) {
  return (
    <div className={`companion-context-fact companion-context-fact--${tone}`}>
      <div className="companion-context-fact__label">
        {icon}
        <span>{label}</span>
      </div>
      <strong title={value}>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function welcomeMessage(context: CompanionContext): CompanionMessage {
  return {
    id: "companion-welcome",
    role: "assistant",
    content: `I’m grounded in the visible Evidence Gate context.\n\n${contextualAnswer(context)}`,
  };
}

function messageRoleLabel(role: CompanionMessage["role"]) {
  if (role === "user") return "You";
  if (role === "system") return "Workflow";
  return "Agent Harness";
}

function navigationAnswer(intent: Extract<CompanionIntent, { kind: "navigate" }>) {
  return intent.target === "tasks"
    ? "Opening Tasks. Navigation is read-only and does not require confirmation."
    : `Opening task ${intent.taskId}. Navigation is read-only and does not require confirmation.`;
}

function stageLabel(stageId: CompanionContext["activeStage"] | string) {
  return stageId
    ? (workflowStages.find((stage) => stage.id === stageId)?.label ?? stageId)
    : "No active stage";
}

function describeViewedStage(context: CompanionContext): {
  value: string;
  detail: string;
  tone: "neutral" | "active" | "stale" | "future";
} {
  if (!context.viewedStage) return { value: "No stage selected", detail: "Inspector idle", tone: "neutral" };
  if (context.viewedStage === context.activeStage) {
    return { value: stageLabel(context.viewedStage), detail: "Current runtime stage", tone: "active" };
  }

  const activeIndex = context.activeStage
    ? workflowStages.findIndex((stage) => stage.id === context.activeStage)
    : -1;
  const viewedIndex = workflowStages.findIndex((stage) => stage.id === context.viewedStage);
  const stale = activeIndex >= 0 && viewedIndex >= 0 && viewedIndex < activeIndex;
  return {
    value: stageLabel(context.viewedStage),
    detail: stale
      ? `Stale inspection · runtime remains ${stageLabel(context.activeStage)}`
      : "Future inspection · not runtime state",
    tone: stale ? "stale" : "future",
  };
}
