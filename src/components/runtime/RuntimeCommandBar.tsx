import {
  CheckCircle,
  CircleNotch,
  FileCode,
  Play,
  WarningCircle,
} from "@phosphor-icons/react";
import { useState } from "react";
import { type RuntimeTask, type StageId, workflowStages } from "../../domain";
import { Button } from "../Primitives";
import {
  getEffectiveStageRunAttempts,
  getEffectiveStageRunLimit,
} from "../../runtime-stage-limits";
import { candidateGateStages, getRuntimeGateFreshness, isStageComplete } from "./workflow";

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
  onAction: (
    action:
      | "approve-spec"
      | "approve-plan"
      | "plan"
      | "implement"
      | "repair"
      | "review"
      | "test"
      | "final-review"
      | "approve-merge"
      | "grant-retry",
  ) => Promise<void>;
  onFinishGrill: (acceptRemaining: boolean) => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const historical = viewedStageId !== task.currentStage;
  const running = task.status === "running" || task.status === "cancelling";
  const cancelling = task.status === "cancelling";
  const repairRunning = running && task.activeRunKind === "repair";
  const currentAttempts = getEffectiveStageRunAttempts(task);
  const currentStageRunLimit = getEffectiveStageRunLimit(task);
  const repairRequired = task.status === "repair-required";
  const exhaustedReadyGate =
    currentAttempts >= currentStageRunLimit &&
    ["ready-for-review", "ready-for-test", "ready-for-final-review"].includes(task.status);
  const blocked =
    task.status === "blocked" ||
    exhaustedReadyGate ||
    (currentAttempts >= currentStageRunLimit &&
      (task.status === "failed" || task.status === "cancelled" || repairRequired));
  const failed = !blocked && (task.status === "failed" || task.status === "cancelled");
  const ready =
    task.status.startsWith("awaiting-") ||
    task.status.startsWith("ready-for-") ||
    task.status === "completed";
  const accessBoundary = getAccessBoundaryCopy(task);
  const next = nextAction(task);
  const approvalBlocked = task.status === "awaiting-human-approval" && !candidateGateStages.every((stage) => isStageComplete(task, stage));
  const openGrill = task.status === "awaiting-grill" && task.grillSession?.status === "open";
  const unresolvedGrill = task.grillSession?.questions.filter((question) => !question.answer).length ?? 0;
  const actionable = ready || failed || repairRequired || blocked;
  const Icon = running ? CircleNotch : failed || blocked || repairRequired || approvalBlocked ? WarningCircle : CheckCircle;
  const invoke = async () => {
    if (!next?.action) return;
    setPending(true);
    setActionError(null);
    try {
      await onAction(next.action);
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
    const activeStage = workflowStages.find((stage) => stage.id === task.currentStage)?.label ?? task.currentStage;
    return (
      <section className="stage-command-bar stage-command-bar--history">
        <FileCode size={18} />
        <span className="stage-command-bar__copy">
          <small>Historical stage &middot; read-only</small>
          <strong>Viewing retained evidence</strong>
          <span>Workflow actions are hidden here. Return to {activeStage} to operate on the current state.</span>
        </span>
        <span className="badge badge--neutral">Recorded history</span>
      </section>
    );
  }
  return (
    <section
      className={`stage-command-bar stage-command-bar--${running ? "active" : failed || blocked || repairRequired || approvalBlocked ? "blocked" : ready ? "ready" : "waiting"}`}
    >
      <Icon className={running ? "spin" : ""} size={18} weight="fill" />
      <span className="stage-command-bar__copy">
        <small>{repairRunning ? "Candidate repair in progress" : accessBoundary.kicker}</small>
        <strong>
          {cancelling
            ? "Terminating the active process tree"
            : repairRunning
            ? "Repairing the retained integration candidate"
            : running
            ? accessBoundary.title
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
                      : "Four focused agents will produce durable Markdown handoffs."}
        </span>
      </span>
      <div className="stage-command-bar__actions">
        {(task.status === "queued" ||
          (failed &&
            task.currentStage !== "plan" &&
            !["implement", "dev-review", "test", "final-review"].includes(task.currentStage))) && (
          <Button tone="primary" compact icon={Play} onClick={() => void onRun()}>
            {failed ? "Retry stage" : "Run investigation"}
          </Button>
        )}
        {actionable && next?.action ? (
          <Button
            tone="primary"
            compact
            icon={Play}
            disabled={pending || approvalBlocked}
            title={approvalBlocked ? "Approval is blocked until every candidate-bound gate is fresh." : undefined}
            onClick={() => void invoke()}
          >
            {pending ? "Starting..." : next.label}
          </Button>
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

function nextAction(task: RuntimeTask) {
  const currentAttempts = getEffectiveStageRunAttempts(task);
  const retryAllowanceExhausted = currentAttempts >= getEffectiveStageRunLimit(task);
  if (
    (task.status === "blocked" ||
      (["repair-required", "failed"].includes(task.status) && retryAllowanceExhausted)) &&
    task.candidates?.at(-1)?.status === "repair_required"
  )
    return {
      action: "grant-retry" as const,
      label: "Grant one repair attempt",
      title: "Repair allowance exhausted",
      detail:
        "A human may grant exactly one additional attempt. The retained candidate and every failed review remain unchanged.",
    };
  if (
    retryAllowanceExhausted &&
    ["ready-for-review", "ready-for-test", "ready-for-final-review"].includes(task.status)
  )
    return {
      action: "grant-retry" as const,
      label: "Grant one stage attempt",
      title: "Stage retry allowance exhausted",
      detail: "A human may grant one additional attempt before this retained candidate enters the next gate.",
    };
  if (task.status === "blocked")
    return {
      action: "grant-retry" as const,
      label: "Grant one stage attempt",
      title: "Stage retry allowance exhausted",
      detail:
        "A human may grant one additional attempt. Qualified package commits and all failure evidence remain retained.",
    };
  if (task.status === "awaiting-spec-approval") {
    return task.workflow === "implement"
      ? {
          action: "approve-spec" as const,
          label: "Approve spec & create plan",
          title: "Approve the specification",
          detail: "Approval records this specification and starts a read-only planning agent.",
        }
      : {
          action: "approve-spec" as const,
          label: "Approve investigation",
          title: "Approve the investigation handoff",
          detail: "Approval closes this investigate-only task with the specification retained.",
        };
  }
  if (task.status === "awaiting-plan-approval")
    return {
      action: "approve-plan" as const,
      label: "Approve plan",
      title: "Approve the dependency-ordered plan",
      detail: "No repository changes happen until the approved plan is explicitly started.",
    };
  if (task.status === "ready-for-implementation")
    return {
      action: "implement" as const,
      label: "Start isolated implementation",
      title: "Create an isolated implementation candidate",
      detail:
        "The harness verifies a clean repository, creates a Git worktree, and gives Codex write access only there.",
    };
  if (task.status === "ready-for-review")
    return {
      action: "review" as const,
      label: "Run development review",
      title: "Review the exact candidate revision",
      detail: "The reviewer is bound to the candidate commit and cannot modify it.",
    };
  if (task.status === "ready-for-test")
    return {
      action: "test" as const,
      label: "Run focused tests",
      title: "Test the reviewed candidate",
      detail:
        "The test agent runs focused repository-defined checks without installing dependencies or running end-to-end suites.",
    };
  if (task.status === "ready-for-final-review")
    return {
      action: "final-review" as const,
      label: "Run final review",
      title: "Run the holdout final review",
      detail: "This gate summarizes every retained artifact against the approved acceptance criteria.",
    };
  if (task.status === "awaiting-human-approval") {
    const staleGate = candidateGateStages
      .map((stage) => ({ stage, freshness: getRuntimeGateFreshness(task, stage) }))
      .find(({ freshness }) => !freshness?.fresh);
    return {
      action: "approve-merge" as const,
      label: "Approve & merge",
      title: staleGate ? "Human approval blocked" : "Human merge approval required",
      detail: staleGate
        ? `Approval is blocked until ${workflowStages.find((stage) => stage.id === staleGate.stage)?.shortLabel ?? staleGate.stage} is fresh. ${staleGate.freshness?.reasonCopy ?? "No authoritative persisted terminal run summary is available for this candidate."}`
        : "The harness will merge only if the source branch is clean, unchanged, and can fast-forward to the reviewed commit.",
    };
  }
  if (task.status === "completed")
    return {
      action: null,
      label: "Completed",
      title: task.workflow === "implement" ? "Candidate merged" : "Investigation approved",
      detail: "The durable task evidence remains available from every completed stage.",
    };
  if (task.status === "failed") {
    if (task.candidates?.at(-1)?.status === "repair_required") {
      return {
        action: "repair" as const,
        label: "Retry repair",
        title: "Retry the candidate repair",
        detail:
          task.error ?? "The failed repair attempt left the last committed candidate revision unchanged.",
      };
    }
    const actions: Partial<Record<StageId, "plan" | "implement" | "review" | "test" | "final-review">> = {
      plan: "plan",
      implement: "implement",
      "dev-review": "review",
      test: "test",
      "final-review": "final-review",
    };
    const action = actions[task.currentStage];
    if (action)
      return {
        action,
        label: `Retry ${workflowStages.find((stage) => stage.id === task.currentStage)?.shortLabel ?? "stage"}`,
        title: "Retry the failed stage",
        detail: task.error ?? "The prior attempt failed; retained evidence will remain available.",
      };
  }
  if (task.status === "repair-required")
    return {
      action: "repair" as const,
      label: "Repair candidate",
      title: "Candidate repair required",
      detail:
        "The repair agent works in the same isolated worktree, creates a new candidate revision, and sends it through review again.",
    };
  return null;
}

export function getAccessBoundaryCopy(task: RuntimeTask) {
  const stage = workflowStages.find((entry) => entry.id === task.currentStage);
  const stageLabel = stage?.label ?? "Current stage";
  if (task.status === "awaiting-grill") {
    return {
      kicker: "Human decision boundary",
      title: "Grill Me is waiting for your decisions",
      detail:
        "No agent is running. Answer the material questions or explicitly accept the recommended assumptions.",
      sandbox: "No agent running",
    };
  }
  if (task.currentStage === "implement" || task.status === "repair-required") {
    const repairRequired = task.status === "repair-required";
    return {
      kicker: "Worktree write scope",
      title: `${repairRequired ? "Implement repair" : stageLabel} is confined to the isolated candidate worktree`,
      detail: repairRequired
        ? `The failed ${stageLabel} gate remains the workflow position; only the Implement repair agent may write inside the isolated candidate worktree.`
        : "Codex may write only inside the isolated candidate worktree for this stage.",
      sandbox: "Isolated candidate worktree",
    };
  }
  if (task.currentStage === "test") {
    return {
      kicker: "Candidate cleanliness boundary",
      title: `${stageLabel} may create temporary files while testing`,
      detail:
        "Temporary files are allowed, but the exact candidate revision must be left clean when the gate completes.",
      sandbox: "Temporary writes allowed, candidate must remain clean",
    };
  }
  return {
    kicker: "Read-only boundary",
    title: `${stageLabel} is read-only`,
    detail: "Codex reads the repository without writing to it in this stage.",
    sandbox: "Read-only",
  };
}
