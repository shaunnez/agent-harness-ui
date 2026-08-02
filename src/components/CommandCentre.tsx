import {
  ArrowRight,
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
  formatTokenCount,
  type RuntimeStatus,
  type RuntimeTask,
  runtimeTaskToRecentTask,
} from "../domain";
import { Button, ModelStack, PriorityBadge, SectionHeader } from "./Primitives";

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
}: {
  onOpenTask: (taskId?: string) => void;
  onNewTask: () => void;
  runtimeTasks: RuntimeTask[];
  runtimeStatus: RuntimeStatus | null;
  runtimeLoading: boolean;
  runtimeError: string | null;
}) {
  const tasks = runtimeTasks.map(runtimeTaskToRecentTask);
  const activeRuntimeTask = runtimeTasks.find((task) => task.status === "running") ?? runtimeTasks[0];
  const activeTask = activeRuntimeTask ? runtimeTaskToRecentTask(activeRuntimeTask) : null;
  const totalTokens = runtimeTasks.reduce((total, task) => total + task.usage.totalTokens, 0);
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
        <div
          className={`health-summary ${runtimeError || (runtimeStatus && !runtimeStatus.authenticated) ? "health-summary--warning" : ""}`}
          role="status"
          aria-label="Local runtime health"
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
        </div>
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
                <GitBranch size={15} /> {activeTask.stage} run {activeTask.stageRun} of {activeTask.stageRunLimit}
              </span>
            </div>
          ) : null}
        </div>
        <div className="current-run__progress">
          <div
            className="progress-ring"
            role="progressbar"
            aria-label="Workflow progress"
            aria-valuemin={0}
            aria-valuemax={10}
            aria-valuenow={activeTask ? activeTask.stageIndex + 1 : 0}
          >
            <span>{activeTask ? activeTask.stageIndex + 1 : 0}/10</span>
          </div>
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

      <div className="command-grid">
        <section className="recent-runs">
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
          <div className="task-table">
            <div className="task-table__header">
              <span>Task</span>
              <span>Status</span>
              <span>Stage</span>
              <span>Tokens</span>
              <span>Approx. cost</span>
              <span>Models</span>
            </div>
            {tasks.map((task) => (
              <button
                className="task-table__row"
                type="button"
                key={task.id}
                onClick={() => onOpenTask(task.id.startsWith("AH-") ? task.id : undefined)}
              >
                <span className="task-table__title">
                  <span className="mono">{task.id}</span>
                  <strong>{task.title}</strong>
                  <PriorityBadge priority={task.priority.toLowerCase() as "low" | "medium" | "high"} />
                </span>
                <span>
                  <span className={`status-dot status-dot--${task.status.toLowerCase().replace(" ", "-")}`} />
                  {task.status}
                </span>
                <span>{task.stage}</span>
                <span className="mono">{task.tokens}</span>
                <span
                  className="mono"
                  title={
                    task.cost === "Plan"
                      ? "ChatGPT plan usage does not expose a per-task dollar charge"
                      : "Estimate from configured rates"
                  }
                >
                  {task.cost}
                </span>
                <ModelStack models={task.models} compact />
              </button>
            ))}
            {!tasks.length ? (
              <div className="task-table__empty">
                <strong>{runtimeLoading ? "Loading tasks…" : runtimeError ? "Runtime disconnected" : "No tasks persisted"}</strong>
                <small>{runtimeError ?? "Create a task to begin a real local workflow."}</small>
              </div>
            ) : null}
          </div>
        </section>

        <aside className="command-side">
          <section className="attention-list">
            <SectionHeader title="Needs attention" />
            {attentionTasks.length ? (
              attentionTasks.slice(0, 2).map((task) => (
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
                <CheckCircle size={16} /> Tokens
              </span>
              <strong>{formatTokenCount(totalTokens)}</strong>
              <small>Reported by Codex sessions</small>
            </div>
            <div className="usage-line">
              <span>
                <CurrencyDollar size={16} /> Approx. cost
              </span>
              <strong>Plan</strong>
              <small>Dollar cost unavailable for plan usage</small>
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
