import {
  type RuntimeArtifact,
  type RuntimeTask,
  type RuntimeWorkPackage,
  type StageId,
  workflowStages,
} from "../../domain";
import { nextAction } from "./runtimeCommandPolicy";
import { buildOperatorStageFacts } from "./operatorStageFacts";
import {
  candidateGateStages,
  getRuntimeGateFreshness,
  getRuntimeStageSummary,
  getStageTemporalState,
  isCandidateGateStage,
  isGateUnattempted,
  isStageComplete,
  isStageRunning,
} from "./workflow";

export { buildOperatorFinalReviewRows } from "./operatorFinalReviewModel";

export type OperatorTone = "neutral" | "blue" | "green" | "amber" | "red";

export interface OperatorFact {
  label: string;
  value: string;
  detail: string;
  tone?: OperatorTone;
}

export interface OperatorBriefingItem extends OperatorFact {
  key: "state" | "health" | "change" | "decision" | "action";
}

export interface OperatorPackageBatch {
  batch: number;
  packages: RuntimeWorkPackage[];
}

export interface OperatorViewModel {
  stageId: StageId;
  stageLabel: string;
  temporalState: "past" | "current" | "future";
  summary: ReturnType<typeof getRuntimeStageSummary>;
  artifact: RuntimeArtifact | undefined;
  briefing: OperatorBriefingItem[];
  facts: OperatorFact[];
  alert: { title: string; detail: string; tone: OperatorTone } | null;
  handoff: { label: string; detail: string; tone: OperatorTone };
  packageBatches: OperatorPackageBatch[];
  staleGates: Array<{ stageId: (typeof candidateGateStages)[number]; label: string; reason: string }>;
}

const awaitingStatuses = new Set<RuntimeTask["status"]>([
  "awaiting-grill",
  "awaiting-spec-approval",
  "awaiting-plan-approval",
  "awaiting-already-satisfied",
  "ready-for-implementation",
  "ready-for-review",
  "review-retry-required",
  "ready-for-test",
  "ready-for-final-review",
  "awaiting-human-approval",
  "awaiting-pr-merge",
]);

export function buildOperatorViewModel(task: RuntimeTask, stageId: StageId): OperatorViewModel {
  const temporalState = getStageTemporalState(task, stageId);
  const stageLabel = workflowStages.find((stage) => stage.id === stageId)?.label ?? stageId;
  const artifact = findStageArtifact(task, stageId);
  const running = isStageRunning(task, stageId);
  const summary = getRuntimeStageSummary(task, stageId, artifact, running);
  const staleGates = getStaleGates(task);
  const packageBatches = groupPackagesByBatch(task.workPackages ?? []);
  const state = statePresentation(task, stageId, temporalState, running);
  const health = healthPresentation(task, stageId, temporalState, staleGates);
  const decision = decisionPresentation(task, stageId, temporalState);
  const action = actionPresentation(task, temporalState);
  const alert = alertPresentation(task, stageId, temporalState, staleGates);

  return {
    stageId,
    stageLabel,
    temporalState,
    summary,
    artifact,
    packageBatches,
    staleGates,
    alert,
    facts: buildOperatorStageFacts(task, stageId, artifact),
    briefing: [
      { key: "state", label: "Current state", ...state },
      { key: "health", label: "Health", ...health },
      {
        key: "change",
        label: "What changed",
        value: summary.title,
        detail: summary.detail,
        tone: artifact || isStageComplete(task, stageId) ? "green" : "neutral",
      },
      { key: "decision", label: "Decision / readiness", ...decision },
      { key: "action", label: "Next safe action", ...action },
    ],
    handoff: handoffPresentation(task, stageId, artifact, running),
  };
}

export function groupPackagesByBatch(packages: RuntimeWorkPackage[]): OperatorPackageBatch[] {
  const grouped = new Map<number, RuntimeWorkPackage[]>();
  for (const workPackage of packages) {
    const batch = Number.isFinite(workPackage.batch) ? workPackage.batch : 0;
    grouped.set(batch, [...(grouped.get(batch) ?? []), workPackage]);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left - right)
    .map(([batch, batchPackages]) => ({ batch, packages: batchPackages }));
}

function findStageArtifact(task: RuntimeTask, stageId: StageId) {
  if (isCandidateGateStage(stageId)) {
    const sourceArtifactId = getRuntimeGateFreshness(task, stageId)?.sourceArtifactId;
    if (sourceArtifactId) {
      return task.artifacts.find(
        (artifact) => artifact.stage === stageId && artifact.id === sourceArtifactId,
      );
    }
  }
  return [...task.artifacts].reverse().find((artifact) => artifact.stage === stageId);
}

