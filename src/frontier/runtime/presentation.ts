import type { RuntimeRun, RuntimeWorkPackage, StageId } from "../../domain.ts";
import type { Attention, TaskCore, TaskSummary } from "./contracts.ts";

const readyStatuses = new Set([
  "ready-for-implementation",
  "ready-for-review",
  "ready-for-test",
  "ready-for-final-review",
]);
type ReadyAttention = Omit<Attention, "kind"> & { kind: "ready" };
type PresentedAttention = Attention | ReadyAttention;

function isReadyStatus(status: string) {
  return readyStatuses.has(status);
}

function readyAttention(attention: Attention): ReadyAttention {
  return { ...attention, kind: "ready" };
}

export const stageLabels: Record<StageId, string> = {
  triage: "Triage",
  scouts: "Scouts",
  grill: "Grill",
  specification: "Specification",
  plan: "Plan",
  implement: "Implement",
  "dev-review": "Dev review",
  test: "Test",
  "final-review": "Final review",
  approval: "Approval",
};
export function attentionFor(task: TaskSummary | TaskCore): PresentedAttention {
  // Older companions have no shared projection. Keep the missing state explicit.
  const attention = task.attention;
  if (attention) {
    // The companion's existing projection calls ready states idle. Adapt only
    // that neutral state so blocker, failure, and active-run precedence stays
    // owned by the projection that supplied it.
    return isReadyStatus(task.status) && attention.kind === "idle"
      ? readyAttention(attention)
      : attention;
  }
  const fallback: Attention = {
    kind: "unavailable",
    stage: task.currentStage,
    label: task.status.replaceAll("-", " "),
    reason: task.blocker?.detail ?? task.error ?? null,
    nextActor: null,
    since: task.blocker?.detectedAt ?? null,
    questionId: null,
  };
  return isReadyStatus(task.status) ? readyAttention(fallback) : fallback;
}
export function needsYou(task: TaskSummary | TaskCore) {
  return (
    isOpen(task) && ["answer", "approval", "failed", "repair", "blocked"].includes(attentionFor(task).kind)
  );
}
export function isOpen(task: TaskSummary) {
  return !["completed", "closed", "archived", "cancelled"].includes(task.status);
}
export function isExecuting(task: TaskSummary) {
  return Boolean(
    task.activeRunKind ||
      task.activeRunIds?.length ||
      task.workPackages.some((item) => item.status === "running"),
  );
}
export function isActiveRun(task: TaskCore | TaskSummary, run: RuntimeRun) {
  return isOpen(task) && run.status === "running" && Boolean(task.activeRunIds?.includes(run.id));
}
export function latestRun(runs: RuntimeRun[], activeIds: string[] = []) {
  return (
    runs.find((run) => activeIds.includes(run.id) && run.status === "running") ??
    [...runs].sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""))[0]
  );
}
export function packageState(item: RuntimeWorkPackage, packages: RuntimeWorkPackage[]) {
  if (item.status === "planned") {
    const waiting = item.dependencies.filter(
      (id) =>
        !packages.some(
          (dependency) =>
            dependency.id === id && ["ready_for_integration", "integrated"].includes(dependency.status),
        ),
    );
    return waiting.length ? `Waiting on ${waiting.join(", ")}` : "Ready to start";
  }
  return {
    running: "Running",
    failed: "Failed",
    ready_for_integration: "Ready for integration",
    integrated: "Integrated",
  }[item.status];
}
export function modelLabel(value: string | null | undefined) {
  return (
    value
      ?.replace(/^gpt-/, "")
      .replace(/^5\.6-/, "")
      .replace(/\b\w/g, (char) => char.toUpperCase()) ?? "Not recorded"
  );
}
export function reasoningLabel(value: string | null | undefined) {
  return value === "xhigh" ? "XHigh" : value ? value[0]?.toUpperCase() + value.slice(1) : "Not recorded";
}
export function formatCount(value: number) {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}
export function formatDuration(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "Not recorded";
  const seconds = Math.max(0, Math.floor(value / 1000));
  return seconds >= 3600
    ? `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
    : seconds >= 60
      ? `${Math.floor(seconds / 60)}m ${seconds % 60}s`
      : `${seconds}s`;
}
export function runDuration(run: RuntimeRun, now: number, active: boolean) {
  if (active && run.startedAt) return Math.max(0, now - Date.parse(run.startedAt));
  return (
    run.durationMs ??
    (run.startedAt && run.completedAt ? Date.parse(run.completedAt) - Date.parse(run.startedAt) : null)
  );
}
export function commandDestination(task: TaskSummary | TaskCore) {
  const kind = attentionFor(task).kind;
  return kind === "answer" ? "grill" : kind === "repair" || kind === "failed" ? "findings" : "task";
}
export function attentionAction(task: TaskSummary | TaskCore) {
  const kind = attentionFor(task).kind;
  return kind === "answer"
    ? attentionFor(task).questionId
      ? "Answer question"
      : "Review answers"
    : kind === "repair"
      ? "Review findings"
      : kind === "approval"
        ? (attentionFor(task).reason ?? "Review approval")
        : kind === "failed" || kind === "blocked"
          ? "Inspect blocker"
          : "Inspect task";
}
