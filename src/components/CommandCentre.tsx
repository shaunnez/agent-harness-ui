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
  recentTasks,
  runtimeTaskToRecentTask,
} from "../domain";
import { Button, ModelStack, PriorityBadge, SectionHeader } from "./Primitives";

export function CommandCentre({
  onOpenTask,
  runtimeTasks,
  runtimeStatus,
}: {
  onOpenTask: (taskId?: string) => void;
  runtimeTasks: RuntimeTask[];
  runtimeStatus: RuntimeStatus | null;
}) {
  const tasks = runtimeTasks.length ? runtimeTasks.map(runtimeTaskToRecentTask) : recentTasks;
  const activeRuntimeTask = runtimeTasks.find((task) => task.status === "running") ?? runtimeTasks[0];
  const activeTask = activeRuntimeTask ? runtimeTaskToRecentTask(activeRuntimeTask) : recentTasks[0];
  const totalTokens = runtimeTasks.reduce((total, task) => total + task.usage.totalTokens, 0);
  const attentionTasks = runtimeTasks.filter((task) =>
    ["failed", "blocked", "cancelled", "awaiting-approval"].includes(task.status),
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
          className={`health-summary ${runtimeStatus && !runtimeStatus.authenticated ? "health-summary--warning" : ""}`}
          role="status"
          aria-label="Local runtime health"
        >
          <ShieldCheck size={18} weight="fill" />
          <span>
            <strong>
              {runtimeStatus?.authenticated
                ? "Codex connected"
                : runtimeStatus
                  ? "Login required"
                  : "Checking runtime"}
            </strong>
            {runtimeStatus?.authenticated
              ? ` · ${runtimeStatus.authMethod} plan session`
              : " · local runtime"}
          </span>
        </div>
      </header>

      <section className="current-run" aria-labelledby="current-run-title">
        <div className="current-run__main">
          <div className="current-run__status">
            <span className="live-pulse" aria-hidden />
            {activeRuntimeTask ? "Local workflow" : "Prototype workflow"}
          </div>
          <h2 id="current-run-title">{activeTask?.title}</h2>
          <p>
            {activeRuntimeTask
              ? activeRuntimeTask.status === "running"
                ? `The ${activeTask?.stage} agent is inspecting ${activeRuntimeTask.repositoryPath}.`
                : "The latest real local task is ready to inspect."
              : "Implementation agent is updating schema, routes, UI badges, and deterministic acceptance tests."}
          </p>
          <div className="current-run__meta">
            <span className="mono">{activeTask?.id}</span>
            {activeTask ? (
              <PriorityBadge priority={activeTask.priority.toLowerCase() as "low" | "medium" | "high"} />
            ) : null}
            <ModelStack models={activeTask?.models ?? []} compact />
            <span>
              <Clock size={15} /> {activeTask?.duration}
            </span>
            <span>
              <GitBranch size={15} /> {activeTask?.stage} run {activeTask?.stageRun} of{" "}
              {activeTask?.stageRunLimit}
            </span>
          </div>
        </div>
        <div className="current-run__progress">
          <div
            className="progress-ring"
            role="progressbar"
            aria-label="Workflow progress"
            aria-valuemin={0}
            aria-valuemax={10}
            aria-valuenow={(activeTask?.stageIndex ?? 5) + 1}
          >
            <span>{(activeTask?.stageIndex ?? 5) + 1}/10</span>
          </div>
          <div>
            <strong>{activeTask?.stage}</strong>
            <span>
              {activeRuntimeTask
                ? activeRuntimeTask.status.replace("-", " ")
                : "Patch produced · schema validated"}
            </span>
          </div>
        </div>
        <Button tone="primary" icon={ArrowRight} onClick={() => onOpenTask(activeRuntimeTask?.id)}>
          Open workspace
        </Button>
      </section>

      <div className="command-grid">
        <section className="recent-runs">
          <SectionHeader
            title="Recent tasks"
            description={
              runtimeTasks.length
                ? "Real tasks persisted by the local harness"
                : "Prototype data · create a task to start a real run"
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
                    className={`attention-row__icon ${task.status === "awaiting-approval" ? "attention-row__icon--amber" : ""}`}
                  >
                    {task.status === "awaiting-approval" ? (
                      <HourglassMedium size={17} />
                    ) : (
                      <Warning size={17} weight="fill" />
                    )}
                  </span>
                  <span>
                    <strong>
                      {task.id} ·{" "}
                      {task.status === "awaiting-approval" ? "Artifacts ready" : "Run needs repair"}
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
                  <strong>No live task needs attention</strong>
                  <small>Failed runs and approvals will appear here.</small>
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
                {runtimeTasks.length ? runtimeTasks.reduce((total, task) => total + task.stageRun, 0) : 18}
              </strong>
              <small>{runtimeTasks.length ? "Codex · ChatGPT plan" : "12 Codex · 6 Claude"}</small>
            </div>
            <div className="usage-line">
              <span>
                <CheckCircle size={16} /> Tokens
              </span>
              <strong>{runtimeTasks.length ? formatTokenCount(totalTokens) : "284k"}</strong>
              <small>{runtimeTasks.length ? "Reported by Codex sessions" : "71% cache hit"}</small>
            </div>
            <div className="usage-line">
              <span>
                <CurrencyDollar size={16} /> Approx. cost
              </span>
              <strong>{runtimeTasks.length ? "Plan" : "$6.42"}</strong>
              <small>
                {runtimeTasks.length
                  ? "Dollar cost unavailable for plan usage"
                  : "Estimated · cached rates included"}
              </small>
            </div>
            <div className="usage-line">
              <span>
                <Clock size={16} /> Runtime
              </span>
              <strong>{runtimeStatus?.authenticated ? "Ready" : "Offline"}</strong>
              <small>{runtimeStatus?.authMethod ?? "Start the local companion"}</small>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
