import {
  formatCacheRate,
  formatTokenCount,
  type RuntimeArtifact,
  type RuntimeTask,
  type RuntimeUsage,
  type RuntimeWorkPackage,
  type StageId,
  workflowStages,
} from "../../domain";
import {
  getRuntimeGateFreshness,
  getStageTemporalState,
  isStageComplete,
  isStageInvalidatedByRepair,
  isStageRunning,
} from "../runtime/workflow";

export type ObservatoryState = "complete" | "active" | "waiting" | "blocked" | "stale";
export type ObservatorySelection =
  | { kind: "stage"; id: StageId }
  | { kind: "package"; id: string }
  | { kind: "candidate"; id: string };

export interface ObservatoryStage {
  id: StageId;
  index: number;
  label: string;
  state: ObservatoryState;
  artifact: RuntimeArtifact | null;
  duration: string;
}

export interface ObservatoryPackage {
  id: string;
  title: string;
  dependencies: string[];
  state: ObservatoryState;
  agent: string;
  model: string;
  reasoning: string;
  elapsed: string;
  usage: RuntimeUsage | null;
  cacheRate: string;
  inputArtifact: RuntimeArtifact | null;
  outputArtifact: RuntimeArtifact | null;
  worktree: string | null;
  error: string | null;
}

export interface ObservatoryCandidate {
  id: string;
  revision: number;
  headRevision: string | null;
  state: ObservatoryState;
  priorRevision: number | null;
  members: string[];
}

export interface ObservatoryModel {
  stages: ObservatoryStage[];
  packages: ObservatoryPackage[];
  candidate: ObservatoryCandidate | null;
  activeStage: ObservatoryStage;
  elapsed: string;
  eventRange: { first: string | null; last: string | null };
}

export function buildObservatoryModel(task: RuntimeTask): ObservatoryModel {
  const activeStageIndex = Math.max(
    0,
    workflowStages.findIndex((stage) => stage.id === task.currentStage),
  );
  const stages = workflowStages.map((stage, index): ObservatoryStage => {
    const artifact = [...task.artifacts].reverse().find((item) => item.stage === stage.id) ?? null;
    return {
      id: stage.id,
      index,
      label: stage.shortLabel,
      state: stageState(task, stage.id),
      artifact,
      duration: stageDuration(task, stage.id, artifact),
    };
  });
  const packages = (task.workPackages ?? []).map((item) => packageModel(task, item));
  const latestCandidate = task.candidates.at(-1);
  const candidate = latestCandidate
    ? {
        id: latestCandidate.id,
        revision: latestCandidate.revisionNumber,
        headRevision: latestCandidate.headRevision,
        state: candidateState(task, latestCandidate.status),
        priorRevision: latestCandidate.revisionNumber > 1 ? latestCandidate.revisionNumber - 1 : null,
        members: latestCandidate.members?.map((item) => item.packageId) ?? [],
      }
    : null;
  const eventTimes = task.events
    .map((event) => event.at)
    .filter(Boolean)
    .sort();
  const activeStage = stages[activeStageIndex] ?? stages[0];
  if (!activeStage) throw new Error("The observatory requires at least one workflow stage.");
  return {
    stages,
    packages,
    candidate,
    activeStage,
    elapsed: formatDurationBetween(
      task.startedAt,
      task.completedAt ?? (task.status === "running" ? new Date().toISOString() : task.updatedAt),
    ),
    eventRange: { first: eventTimes[0] ?? null, last: eventTimes.at(-1) ?? null },
  };
}

export function defaultObservatorySelection(model: ObservatoryModel): ObservatorySelection {
  const activePackage =
    model.packages.find((item) => item.state === "active") ??
    model.packages.find((item) => item.state === "blocked") ??
    model.packages[0];
  if (activePackage) return { kind: "package", id: activePackage.id };
  if (model.candidate) return { kind: "candidate", id: model.candidate.id };
  return { kind: "stage", id: model.activeStage.id };
}

export function selectionArtifact(model: ObservatoryModel, selection: ObservatorySelection) {
  if (selection.kind === "stage")
    return model.stages.find((item) => item.id === selection.id)?.artifact ?? null;
  if (selection.kind === "package")
    return model.packages.find((item) => item.id === selection.id)?.outputArtifact ?? null;
  return null;
}