function statePresentation(
  task: RuntimeTask,
  stageId: StageId,
  temporalState: OperatorViewModel["temporalState"],
  running: boolean,
): Omit<OperatorFact, "label"> {
  if (temporalState === "future")
    return { value: "Not started", detail: "This stage has no persisted run or handoff.", tone: "neutral" };
  if (temporalState === "past")
    return { value: "Recorded history", detail: "Read-only evidence from a prior stage.", tone: "blue" };
  if (running)
    return {
      value: task.activeRunKind === "repair" ? "Repair running" : "Running",
      detail: `${workflowStages.find((stage) => stage.id === stageId)?.label ?? stageId} has an active persisted run.`,
      tone: "blue",
    };
  if (task.status === "cancelling")
    return {
      value: "Cancelling",
      detail: "Waiting for the active process tree to terminate.",
      tone: "amber",
    };
  if (task.status === "blocked")
    return {
      value: "Blocked",
      detail: task.blocker?.detail ?? task.error ?? "Operator input is required.",
      tone: "red",
    };
  if (task.status === "failed" || task.status === "cancelled")
    return {
      value: task.status === "failed" ? "Failed" : "Cancelled",
      detail: task.error ?? "The stage stopped without a handoff.",
      tone: "red",
    };
  if (task.status === "repair-required")
    return {
      value: "Repair required",
      detail: "A new candidate revision is required before downstream gates can pass.",
      tone: "red",
    };
  if (["completed", "merged-to-target"].includes(task.status))
    return {
      value: task.status === "completed" ? "Completed" : "Merged",
      detail: "The terminal outcome is persisted.",
      tone: "green",
    };
  if (task.status === "closed" || task.status === "archived")
    return {
      value: task.status === "closed" ? "Closed" : "Archived",
      detail: "The task is retained as read-only history.",
      tone: "neutral",
    };
  if (awaitingStatuses.has(task.status))
    return {
      value: humanizeStatus(task.status),
      detail: "No agent is running; a workflow gate is waiting.",
      tone: "amber",
    };
  return {
    value: humanizeStatus(task.status),
    detail: "The persisted task is waiting to advance.",
    tone: "neutral",
  };
}

function healthPresentation(
  task: RuntimeTask,
  stageId: StageId,
  temporalState: OperatorViewModel["temporalState"],
  staleGates: OperatorViewModel["staleGates"],
): Omit<OperatorFact, "label"> {
  const failedPackages = (task.workPackages ?? []).filter((item) => item.status === "failed");
  const viewedStaleGate = staleGates.find((gate) => gate.stageId === stageId);
  if (viewedStaleGate) return { value: "Rerun required", detail: viewedStaleGate.reason, tone: "amber" };
  if (task.blocker) return { value: "Blocked", detail: task.blocker.detail, tone: "red" };
  if (task.error) return { value: "Stopped with an error", detail: task.error, tone: "red" };
  if (stageId === "implement" && failedPackages.length)
    return {
      value: `${failedPackages.length} package${failedPackages.length === 1 ? "" : "s"} failed`,
      detail: failedPackages.map((item) => item.id).join(", "),
      tone: "red",
    };
  if (staleGates.length && ["implement", "dev-review", "test", "final-review", "approval"].includes(stageId))
    return {
      value: `${staleGates.length} stale gate${staleGates.length === 1 ? "" : "s"}`,
      detail: staleGates.map((gate) => gate.label).join(", "),
      tone: "amber",
    };
  if (temporalState === "future")
    return {
      value: "No evidence yet",
      detail: "Health is unavailable before the stage starts.",
      tone: "neutral",
    };
  return {
    value: "No recorded issue",
    detail: "No persisted blocker, error, failed package, or stale gate applies.",
    tone: "green",
  };
}

function decisionPresentation(
  task: RuntimeTask,
  stageId: StageId,
  temporalState: OperatorViewModel["temporalState"],
): Omit<OperatorFact, "label"> {
  if (temporalState === "past")
    return {
      value: "No action here",
      detail: `Operate from the current ${currentStageLabel(task)} stage.`,
      tone: "neutral",
    };
  if (stageId === "grill") {
    const unresolved = task.grillSession?.questions.filter((question) => !question.answer) ?? [];
    if (unresolved.length)
      return {
        value: `${unresolved.length} decision${unresolved.length === 1 ? "" : "s"} unresolved`,
        detail: unresolved[0]?.question ?? "Answer the remaining material question.",
        tone: "amber",
      };
  }
  if (stageId === "approval") {
    const fresh = candidateGateStages.filter((gate) => getRuntimeGateFreshness(task, gate)?.fresh).length;
    return {
      value: `${fresh} / ${candidateGateStages.length} gates fresh`,
      detail:
        fresh === candidateGateStages.length
          ? "The exact candidate is ready for human review."
          : "Approval remains blocked.",
      tone: fresh === candidateGateStages.length ? "green" : "amber",
    };
  }
  const candidate = task.candidates?.at(-1);
  if (["implement", "dev-review", "test", "final-review"].includes(stageId) && candidate)
    return {
      value: `${candidate.id} r${candidate.revisionNumber}`,
      detail: candidate.headRevision
        ? `Exact head ${candidate.headRevision.slice(0, 8)}.`
        : "Candidate head is pending.",
      tone: "blue",
    };
  return {
    value: isStageComplete(task, stageId) ? "Handoff retained" : "Awaiting authoritative handoff",
    detail: isStageComplete(task, stageId)
      ? "Downstream work can inspect the persisted result."
      : "This stage has not yet produced a complete handoff.",
    tone: isStageComplete(task, stageId) ? "green" : "neutral",
  };
}

