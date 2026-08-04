import {
  ArrowRight,
  ArrowClockwise,
  CheckCircle,
  Clock,
  Cpu,
  CurrencyDollar,
  GitBranch,
  HourglassMedium,
  ShieldCheck,
  Warning,
} from "@phosphor-icons/react";
import {
  formatApproximateCost,
  formatCacheRate,
  formatTokenCount,
  type RuntimeStatus,
  type RuntimeTask,
  runtimeTaskToRecentTask,
  workflowStages,
} from "../domain";
import { Button, ModelStack, PriorityBadge, SectionHeader } from "./Primitives";
import { TaskTable } from "./TaskTable";
import { WorkflowProgressRing } from "./WorkflowProgressRing";

function isGateStatus(status: RuntimeTask["status"]) {
  return status.startsWith("awaiting-") || status.startsWith("ready-for-");
}

export function CommandCentre({
  onOpenTask,
  runtimeTasks,
  runtimeStatus,
  runtimeLoading,
  runtimeError,
  onNewTask,
  onSeeAllTasks,
  onRefreshRuntime,
  runtimeRefreshing,
}: {
  onOpenTask: (taskId?: string) => void;
  onNewTask: () => void;
  onSeeAllTasks: () => void;
  onRefreshRuntime: () => void;
  runtimeRefreshing: boolean;
  runtimeTasks: RuntimeTask[];
  runtimeStatus: RuntimeStatus | null;
  runtimeLoading: boolean;
  runtimeError: string | null;
}) {
  const openTasks = runtimeTasks.filter((task) => task.status !== "closed");
  const recentTasks = [...openTasks]
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
    .slice(0, 5);
  const activeRuntimeTask = openTasks.find((task) => task.status === "running") ?? openTasks[0];
  const activeTask = activeRuntimeTask ? runtimeTaskToRecentTask(activeRuntimeTask) : null;
  const completedActiveStages = activeRuntimeTask
    ? workflowStages.filter((stage) => activeRuntimeTask.completedStages.includes(stage.id)).length
    : 0;
  const totalTokens = runtimeTasks.reduce((total, task) => total + task.usage.totalTokens, 0);
  const totalUsage = runtimeTasks.reduce(
    (total, task) => ({
      inputTokens: total.inputTokens + task.usage.inputTokens,
      cachedInputTokens: total.cachedInputTokens + task.usage.cachedInputTokens,
      outputTokens: total.outputTokens + task.usage.outputTokens,
      cost: total.cost + (task.usage.cost ?? 0),
    }),
    { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, cost: 0 },
  );
  const hasCost = runtimeTasks.some((task) => task.usage.cost != null);
  const attentionTasks = runtimeTasks.filter(
    (task) =>
      ["failed", "blocked", "cancelled", "repair-required"].includes(task.status) ||
      isGateStatus(task.status),
  );

  return (
    <div className="page command-centre-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Agent Harness · local workspace</p>
          <h1>Command Centre</h1>
          <p>One deterministic view of active work, evidence, and human decisions.</p>
        </div>
        <button
          type="button"
          className={`health-summary ${runtimeError || (runtimeStatus && !runtimeStatus.authenticated) ? "health-summary--warning" : ""}`}
          aria-label="Local runtime health"
          onClick={onRefreshRuntime}
          title="Refresh local runtime and provider status"
        >
          <ShieldCheck size={18} weight="fill" />
          <span>
            <strong>
              {runtimeError
                ? "Runtime disconnected"
                : runtimeStatus?.authenticated
                ? "Codex connected"
                : runtimeStatus
                  ? "Login required"
                  : runtimeLoading
                    ? "Checking runtime"
                    : "Runtime unavailable"}
            </strong>
            {runtimeError
              ? " · last persisted view unavailable"
              : runtimeStatus?.authenticated
              ? ` · ${runtimeStatus.authMethod} plan session`
              : " · local runtime"}
          </span>
          <ArrowClockwise className={runtimeRefreshing ? "spin" : ""} size={16} />
        </button>
      </header>

      <section className="current-run" aria-labelledby="current-run-title">
        <div className="current-run__main">
          <div className="current-run__status">
            <span className="live-pulse" aria-hidden />
            {activeRuntimeTask ? "Local workflow" : runtimeLoading ? "Loading local workflow" : "Local workflow"}
          </div>
          <h2 id="current-run-title">{activeTask?.title ?? (runtimeError ? "Local companion disconnected" : runtimeLoading ? "Loading persisted tasks…" : "No persisted tasks yet")}</h2>
          <p>
            {activeRuntimeTask
              ? activeRuntimeTask.status === "running"
                ? `The ${activeTask?.stage} agent is inspecting ${activeRuntimeTask.repositoryPath}.`
                : "The latest real local task is ready to inspect."
              : runtimeError
                ? runtimeError
                : runtimeLoading
                  ? "Checking the loopback companion and persisted task store."
                  : "Create a task to start a real ten-stage Evidence Gate workflow."}
          </p>
          {activeTask ? (
            <div className="current-run__meta">
              <span className="mono">{activeTask.id}</span>
              <PriorityBadge priority={activeTask.priority.toLowerCase() as "low" | "medium" | "high"} />
              <ModelStack models={activeTask.models} compact />
              <span>
                <Clock size={15} /> {activeTask.duration}
              </span>
              <span>
                <GitBranch size={15} /> {activeTask.stageRunLabel ?? `${activeTask.stage} run`} {activeTask.stageRun} of {activeTask.stageRunLimit}
              </span>
            </div>
          ) : null}
        </div>
        <div className="current-run__progress">
          <WorkflowProgressRing completed={completedActiveStages} total={workflowStages.length} />
          <div>
            <strong>{activeTask?.stage ?? "Not started"}</strong>
            <span>
              {activeRuntimeTask
                ? activeRuntimeTask.status.replace("-", " ")
                : runtimeLoading
                  ? "Loading"
                  : "No active workflow"}
            </span>
          </div>
        </div>
        <Button tone="primary" icon={ArrowRight} onClick={activeRuntimeTask ? () => onOpenTask(activeRuntimeTask.id) : onNewTask} disabled={runtimeLoading || Boolean(runtimeError)}>
          {activeRuntimeTask ? "Open workspace" : "Create task"}
        </Button>
      </section>

      <div className="command-grid command-grid--stacked">
        <section className="recent-runs recent-runs--full">
          <SectionHeader
            title="Recent tasks"
            description={
              runtimeLoading
                ? "Loading persisted tasks from the local harness"
                : runtimeError
                  ? "The local companion did not return a task list"
                  : "Real tasks persisted by the local harness"
            }
          />
          <TaskTable
            tasks={recentTasks}
            onOpenTask={(taskId) => onOpenTask(taskId)}
            onSeeAll={onSeeAllTasks}
            emptyTitle={runtimeLoading ? "Loading tasks…" : runtimeError ? "Runtime disconnected" : "No tasks persisted"}
            emptyCopy={runtimeError ?? "Create a task to begin a real local workflow."}
          />
        </section>

        <aside className="command-side command-side--split">
          <section className="attention-list">
            <SectionHeader title="Needs attention" />
            {attentionTasks.length ? (
              attentionTasks.slice(0, 10).map((task) => (
                <button
                  type="button"
                  className="attention-row"
                  key={task.id}
                  onClick={() => onOpenTask(task.id)}
                >
                  <span
                    className={`attention-row__icon ${isGateStatus(task.status) ? "attention-row__icon--amber" : ""}`}
                  >
                    {isGateStatus(task.status) ? (
                      <HourglassMedium size={17} />
                    ) : (
                      <Warning size={17} weight="fill" />
                    )}
                  </span>
                  <span>
                    <strong>
                      {task.id} · {isGateStatus(task.status) ? "Workflow gate ready" : "Run needs repair"}
                    </strong>
                    <small>{task.error ?? "Review the investigation handoff"}</small>
                  </span>
                  <ArrowRight size={15} />
                </button>
              ))
            ) : (
              <div className="attention-empty">
                <CheckCircle size={17} weight="fill" />
                <span>
                  <strong>{runtimeLoading ? "Checking persisted tasks" : "No live task needs attention"}</strong>
                  <small>
                    {runtimeLoading
                      ? "Attention states will appear after the local companion responds."
                      : "Failed runs and approvals will appear here."}
                  </small>
                </span>
              </div>
            )}
          </section>

          <section className="usage-summary">
            <SectionHeader title="Usage · local tasks" />
            <div className="usage-line">
              <span>
                <Cpu size={16} /> Agent runs
              </span>
              <strong>
                {runtimeTasks.reduce((total, task) => total + task.artifacts.length, 0)}
              </strong>
              <small>Codex · ChatGPT plan</small>
            </div>
            <div className="usage-line">
              <span>
                <CheckCircle size={16} /> Input / output
              </span>
              <strong>{formatTokenCount(totalUsage.inputTokens)} / {formatTokenCount(totalUsage.outputTokens)}</strong>
              <small>{formatTokenCount(totalTokens)} total reported tokens</small>
            </div>
            <div className="usage-line">
              <span>
                <ShieldCheck size={16} /> Cache rate
              </span>
              <strong className="text-green">{formatCacheRate(totalUsage)}</strong>
              <small>{formatTokenCount(totalUsage.cachedInputTokens)} cached input tokens</small>
            </div>
            <div className="usage-line">
              <span>
                <CurrencyDollar size={16} /> Approx. cost
              </span>
              <strong>{hasCost ? formatApproximateCost(totalUsage.cost) : "Unavailable"}</strong>
              <small>Standard API-rate estimate after cache; ChatGPT plan charge is not exposed</small>
            </div>
            <div className="usage-line">
              <span>
                <Clock size={16} /> Runtime
              </span>
              <strong>{runtimeLoading ? "Checking" : runtimeStatus?.authenticated ? "Ready" : "Offline"}</strong>
              <small>
                {runtimeLoading
                  ? "Contacting the local companion"
                  : runtimeStatus?.authMethod ?? "Start the local companion"}
              </small>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
