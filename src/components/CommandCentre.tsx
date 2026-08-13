import {
  ArrowRight,
  CheckCircle,
  Clock,
  Cpu,
  CurrencyDollar,
  FileCode,
  GitBranch,
  HourglassMedium,
  ShieldCheck,
  Warning,
} from "@phosphor-icons/react";
import { useState } from "react";
import {
  formatApproximateCost,
  formatCacheRate,
  formatTaskDate,
  formatTokenCount,
  type RuntimeStatus,
  type RuntimeTaskSummary,
  runtimeTaskToRecentTask,
  type StageId,
  workflowStages,
} from "../domain";
import { hostedAtlasMapRequested } from "../hostedAtlasPreview";
import { type AtlasView, AtlasViewSwitch } from "./atlas/AtlasViewSwitch";
import { type AtlasPreviewState, AtlasStatePreview, WorkflowAtlas } from "./atlas/WorkflowAtlas";
import { Button, ModelStack, PriorityBadge, SectionHeader } from "./Primitives";
import { TaskTable } from "./TaskTable";
import { WorkflowProgressRing } from "./WorkflowProgressRing";

function isGateStatus(status: RuntimeTaskSummary["status"]) {
  return status.startsWith("awaiting-") || status.startsWith("ready-for-");
}

function currentTaskEvidence(task: RuntimeTaskSummary) {
  const stageArtifact = [...task.artifacts]
    .filter((artifact) => artifact.stage === task.currentStage)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  const latestArtifact =
    stageArtifact ??
    [...task.artifacts].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  const batches = new Set((task.workPackages ?? []).map((workPackage) => workPackage.batch));
  const candidate = task.candidates?.at(-1);
  const evidence = [latestArtifact?.name ?? "No handoff artifact yet"];
  if (task.workPackages?.length) {
    evidence.push(
      `${task.workPackages.length} package${task.workPackages.length === 1 ? "" : "s"} / ${batches.size} batch${batches.size === 1 ? "" : "es"}`,
    );
  }
  evidence.push(
    candidate
      ? `${candidate.id} r${candidate.revisionNumber} · ${candidate.status.replaceAll("-", " ")}`
      : "No candidate yet",
  );
  return evidence.join(" · ");
}