function stageState(task: RuntimeTask, stageId: StageId): ObservatoryState {
  if (isStageInvalidatedByRepair(task, stageId)) return "stale";
  if (isStageRunning(task, stageId)) return "active";
  if (isStageComplete(task, stageId)) return "complete";
  const currentFailure =
    stageId === task.currentStage &&
    ["failed", "blocked", "repair-required", "cancelled"].includes(task.status);
  if (currentFailure) return "blocked";
  if (stageId === task.currentStage && task.status !== "queued") return "active";
  return getStageTemporalState(task, stageId) === "past" ? "stale" : "waiting";
}

function packageModel(task: RuntimeTask, item: RuntimeWorkPackage): ObservatoryPackage {
  const run = [...(task.runs ?? [])].reverse().find((candidate) => candidate.workPackageId === item.id);
  const outputArtifact =
    [...task.artifacts].reverse().find((artifact) => artifact.workPackageId === item.id) ?? null;
  const inputArtifact = [...task.artifacts].reverse().find((artifact) => artifact.stage === "plan") ?? null;
  const policy = task.agentConfig?.stagePolicies?.implement;
  const usage = run?.usage ?? outputArtifact?.usage ?? null;
  return {
    id: item.id,
    title: item.title,
    dependencies: item.dependencies,
    state: packageState(item),
    agent: run?.role ?? "Implement agent",
    model: run?.model ?? outputArtifact?.model ?? policy?.model ?? task.agentConfig?.model ?? "Not recorded",
    reasoning:
      run?.reasoning ??
      outputArtifact?.reasoning ??
      policy?.reasoning ??
      task.agentConfig?.reasoning ??
      "Not recorded",
    elapsed: run
      ? formatDuration(run.durationMs ?? durationMs(run.startedAt, run.completedAt))
      : "Not started",
    usage,
    cacheRate: usage ? formatCacheRate(usage) : "\u2014",
    inputArtifact,
    outputArtifact,
    worktree: item.branch ?? item.worktreePath,
    error: item.error,
  };
}

function packageState(item: RuntimeWorkPackage): ObservatoryState {
  if (item.status === "failed") return "blocked";
  if (item.status === "running") return "active";
  if (item.status === "integrated" || item.status === "ready_for_integration") return "complete";
  return "waiting";
}

function candidateState(task: RuntimeTask, status: string): ObservatoryState {
  if (status === "repair_required" || task.status === "repair-required") return "blocked";
  if (status === "merged") return "complete";
  if (task.status === "running" && task.currentStage === "implement") return "active";
  if (
    ["ready-for-review", "ready-for-test", "ready-for-final-review", "awaiting-human-approval"].includes(
      task.status,
    )
  )
    return "active";
  const staleGate = (["dev-review", "test", "final-review"] as const).some((stage) => {
    const freshness = getRuntimeGateFreshness(task, stage);
    return freshness != null && !freshness.fresh;
  });
  return staleGate ? "stale" : "waiting";
}

function stageDuration(task: RuntimeTask, stageId: StageId, artifact: RuntimeArtifact | null) {
  const runs = (task.runs ?? []).filter((run) => run.stage === stageId);
  const milliseconds =
    runs.reduce((sum, run) => sum + (run.durationMs ?? durationMs(run.startedAt, run.completedAt) ?? 0), 0) ||
    artifact?.durationMs ||
    durationMs(artifact?.startedAt, artifact?.completedAt) ||
    null;
  return formatDuration(milliseconds);
}

function durationMs(start: string | null | undefined, end: string | null | undefined) {
  if (!start) return null;
  return Math.max(0, new Date(end ?? Date.now()).getTime() - new Date(start).getTime());
}

function formatDurationBetween(start: string | null, end: string | null) {
  return formatDuration(durationMs(start, end));
}

export function formatDuration(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "\u2014";
  const totalSeconds = Math.max(0, Math.floor(value / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

export function formatUsage(usage: RuntimeUsage | null) {
  if (!usage) return { input: "\u2014", output: "\u2014", cache: "\u2014" };
  return {
    input: formatTokenCount(usage.inputTokens),
    output: formatTokenCount(usage.outputTokens),
    cache: formatCacheRate(usage),
  };
}