function actionPresentation(
  task: RuntimeTask,
  temporalState: OperatorViewModel["temporalState"],
): Omit<OperatorFact, "label"> {
  if (temporalState === "past")
    return {
      value: `Return to ${currentStageLabel(task)}`,
      detail: "Historical stages are read-only.",
      tone: "blue",
    };
  if (task.status === "running" || task.status === "cancelling")
    return {
      value: task.status === "running" ? "Monitor active run" : "Wait for termination",
      detail: "The command bar remains the authority for cancellation and recovery.",
      tone: "blue",
    };
  const next = nextAction(task);
  if (next)
    return { value: next.label, detail: next.detail, tone: task.status === "blocked" ? "red" : "blue" };
  if (task.status === "queued")
    return { value: "Run investigation", detail: "Start the first persisted workflow stage.", tone: "blue" };
  if (["completed", "closed", "archived"].includes(task.status))
    return {
      value: "Inspect retained evidence",
      detail: "No workflow mutation is required.",
      tone: "neutral",
    };
  return {
    value: "No safe action available",
    detail: task.actionEligibility
      ? "The persisted eligibility policy does not authorize an action."
      : "Wait for the runtime state to advance.",
    tone: task.status === "failed" || task.status === "blocked" ? "red" : "neutral",
  };
}

function alertPresentation(
  task: RuntimeTask,
  stageId: StageId,
  temporalState: OperatorViewModel["temporalState"],
  staleGates: OperatorViewModel["staleGates"],
): OperatorViewModel["alert"] {
  if (temporalState === "future") return null;
  if (task.blocker)
    return { title: humanizeStatus(task.blocker.code), detail: task.blocker.detail, tone: "red" };
  if (task.error)
    return {
      title: task.status === "cancelled" ? "Stage cancelled" : "Stage error",
      detail: task.error,
      tone: "red",
    };
  const failedPackage =
    stageId === "implement" ? (task.workPackages ?? []).find((item) => item.status === "failed") : null;
  if (failedPackage)
    return {
      title: `${failedPackage.id} failed`,
      detail: failedPackage.error ?? "The package stopped without a persisted error message.",
      tone: "red",
    };
  const viewedStale = staleGates.find((gate) => gate.stageId === stageId);
  if (viewedStale)
    return { title: `${viewedStale.label} must run again`, detail: viewedStale.reason, tone: "amber" };
  if (task.status === "repair-required")
    return {
      title: "Candidate repair required",
      detail: staleGates.length
        ? `${staleGates.map((gate) => gate.label).join(", ")} evidence is retained but no longer current.`
        : "Repair creates a new candidate revision and invalidates affected downstream gates.",
      tone: "red",
    };
  return null;
}

function handoffPresentation(
  task: RuntimeTask,
  stageId: StageId,
  artifact: RuntimeArtifact | undefined,
  running: boolean,
): OperatorViewModel["handoff"] {
  if (running)
    return { label: "Handoff pending", detail: "The current run has not completed.", tone: "blue" };
  if (task.stageDispositions?.[stageId])
    return {
      label: "Deterministic handoff",
      detail: task.stageDispositions[stageId]?.reason ?? "Persisted.",
      tone: "green",
    };
  if (isStageComplete(task, stageId))
    return {
      label: "Ready for downstream use",
      detail: artifact?.name ?? "The completed stage state is persisted.",
      tone: "green",
    };
  if (artifact)
    return {
      label: "Evidence retained",
      detail: `${artifact.name} is inspectable but is not a complete current handoff.`,
      tone: "amber",
    };
  return {
    label: "No authoritative handoff",
    detail: "This stage has not produced a durable artifact yet.",
    tone: "neutral",
  };
}

function getStaleGates(task: RuntimeTask): OperatorViewModel["staleGates"] {
  return candidateGateStages.flatMap((stageId) => {
    const freshness = getRuntimeGateFreshness(task, stageId);
    if (!freshness || freshness.fresh || isGateUnattempted(freshness)) return [];
    return [
      {
        stageId,
        label: workflowStages.find((stage) => stage.id === stageId)?.label ?? stageId,
        reason: freshness.reasonCopy,
      },
    ];
  });
}

function currentStageLabel(task: RuntimeTask) {
  return workflowStages.find((stage) => stage.id === task.currentStage)?.label ?? task.currentStage;
}

function humanizeStatus(value: string) {
  const text = value.replaceAll("_", " ").replaceAll("-", " ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}
