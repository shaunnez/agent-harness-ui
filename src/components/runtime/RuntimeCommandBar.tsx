import { CheckCircle, CircleNotch, FileCode, Play, WarningCircle } from "@phosphor-icons/react";
import { useState } from "react";
import { type RuntimeTask, type StageId, workflowStages } from "../../domain";
import { Button } from "../Primitives";
import { getEffectiveStageRunAttempts, getEffectiveStageRunLimit } from "../../runtime-stage-limits";
import type { RuntimeWorkflowAction } from "./contracts";
import { candidateGateStages, isStageComplete } from "./workflow";
import { deriveNextAction, getAccessBoundaryCopy, nextAction } from "./runtimeCommandPolicy";

export { getAccessBoundaryCopy, nextAction } from "./runtimeCommandPolicy";

export function RuntimeCommandBar({
  task,
  viewedStageId,
  onRun,
  onAction,
  onFinishGrill,
}: {
  task: RuntimeTask;
  viewedStageId: StageId;
  onRun: () => Promise<void>;
  onAction: (action: RuntimeWorkflowAction) => Promise<void>;
  onFinishGrill: (acceptRemaining: boolean) => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const historical = viewedStageId !== task.currentStage;
  const running = task.status === "running" || task.status === "cancelling";
  const persistedRunActive = running && (task.activeRunIds?.length ?? 0) > 0;
  const cancelling = task.status === "cancelling";
  const repairRunning = running && task.activeRunKind === "repair";
  const currentAttempts = getEffectiveStageRunAttempts(task);
  const currentStageRunLimit = getEffectiveStageRunLimit(task);
  const retryAllowanceExhausted = currentAttempts >= currentStageRunLimit;
  const repairRequired = task.status === "repair-required";
  const mergeReconciliation =
    task.status === "merging" ||
    task.status === "awaiting-pr-merge" ||
    (task.status === "blocked" &&
      [
        "merge-reconciliation",
        "pull-request-publication",
        "pull-request-closed",
        "pull-request-drift",
      ].includes(task.blocker?.code ?? ""));
  const exhaustedReadyGate =
    currentAttempts >= currentStageRunLimit &&
    ["ready-for-review", "review-retry-required", "ready-for-test", "ready-for-final-review"].includes(
      task.status,
    );
  const blocked =
    task.status === "blocked" ||
    exhaustedReadyGate ||
    (currentAttempts >= currentStageRunLimit &&
      (task.status === "failed" || task.status === "cancelled" || repairRequired));
  const failed = !blocked && (task.status === "failed" || task.status === "cancelled");
  const ready =
    task.status.startsWith("awaiting-") ||
    task.status.startsWith("ready-for-") ||
    task.status === "merged-to-target" ||
    task.status === "completed" ||
    task.status === "review-retry-required";
  const accessBoundary = getAccessBoundaryCopy(task);
  const proposedNext = deriveNextAction(task);
  const next = nextAction(task);
  const nextEligibility = proposedNext?.action
    ? task.actionEligibility?.actions[proposedNext.action]
    : undefined;
  const nextActionDenied =
    proposedNext?.action != null && next?.action == null && nextEligibility?.allowed === false;
  const approvalBlocked =
    task.status === "awaiting-human-approval" &&
    !candidateGateStages.every((stage) => isStageComplete(task, stage));
  const openGrill = task.status === "awaiting-grill" && task.grillSession?.status === "open";
  const unresolvedGrill = task.grillSession?.questions.filter((question) => !question.answer).length ?? 0;
  const actionable = ready || failed || repairRequired || blocked || mergeReconciliation;
  const Icon = persistedRunActive
    ? CircleNotch
    : failed || blocked || repairRequired || approvalBlocked
      ? WarningCircle
      : CheckCircle;
  const invoke = async (action: RuntimeWorkflowAction) => {
    setPending(true);
    setActionError(null);
    try {
      await onAction(action);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The action could not be completed.");
    } finally {
      setPending(false);
    }
  };
  const finishGrillSession = async () => {
    setPending(true);
    setActionError(null);
    try {
      await onFinishGrill(unresolvedGrill > 0);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Grill Me could not be completed.");
    } finally {
      setPending(false);
    }
  };
  if (historical) {
    const activeStage =
      workflowStages.find((stage) => stage.id === task.currentStage)?.label ?? task.currentStage;
    return (
      <section className="stage-command-bar stage-command-bar--history">
        <FileCode size={18} />
        <span className="stage-command-bar__copy">
          <small>Historical stage &middot; read-only</small>
          <strong>Viewing retained evidence</strong>
          <span>
            Workflow actions are hidden here. Return to {activeStage} to operate on the current state.
          </span>
        </span>
        <span className="badge badge--neutral">Recorded history</span>
      </section>
    );
  }
  return (
    <section
      className={`stage-command-bar stage-command-bar--${running ? "active" : failed || blocked || repairRequired || approvalBlocked ? "blocked" : ready ? "ready" : "waiting"}`}
    >
      <Icon className={persistedRunActive ? "spin" : ""} size={18} weight="fill" />
      <span className="stage-command-bar__copy">
        <small>{repairRunning ? "Candidate repair in progress" : accessBoundary.kicker}</small>
        <strong>
          {cancelling
            ? "Terminating the active process tree"
            : repairRunning
              ? "Repairing the retained integration candidate"
              : running
                ? accessBoundary.title
                : mergeReconciliation
                  ? (next?.title ?? "Merge reconciliation needs operator input")
                  : nextActionDenied
                    ? "No safe action available"
                    : blocked
                      ? (next?.title ?? "Repair allowance exhausted")
                      : repairRequired
                        ? `${accessBoundary.title} - repair the retained candidate`
                        : failed
                          ? "Retry the failed stage"
                          : openGrill
                            ? "Resolve the decision frontier"
                            : ready
                              ? (next?.title ?? "Workflow gate ready")
                              : "Start the read-only investigation"}
        </strong>
        <span>
          {cancelling
            ? "The task remains reserved until the operating system confirms that the agent and its descendants have closed. Retries stay disabled."
            : repairRunning
              ? "The Implement agent is writing inside the isolated candidate worktree. Dev Review, Test, Final Review, and Approval require fresh evidence after the new revision is assembled."
              : running
                ? accessBoundary.detail
                : mergeReconciliation
                  ? (next?.detail ??
                    task.error ??
                    "Recheck the retained exact-candidate merge intent before continuing.")
                  : nextActionDenied
                    ? `${task.error ?? "The proposed action is not currently safe."} ${nextEligibility?.reason ?? "The backend denied this action."}`
                    : blocked
                      ? (next?.detail ?? "Review the retained activity before granting another attempt.")
                      : repairRequired
                        ? `${accessBoundary.detail} ${next?.detail ?? "The retained gate evidence identifies the required repair."}`
                        : failed
                          ? task.error
                          : openGrill
                            ? unresolvedGrill
                              ? `${unresolvedGrill} material question${unresolvedGrill === 1 ? "" : "s"} remain. You can answer them below or explicitly accept the recommended assumptions.`
                              : "Every material question is settled. Finish Grill Me to build the task specification."
                            : ready
                              ? (next?.detail ?? "The retained workflow evidence is ready for review.")
                              : task.workflowProfile?.selected === "fast"
                                ? "The fast profile will use only the model calls and repository evidence this bounded change requires."
                                : "The workflow will produce durable, inspectable handoffs."}
        </span>
      </span>
      <div className="stage-command-bar__actions">
        {(task.status === "queued" ||
          (failed &&
            !["specification", "plan", "implement", "dev-review", "test", "final-review"].includes(
              task.currentStage,
            ))) &&
          (task.actionEligibility?.actions.run?.allowed ?? true) && (
            <Button tone="primary" compact icon={Play} onClick={() => void onRun()}>
              {failed ? "Retry stage" : "Run investigation"}
            </Button>
          )}
        {task.status === "awaiting-plan-approval" &&
        !retryAllowanceExhausted &&
        (task.actionEligibility?.actions.plan?.allowed ?? true) ? (
          <Button
            tone="secondary"
            compact
            icon={Play}
            disabled={pending}
            title="Record the required correction as a task decision before revising."
            onClick={() => void invoke("plan")}
          >
            {pending ? "Starting..." : "Revise plan"}
          </Button>
        ) : null}
        {actionable && next?.action && !nextActionDenied ? (
          <RuntimeWorkflowActionButton
            action={next.action}
            label={next.label}
            pending={pending}
            approvalBlocked={approvalBlocked}
            onInvoke={invoke}
          />
        ) : null}
        {openGrill ? (
          <Button
            tone="primary"
            compact
            icon={Play}
            disabled={pending}
            onClick={() => void finishGrillSession()}
          >
            {pending
              ? "Starting specification..."
              : unresolvedGrill
                ? `Finish with ${unresolvedGrill} recommendation${unresolvedGrill === 1 ? "" : "s"}`
                : "Finish Grill & build specification"}
          </Button>
        ) : null}
      </div>
      {actionError ? <span className="runtime-command-error">{actionError}</span> : null}
    </section>
  );
}

export function RuntimeWorkflowActionButton({
  action,
  label,
  pending,
  approvalBlocked,
  onInvoke,
}: {
  action: RuntimeWorkflowAction;
  label: string;
  pending: boolean;
  approvalBlocked: boolean;
  onInvoke: (action: RuntimeWorkflowAction) => Promise<void>;
}) {
  return (
    <Button
      tone="primary"
      compact
      icon={Play}
      disabled={pending || approvalBlocked}
      title={approvalBlocked ? "Approval is blocked until every candidate-bound gate is fresh." : undefined}
      onClick={() => onInvoke(action)}
    >
      {pending ? "Starting..." : label}
    </Button>
  );
}
