import { ArrowRight, Play, ShieldCheck } from "@phosphor-icons/react";
import { useState } from "react";
import type { RuntimeAvailableAction } from "../../domain";
import type { CandidateScope, FrontierGateway, TaskCore } from "../runtime/contracts";
import { attentionFor, stageLabels, splitRecordedDetail } from "../runtime/presentation";
import { ScrollArea } from "../ui/ScrollArea";
import { candidateScope, executable, proposedAction, reviewIdentity } from "../runtime/workflow";

interface Review {
  action: RuntimeAvailableAction;
  title: string;
  detail: string;
  identity: string;
  scope?: CandidateScope;
}
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
  const [note, setNote] = useState("");
  const [feedback, setFeedback] = useState(false);
  const [recorded, setRecorded] = useState(false);
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
  const propose = (action: RuntimeAvailableAction, title: string, detail: string) => {
    setReview({ action, title, detail, identity: reviewIdentity(task), scope: candidateScope(candidate) });
    setNote("");
    setFeedback(false);
  };
  const stale = review && review.identity !== reviewIdentity(task);
  const bound =
    review &&
    ["review", "test", "final-review", "open-pr", "approve-merge", "repair", "retry-test"].includes(
      review.action,
    );
  async function confirm() {
    if (!review || stale || (bound && !review.scope) || !executable(task, review.action)) return;
    if (review.action === "continue-implementation") {
      let id: string | null = null;
      await command(
        async () => {
          id = (await gateway.continueImplementation(task.id)).task.id;
        },
        () => {
          setReview(null);
          if (id) onContinue(id);
        },
      );
    } else
      await command(
        () =>
          gateway.action(
            task.id,
            review.action as Exclude<RuntimeAvailableAction, "continue-implementation">,
            note,
            review.scope,
          ),
        () => setReview(null),
      );
  }
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
            onClick={() => propose(next.action as RuntimeAvailableAction, next.label, next.detail)}
          >
            {next.label}
            <ArrowRight size={17} />
          </button>
        )}
      </div>
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
            onClick={() => propose(entry.action, entry.title, entry.detail)}
          >
            {entry.title}
          </button>
        ))}
        {["awaiting-spec-approval", "awaiting-plan-approval"].includes(task.status) && (
          <button
            type="button"
            onClick={() => {
              setFeedback(!feedback);
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
            <textarea value={note} rows={2} onChange={(event) => setNote(event.target.value)} />
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