export function CommandCentre({
  previewMode = false,
  onOpenTask,
  runtimeTasks,
  runtimeStatus,
  runtimeLoading,
  runtimeError,
  onNewTask,
  onSeeAllTasks,
}: {
  previewMode?: boolean;
  onOpenTask: (taskId: string, stageId?: StageId) => void;
  onNewTask: () => void;
  onSeeAllTasks: () => void;
  runtimeTasks: RuntimeTaskSummary[];
  runtimeStatus: RuntimeStatus | null;
  runtimeLoading: boolean;
  runtimeError: string | null;
}) {
  const [view, setView] = useState<AtlasView>(() =>
    previewMode && hostedAtlasMapRequested() ? "map" : "table",
  );
  const [atlasPreviewState, setAtlasPreviewState] = useState<AtlasPreviewState>("live");
  const [atlasPreviewTransitionKey, setAtlasPreviewTransitionKey] = useState(0);
  // Archived tasks leave every list on this screen, including the attention list — archiving is
  // how an operator says "stop showing me this". The spend totals below deliberately still count
  // them: that money was really spent, and quietly dropping it would misreport the run cost.
  const visibleTasks = runtimeTasks.filter(
    (task) => task.status !== "archived" && !(task.workflow === "investigate" && task.continuedByTaskId),
  );
  const openTasks = visibleTasks.filter((task) => task.status !== "closed");
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
  const attentionTasks = visibleTasks.filter(
    (task) =>
      ["failed", "blocked", "cancelled", "repair-required"].includes(task.status) ||
      isGateStatus(task.status),
  );
  const atlasUpdatedAt = [...openTasks].sort(
    (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  )[0]?.updatedAt;

  const changeAtlasPreviewState = (state: AtlasPreviewState) => {
    setAtlasPreviewState(state);
    if (state === "handoff") setAtlasPreviewTransitionKey((value) => value + 1);
  };

  return (
    <div className={`page command-centre-page ${view === "map" ? "atlas-page" : ""}`}>
      <header className={view === "map" ? "atlas-page__header" : "page-heading"}>
        {view === "map" ? (
          <div className="atlas-page__title">
            <h1>Workflow atlas</h1>
            <span className={`atlas-live ${previewMode ? "atlas-live--preview" : ""}`}>
              <i aria-hidden /> {previewMode ? "Hosted preview" : "Live"}
            </span>
            <span className="atlas-updated">
              {previewMode
                ? "Illustrative task snapshot"
                : `Updated ${formatTaskDate(atlasUpdatedAt ?? null)}`}
            </span>
          </div>
        ) : (
          <div>
            <p className="eyebrow">Agent Harness · local workspace</p>
            <h1>Command Centre</h1>
            <p>One deterministic view of active work, evidence, and human decisions.</p>
          </div>
        )}
        {view === "map" ? (
          <AtlasStatePreview value={atlasPreviewState} onChange={changeAtlasPreviewState} />
        ) : null}
        <AtlasViewSwitch view={view} onChange={setView} />
      </header>
      {view === "map" ? (
        <WorkflowAtlas
          tasks={openTasks}
          loading={runtimeLoading}
          error={runtimeError}
          onOpenTask={onOpenTask}
          onViewAllTasks={onSeeAllTasks}
          readOnly={previewMode}
          previewState={atlasPreviewState}
          previewTransitionKey={atlasPreviewTransitionKey}
        />
      ) : (
        <>
          <section className="current-run" aria-labelledby="current-run-title">
            <div className="current-run__main">
              <div className="current-run__status">
                <span className="live-pulse" aria-hidden />
                {previewMode
                  ? "Hosted UI preview"
                  : activeRuntimeTask
                    ? "Local workflow"
                    : runtimeLoading
                      ? "Loading local workflow"
                      : "Local workflow"}
              </div>
              <h2 id="current-run-title">
                {activeTask?.title ??
                  (runtimeError
                    ? "Local companion disconnected"
                    : runtimeLoading
                      ? "Loading persisted tasks…"
                      : "No persisted tasks yet")}
              </h2>
              <p>
                {previewMode
                  ? "Illustrative task state for reviewing the Courier Rooms interface. Local execution and repository access are unavailable here."
                  : activeRuntimeTask
                    ? activeRuntimeTask.status === "running"
                      ? `The ${activeTask?.stage} agent is inspecting ${activeRuntimeTask.repositoryPath}.`
                      : "The latest real local task is ready to inspect."
                    : runtimeError
                      ? runtimeError
                      : runtimeLoading
                        ? "Checking the loopback companion and persisted task store."
                        : "Create a task to start a real ten-stage Evidence Gate workflow."}
              </p>
              {activeRuntimeTask && activeTask ? (
                <>
                  <div className="current-run__evidence">
                    <FileCode size={15} aria-hidden />
                    <span>{currentTaskEvidence(activeRuntimeTask)}</span>
                  </div>
                  <div className="current-run__meta">
                    <span className="mono">{activeTask.id}</span>
                    <PriorityBadge
                      priority={activeTask.priority.toLowerCase() as "low" | "medium" | "high"}
                    />
                    <ModelStack models={activeTask.models} compact />
                    <span>
                      <Clock size={15} /> {activeTask.duration}
                    </span>
                    <span>
                      <GitBranch size={15} /> {activeTask.stageRunLabel ?? `${activeTask.stage} run`}{" "}
                      {activeTask.stageRun} of {activeTask.stageRunLimit}
                    </span>
                  </div>
                </>
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
            <Button
              tone="primary"
              icon={ArrowRight}
              onClick={activeRuntimeTask ? () => onOpenTask(activeRuntimeTask.id) : onNewTask}
              disabled={previewMode || runtimeLoading || Boolean(runtimeError)}
            >
              {previewMode ? "Preview only" : activeRuntimeTask ? "Open workspace" : "Create task"}
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
                emptyTitle={
                  runtimeLoading
                    ? "Loading tasks…"
                    : runtimeError
                      ? "Runtime disconnected"
                      : "No tasks persisted"
                }
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
                      <span className="attention-row__label">
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
                      <strong>
                        {runtimeLoading ? "Checking persisted tasks" : "No live task needs attention"}
                      </strong>
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
                    {runtimeTasks.reduce(
                      (total, task) => total + (task.runCount ?? task.runs?.length ?? 0),
                      0,
                    )}
                  </strong>
                  <small>Codex · ChatGPT plan</small>
                </div>
                <div className="usage-line">
                  <span>
                    <CheckCircle size={16} /> Input / output
                  </span>
                  <strong>
                    {formatTokenCount(totalUsage.inputTokens)} / {formatTokenCount(totalUsage.outputTokens)}
                  </strong>
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
                  <strong>
                    {runtimeLoading ? "Checking" : runtimeStatus?.authenticated ? "Ready" : "Offline"}
                  </strong>
                  <small>
                    {runtimeLoading
                      ? "Contacting the local companion"
                      : (runtimeStatus?.authMethod ?? "Start the local companion")}
                  </small>
                </div>
              </section>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
