import { ArrowRight, Play, ShieldCheck } from "@phosphor-icons/react";
import type { KeyboardEvent } from "react";
import { useEffect, useRef, useState } from "react";
import type { RuntimeAvailableAction } from "../../domain";
import type { CandidateScope, FrontierGateway, TaskCore } from "../runtime/contracts";
import { attentionFor, splitRecordedDetail, stageLabels } from "../runtime/presentation";
import { candidateScope, executable, proposedAction, reviewIdentity } from "../runtime/workflow";
import { ScrollArea } from "../ui/ScrollArea";

interface Review {
  action: RuntimeAvailableAction;
  title: string;
  detail: string;
  identity: string;
  scope?: CandidateScope;
}

const candidateBoundActions: RuntimeAvailableAction[] = [
  "review",
  "test",
  "final-review",
  "open-pr",
  "approve-merge",
  "repair",
  "retry-test",
];

export function WorkflowCommand({
  task,
  gateway,
  busy,
  connected,
  command,
  onGrill,
  onContinue,
}: {
  task: TaskCore;
  gateway: FrontierGateway;
  busy: boolean;
  connected: boolean;
  command(action: () => Promise<unknown>, then?: () => void): Promise<void>;
  onGrill(): void;
  onContinue(id: string): void;
}) {
  const [review, setReview] = useState<Review | null>(null);
  const [menu, setMenu] = useState<Review | null>(null);
  const [note, setNote] = useState("");
  const [feedback, setFeedback] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const menuItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const next = proposedAction(task);
  const attention = attentionFor(task);
  const candidate = task.candidates.at(-1);
  const options = [
    {
      action: "plan" as const,
      title: "Revise plan",
      detail:
        "A concrete correction must be recorded after the latest plan. This starts a new read-only planning attempt.",
    },
    {
      action: "grant-retry" as const,
      title: "Grant one attempt",
      detail: "Authorize one additional attempt for the current stage, retaining all earlier evidence.",
    },
    {
      action: "repair" as const,
      title: "Return to Implement",
      detail:
        "Repair the retained candidate. A new revision invalidates downstream reviews and tests, which must run again.",
    },
    {
      action: "retry-test" as const,
      title: "Retry test on same candidate",
      detail: "Repeat the repository verification manifest against the unchanged candidate revision.",
    },
  ].filter(
    (entry) =>
      entry.action !== next?.action &&
      executable(task, entry.action) &&
      (entry.action !== "plan" || task.status === "awaiting-plan-approval"),
  );
  const reviewFor = (action: RuntimeAvailableAction, title: string, detail: string): Review => ({
    action,
    title,
    detail,
    identity: reviewIdentity(task),
    scope: candidateScope(candidate),
  });
  const canDispatch = (actionReview: Review) =>
    !busy &&
    connected &&
    actionReview.identity === reviewIdentity(task) &&
    executable(task, actionReview.action) &&
    (!candidateBoundActions.includes(actionReview.action) || Boolean(actionReview.scope));
  const closeMenu = (restoreFocus: boolean) => {
    const trigger = menuTriggerRef.current;
    setMenu(null);
    menuTriggerRef.current = null;
    if (restoreFocus) trigger?.focus();
  };
  const openMenu = (actionReview: Review, trigger: HTMLButtonElement) => {
    if (busy || !connected || !executable(task, actionReview.action)) return;
    menuTriggerRef.current = trigger;
    setReview(null);
    setNote("");
    setFeedback(false);
    setMenu(actionReview);
  };
  const dispatchAction = (actionReview: Review, actionNote: string, then?: () => void) => {
    if (!canDispatch(actionReview)) return;
    void command(
      () =>
        gateway.action(
          task.id,
          actionReview.action as Exclude<RuntimeAvailableAction, "continue-implementation">,
          actionNote,
          actionReview.scope,
        ),
      then,
    );
  };
  const chooseMenuOption = (withReason: boolean) => {
    if (!menu) return;
    const actionReview = menu;
    if (!canDispatch(actionReview)) {
      closeMenu(true);
      return;
    }
    if (withReason) {
      menuTriggerRef.current = null;
      setMenu(null);
      setReview(actionReview);
      setNote("");
      setFeedback(false);
      return;
    }
    closeMenu(true);
    dispatchAction(actionReview, "");
  };
  const propose = (
    action: RuntimeAvailableAction,
    title: string,
    detail: string,
    trigger: HTMLButtonElement,
  ) => {
    openMenu(reviewFor(action, title, detail), trigger);
  };
  const triggerKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    action: RuntimeAvailableAction,
    title: string,
    detail: string,
  ) => {
    if (!["ArrowDown", "Enter", " "].includes(event.key)) return;
    event.preventDefault();
    propose(action, title, detail, event.currentTarget);
  };
  const stale = review && review.identity !== reviewIdentity(task);
  const bound = review && candidateBoundActions.includes(review.action);
  async function confirm() {
    if (!review || stale || !canDispatch(review)) return;
    dispatchAction(review, note, () => setReview(null));
  }
  useEffect(() => {
    if (!review) return;
    noteRef.current?.focus();
    noteRef.current?.scrollIntoView({ block: "nearest" });
  }, [review]);
  useEffect(() => {
    if (menu) menuItemRefs.current[0]?.focus();
  }, [menu]);
  const menuKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!menu) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu(true);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      chooseMenuOption(index === 1);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + 2) % 2;
    menuItemRefs.current[nextIndex]?.focus();
  };
  return (
    <section className={`workflow-command tone-${attention.kind}`} aria-label="Current task actions">
      <div className="workflow-command-row">
        <span>
          <small>
            {task.id} · {stageLabels[task.currentStage]} · Next: {attention.nextActor ?? "No action"}
          </small>
          <strong>{attention.label}</strong>
        </span>
        {(task.status === "queued" ||
          (task.status === "failed" &&
            !["specification", "plan", "implement", "dev-review", "test", "final-review"].includes(
              task.currentStage,
            ))) && (
          <button
            type="button"
            className="primary"
            disabled={busy || !connected || gateway.mode === "fixture" || !executable(task, "run")}
            onClick={() => void command(() => gateway.start(task.id))}
          >
            <Play size={17} />
            {task.status === "failed" ? "Retry stage" : "Start task"}
          </button>
        )}
        {task.status === "awaiting-grill" && (
          <button type="button" className="primary" onClick={onGrill}>
            Answer questions <ArrowRight size={17} />
          </button>
        )}
        {next?.action && (
          <button
            type="button"
            className="primary"
            disabled={busy || !connected || !executable(task, next.action)}
            title={task.actionEligibility?.actions[next.action]?.reason ?? ""}
            aria-haspopup={next.action === "continue-implementation" ? undefined : "menu"}
            aria-expanded={
              next.action === "continue-implementation" ? undefined : menu?.action === next.action
            }
            aria-controls={
              next.action === "continue-implementation" ? undefined : `workflow-action-menu-${task.id}`
            }
            onKeyDown={
              next.action === "continue-implementation"
                ? undefined
                : (event) =>
                    triggerKeyDown(event, next.action as RuntimeAvailableAction, next.label, next.detail)
            }
            onClick={(event) => {
              if (next.action === "continue-implementation") {
                let id: string | null = null;
                void command(
                  async () => {
                    id = (await gateway.continueImplementation(task.id)).task.id;
                  },
                  () => {
                    if (id) onContinue(id);
                  },
                );
              } else
                propose(next.action as RuntimeAvailableAction, next.label, next.detail, event.currentTarget);
            }}
          >
            {next.label}
            <ArrowRight size={17} />
          </button>
        )}
      </div>
      {menu && (
        <div
          id={`workflow-action-menu-${task.id}`}
          className="action-menu"
          role="menu"
          style={{
            display: "grid",
            gap: "4px",
            margin: "8px 0 0 auto",
            padding: "6px",
            width: "min(280px, 100%)",
            background: "#0d2531",
            border: "1px solid #5c8197",
            borderRadius: "6px",
          }}
          aria-label={`${menu.title} options`}
        >
          {["Proceed", "Proceed with reason"].map((label, index) => (
            <button
              type="button"
              key={label}
              role="menuitem"
              ref={(element) => {
                menuItemRefs.current[index] = element;
              }}
              style={{ width: "100%", justifyContent: "flex-start", minHeight: "36px" }}
              tabIndex={index === 0 ? 0 : -1}
              onKeyDown={(event) => menuKeyDown(event, index)}
              onClick={() => chooseMenuOption(index === 1)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {(attention.reason || next?.detail) &&
        (() => {
          const { headline, body } = splitRecordedDetail(attention.reason ?? next?.detail);
          return (
            <>
              <p>{headline}</p>
              {body && (
                <ScrollArea className="recorded-detail-output" label={`${task.id} recorded detail`}>
                  <pre>{body}</pre>
                </ScrollArea>
              )}
            </>
          );
        })()}
      {next?.action && !executable(task, next.action) && (
        <p className="quiet">
          {task.actionEligibility?.actions[next.action]?.reason ??
            "Current execution eligibility is unavailable. Refresh before continuing."}
        </p>
      )}
      <div className="workflow-secondary-actions">
        {options.map((entry) => (
          <button
            type="button"
            key={entry.action}
            disabled={busy || !connected}
            aria-haspopup="menu"
            aria-expanded={menu?.action === entry.action}
            aria-controls={`workflow-action-menu-${task.id}`}
            onKeyDown={(event) => triggerKeyDown(event, entry.action, entry.title, entry.detail)}
            onClick={(event) => propose(entry.action, entry.title, entry.detail, event.currentTarget)}
          >
            {entry.title}
          </button>
        ))}
        {["awaiting-spec-approval", "awaiting-plan-approval"].includes(task.status) && (
          <button
            type="button"
            onClick={() => {
              setFeedback(!feedback);
              setMenu(null);
              menuTriggerRef.current = null;
              setReview(null);
              setRecorded(false);
            }}
          >
            Record requested changes
          </button>
        )}
      </div>
      {feedback && (
        <div className="action-review">
          <label>
            Requested changes
            <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} />
          </label>
          <p>
            Feedback is retained as an operator decision. Use an eligible revision action to regenerate the
            document.
          </p>
          <button
            type="button"
            disabled={busy || !connected || !note.trim() || recorded}
            onClick={() =>
              void command(
                () => gateway.decision(task.id, `Requested changes to ${task.currentStage}`, note),
                () => setRecorded(true),
              )
            }
          >
            {recorded ? "Feedback recorded" : "Record feedback"}
          </button>
        </div>
      )}
      {review && (
        <section className="action-review" aria-label="Review workflow action">
          <h3>
            <ShieldCheck size={19} /> {review.title}
          </h3>
          <p>{review.detail}</p>
          <dl>
            <dt>Task</dt>
            <dd>
              {task.id} · {task.title}
            </dd>
            <dt>Stage</dt>
            <dd>{task.currentStage}</dd>
            <dt>Repository</dt>
            <dd>{task.repositoryPath}</dd>
            {review.scope && (
              <>
                <dt>Candidate</dt>
                <dd>
                  {review.scope.candidateId} r{review.scope.candidateRevision}
                  <br />
                  <code>{review.scope.candidateHeadRevision}</code>
                </dd>
                <dt>Target</dt>
                <dd>{candidate?.baseBranch}</dd>
              </>
            )}
          </dl>
          <label>
            Operator note
            <textarea ref={noteRef} value={note} rows={2} onChange={(event) => setNote(event.target.value)} />
          </label>
          {stale && (
            <p role="alert">Task or candidate changed. Return to review the new state before continuing.</p>
          )}
          <div className="review-actions">
            <button type="button" onClick={() => setReview(null)}>
              Back to task
            </button>
            <button
              type="button"
              className="primary"
              disabled={
                busy ||
                !connected ||
                Boolean(stale) ||
                Boolean(bound && !review.scope) ||
                !executable(task, review.action)
              }
              onClick={() => void confirm()}
            >
              {busy
                ? "Saving…"
                : review.action === "open-pr"
                  ? "Confirm approval & raise PR"
                  : `Confirm ${review.title.toLowerCase()}`}
            </button>
          </div>
        </section>
      )}
    </section>
  );
}
