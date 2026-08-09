import { useCallback, useEffect, useRef, useState } from "react";
import {
  answerGrillQuestion,
  archiveTask,
  cancelTask,
  closeTask,
  createTask,
  continueTaskToImplementation,
  evaluateTask,
  finishGrill,
  getEvaluationSummary,
  getRuntimeStatus,
  getRuntimeWorktreeInventory,
  getTaskActivity,
  getTaskArtifact,
  getTaskArtifacts,
  getTaskCore,
  getTaskRuns,
  listTasks,
  recordTaskDecision,
  removeRuntimeWorktree,
  runTask,
  runTaskAction,
  updateRuntimeSettings,
  updateTaskWorkflowProfile,
  verifyRuntimePricing,
} from "./api";
import { AgentsScreen } from "./components/AgentsScreen";
import { ChangelogModal } from "./components/ChangelogModal";
import { CommandCentre } from "./components/CommandCentre";
import { TasksScreen } from "./components/LibraryScreens";
import { NewTaskDialog } from "./components/NewTaskDialog";
import { RuntimeTaskWorkspace } from "./components/RuntimeTaskWorkspace";
import { SettingsScreen } from "./components/SettingsScreen";
import { Shell } from "./components/Shell";
import { SkillsScreen } from "./components/SkillsScreen";
import {
  type AgentRoleId,
  type AppScreen,
  type NewTaskDraft,
  type RuntimeEvaluationSummary,
  type RuntimeArtifactMetadata,
  type RuntimeSettings,
  type RuntimeStatus,
  type RuntimeTask,
  type RuntimeTaskCore,
  type RuntimeTaskSummary,
  type StageId,
  workflowStages,
} from "./domain";
import { hostedAtlasPreviewRequested, hostedAtlasPreviewTasks } from "./hostedAtlasPreview";
import { isCurrentRequest } from "./requestIdentity";
import {
  appScreenForRoute,
  changelogRoute as createChangelogRoute,
  type HashRoute,
  type PrimaryRoute,
  parentTaskRoute,
  parseHashRoute,
  serializeHashRoute,
  type TaskRoute,
} from "./routes";

async function refreshTaskEvidence(current: RuntimeTask, core: RuntimeTaskCore): Promise<RuntimeTask> {
  const coreChanged = current.updatedAt !== core.updatedAt;
  const { artifacts: _coreArtifacts, ...coreState } = core;
  if (!coreChanged) return { ...current, ...coreState };

  const [activity, runs, artifactPage] = await Promise.all([
    getTaskActivity(core.id, { limit: 200 }),
    getTaskRuns(core.id, { limit: 200 }),
    getTaskArtifacts(core.id, { limit: 60 }),
  ]);
  const existingArtifacts = new Map(current.artifacts.map((artifact) => [artifact.id, artifact]));
  const newestArtifacts = await Promise.all(artifactPage.items.map(async (metadata) => {
    const existing = existingArtifacts.get(metadata.id);
    if (existing) return { ...existing, ...metadata };
    return getTaskArtifact(core.id, metadata.id);
  }));
  const artifacts = mergeNewestPage(current.artifacts, newestArtifacts, (item) => item.id)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  return {
    ...current,
    ...coreState,
    artifacts,
    events: mergeNewestPage(current.events, activity.items, (item) => item.id),
    runs: mergeNewestPage(current.runs ?? [], runs.items, (item) => item.id),
  };
}

async function hydrateTask(id: string): Promise<RuntimeTask> {
  const [core, activity, runs, artifactPage] = await Promise.all([
    getTaskCore(id),
    getTaskActivity(id, { limit: 200 }),
    getTaskRuns(id, { limit: 200 }),
    getTaskArtifacts(id, { limit: 60 }),
  ]);
  const artifacts = await Promise.all(
    artifactPage.items.map((artifact) => getTaskArtifact(id, artifact.id)),
  );
  return {
    ...core,
    artifacts: artifacts.sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    events: [...activity.items].sort((left, right) => left.at.localeCompare(right.at)),
    runs: [...runs.items].sort((left, right) => (
      left.startedAt ?? left.completedAt ?? ""
    ).localeCompare(right.startedAt ?? right.completedAt ?? "")),
  };
}

function mergeNewestPage<T>(retained: T[], newest: T[], idFor: (item: T) => string) {
  const byId = new Map(retained.map((item) => [idFor(item), item]));
  for (const item of newest) byId.set(idFor(item), item);
  return [...byId.values()];
}

function taskSummaryFromDetail(task: RuntimeTask): RuntimeTaskSummary {
  const { events, runs, worktreeInventory: _worktreeInventory, artifacts, ...core } = task;
  return {
    ...core,
    artifacts: artifacts.map(artifactMetadata),
    artifactCount: artifacts.length,
    eventCount: events.length,
    runCount: runs?.length ?? 0,
  };
}

function artifactMetadata(artifact: RuntimeTask["artifacts"][number]): RuntimeArtifactMetadata {
  const {
    content: _content,
    contextManifest: _contextManifest,
    focusedTest: _focusedTest,
    gateResult: _gateResult,
    freshness: _freshness,
    ...metadata
  } = artifact;
  return metadata;
}

export function App() {
  const hostedPreviewMode = hostedAtlasPreviewRequested();
  const [screen, setScreen] = useState<AppScreen>("command");
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null);
  const [runtimeTasks, setRuntimeTasks] = useState<RuntimeTaskSummary[]>(() =>
    hostedPreviewMode ? hostedAtlasPreviewTasks : [],
  );
  const [runtimeLoading, setRuntimeLoading] = useState(!hostedPreviewMode);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [activeRuntimeTask, setActiveRuntimeTask] = useState<RuntimeTask | null>(null);
  const [activeTaskLoading, setActiveTaskLoading] = useState(false);
  const [evaluationSummary, setEvaluationSummary] = useState<RuntimeEvaluationSummary | null>(null);
  const [viewedStageId, setViewedStageId] = useState<StageId | undefined>();
  const [selectedAgentId, setSelectedAgentId] = useState<AgentRoleId | null>(null);
  const [selectedSkillId, setSelectedSkillId] = useState<StageId | null>(null);
  const [taskRouteDetail, setTaskRouteDetail] = useState<TaskRoute["detail"]>();
  const [currentRoute, setCurrentRoute] = useState<HashRoute>(
    () => parseHashRoute(window.location.hash).route,
  );
  const [runtimeRefreshing, setRuntimeRefreshing] = useState(false);
  const [toast, setToast] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const activeTaskIdentityRef = useRef<string | null>(null);
  const activeTaskRequestRef = useRef(0);
  const activeRuntimeTaskRef = useRef<RuntimeTask | null>(null);

  const showToast = useCallback((tone: "success" | "error", message: string) => {
    setToast({ tone, message });
    window.setTimeout(() => setToast(null), 4_000);
  }, []);

  const refreshTasks = useCallback(async () => {
    if (hostedPreviewMode) {
      setRuntimeTasks(hostedAtlasPreviewTasks);
      return hostedAtlasPreviewTasks;
    }
    const tasks = await listTasks();
    setRuntimeTasks(tasks);
    return tasks;
  }, [hostedPreviewMode]);

  const refreshActiveTask = useCallback(async (id: string) => {
    const requestId = activeTaskRequestRef.current + 1;
    activeTaskRequestRef.current = requestId;
    const requested = { identity: id, generation: requestId };
    const currentTask = activeRuntimeTaskRef.current?.id === id ? activeRuntimeTaskRef.current : null;
    const task = currentTask
      ? await refreshTaskEvidence(currentTask, await getTaskCore(id))
      : await hydrateTask(id);
    if (
      !isCurrentRequest(requested, {
        identity: activeTaskIdentityRef.current,
        generation: activeTaskRequestRef.current,
      })
    )
      return null;
    activeRuntimeTaskRef.current = task;
    setActiveRuntimeTask((current) => ({
      ...task,
      worktreeInventory: current?.id === id ? current.worktreeInventory : [],
    }));
    setRuntimeTasks((tasks) => [taskSummaryFromDetail(task), ...tasks.filter((item) => item.id !== task.id)]);
    const inventory = await getRuntimeWorktreeInventory(id);
    if (
      !isCurrentRequest(requested, {
        identity: activeTaskIdentityRef.current,
        generation: activeTaskRequestRef.current,
      })
    )
      return null;
    const enriched = { ...task, worktreeInventory: inventory.rows };
    activeRuntimeTaskRef.current = enriched;
    setActiveRuntimeTask((current) => (current?.id === id ? enriched : current));
    return enriched;
  }, []);

  useEffect(() => {
    activeRuntimeTaskRef.current = activeRuntimeTask;
  }, [activeRuntimeTask]);

  const navigateToRoute = useCallback((route: HashRoute, replace = false) => {
    const hash = serializeHashRoute(route);
    if (window.location.hash === hash) return;
    if (replace) window.history.replaceState(null, "", hash);
    else window.location.hash = hash;
  }, []);

  useEffect(() => {
    if (hostedPreviewMode) {
      setRuntimeStatus(null);
      setRuntimeTasks(hostedAtlasPreviewTasks);
      setRuntimeError(null);
      setRuntimeLoading(false);
      return;
    }
    let current = true;
    void Promise.allSettled([getRuntimeStatus(), listTasks(), getEvaluationSummary()]).then(
      ([statusResult, tasksResult, evaluationResult]) => {
        if (!current) return;
        if (statusResult.status === "fulfilled") setRuntimeStatus(statusResult.value);
        if (tasksResult.status === "fulfilled") setRuntimeTasks(tasksResult.value);
        if (evaluationResult.status === "fulfilled") setEvaluationSummary(evaluationResult.value);
        const failure =
          statusResult.status === "rejected"
            ? statusResult.reason
            : tasksResult.status === "rejected"
              ? tasksResult.reason
              : null;
        setRuntimeError(
          failure instanceof Error
            ? failure.message
            : failure
              ? "The local Agent Harness runtime is unavailable."
              : null,
        );
        setRuntimeLoading(false);
      },
    );
    return () => {
      current = false;
    };
  }, [hostedPreviewMode]);

  useEffect(() => {
    if (!window.location.hash)
      window.history.replaceState(null, "", serializeHashRoute({ kind: "screen", screen: "command" }));
    const applyRoute = () => {
      const parsed = parseHashRoute(window.location.hash);
      if (!parsed.valid) window.history.replaceState(null, "", serializeHashRoute(parsed.route));
      const route = parsed.route;
      const primaryRoute = route.kind === "changelog" ? route.returnTo : route;
      setCurrentRoute(route);
      setScreen(appScreenForRoute(primaryRoute));
      setSelectedSkillId(primaryRoute.kind === "skill" ? primaryRoute.skillId : null);
      setSelectedAgentId(primaryRoute.kind === "agent" ? primaryRoute.agentId : null);
      if (primaryRoute.kind !== "task") {
        activeTaskIdentityRef.current = null;
        activeTaskRequestRef.current += 1;
        setActiveTaskLoading(false);
        setWorkspaceOpen(false);
        setActiveRuntimeTask(null);
        setViewedStageId(undefined);
        setTaskRouteDetail(undefined);
        return;
      }
      const { taskId, stageId, detail } = primaryRoute;
      activeTaskIdentityRef.current = taskId;
      setViewedStageId(stageId);
      setTaskRouteDetail(detail);
      setWorkspaceOpen(true);
      setActiveTaskLoading(true);
      setActiveRuntimeTask((current) => (current?.id === taskId ? current : null));
      void refreshActiveTask(taskId)
        .catch((error) => {
          if (activeTaskIdentityRef.current !== taskId) return;
          showToast("error", error instanceof Error ? error.message : "The task could not be loaded.");
          navigateToRoute({ kind: "screen", screen: "tasks" });
        })
        .finally(() => setActiveTaskLoading(false));
    };
    applyRoute();
    window.addEventListener("hashchange", applyRoute);
    window.addEventListener("popstate", applyRoute);
    return () => {
      window.removeEventListener("hashchange", applyRoute);
      window.removeEventListener("popstate", applyRoute);
    };
  }, [navigateToRoute, refreshActiveTask, showToast]);

  useEffect(() => {
    const id = activeRuntimeTask?.id;
    if (!id) return;
    const interval = window.setInterval(
      () => void refreshActiveTask(id).catch(() => undefined),
      activeRuntimeTask.status === "running" ? 1_250 : 5_000,
    );
    return () => window.clearInterval(interval);
  }, [activeRuntimeTask?.id, activeRuntimeTask?.status, refreshActiveTask]);

  // The Command Centre and Tasks screen both read runtimeTasks, which the active-task
  // effect above never touches (it only ever writes activeRuntimeTask). Without this,
  // that list is fetched at boot and after mutations only, so a task advancing on its own
  // never shows up until something else forces a refresh. Poll slower than the open-task
  // effect since this covers every task, not just the one being watched closely.
  const anyTaskRunning = runtimeTasks.some((task) => task.status === "running");
  useEffect(() => {
    if (hostedPreviewMode) return;
    // A hidden tab can't show the update anyway, so skip the network call; catch up with
    // one immediate refresh when the tab becomes visible again instead of waiting out the
    // rest of the interval.
    const poll = () => {
      if (document.visibilityState === "hidden") return;
      void refreshTasks().catch(() => undefined);
    };
    const interval = window.setInterval(poll, anyTaskRunning ? 5_000 : 15_000);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") poll();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [anyTaskRunning, hostedPreviewMode, refreshTasks]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (hostedPreviewMode) return;
      if (
        event.key.toLowerCase() === "n" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !(event.target instanceof HTMLInputElement) &&
        !(event.target instanceof HTMLTextAreaElement)
      ) {
        event.preventDefault();
        setNewTaskOpen(true);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [hostedPreviewMode]);

  const navigate = (nextScreen: AppScreen) => navigateToRoute({ kind: "screen", screen: nextScreen });

  const openWorkspace = (from: "command" | "tasks", taskId?: string, stageId?: StageId) => {
    if (hostedPreviewMode) {
      showToast("error", "The hosted atlas is a read-only UI preview. Task execution remains local.");
      return;
    }
    if (taskId)
      navigateToRoute({
        kind: "task",
        taskId,
        stageId,
        returnTo: from === "command" ? "command" : undefined,
      });
  };

  const startTask = async (draft: NewTaskDraft) => {
    const task = await createTask(draft);
    await runTask(task.id);
    setNewTaskOpen(false);
    setRuntimeTasks((tasks) => [taskSummaryFromDetail(task), ...tasks.filter((item) => item.id !== task.id)]);
    navigateToRoute({ kind: "task", taskId: task.id, stageId: task.currentStage });
  };

  const refreshRuntime = async () => {
    setRuntimeRefreshing(true);
    try {
      setRuntimeStatus(await getRuntimeStatus());
      setRuntimeError(null);
      showToast("success", "Runtime status refreshed.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Runtime status could not be refreshed.";
      setRuntimeError(message);
      showToast("error", message);
    } finally {
      setRuntimeRefreshing(false);
    }
  };

  const saveRuntimeSettings = async (
    settings: Pick<RuntimeSettings, "allowedModels" | "defaultModel" | "defaultReasoning" | "stagePolicies" | "profileStagePolicies">
      & Partial<Pick<RuntimeSettings, "grillPolicy">>,
  ) => {
    const saved = await updateRuntimeSettings(settings);
    const [status, evaluation] = await Promise.all([getRuntimeStatus(), getEvaluationSummary()]);
    setRuntimeStatus(status);
    setEvaluationSummary(evaluation);
    setRuntimeError(null);
    return saved;
  };

  const primaryRoute: PrimaryRoute = currentRoute.kind === "changelog" ? currentRoute.returnTo : currentRoute;
  const taskRoute = primaryRoute.kind === "task" ? primaryRoute : null;

  return (
    <div className={`app-shell ${sidebarCollapsed ? "app-shell--collapsed" : ""}`}>
      <Shell
        screen={screen}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
        onNavigate={navigate}
        onNewTask={() => {
          if (hostedPreviewMode)
            showToast("error", "The hosted atlas is a read-only UI preview. Task execution remains local.");
          else setNewTaskOpen(true);
        }}
        onOpenChangelog={() => navigateToRoute(createChangelogRoute(primaryRoute))}
        runtimeStatus={runtimeStatus}
      />
      <main className="app-main">
        {workspaceOpen && activeRuntimeTask ? (
          <RuntimeTaskWorkspace
            key={activeRuntimeTask.id}
            task={activeRuntimeTask}
            initialViewedStageId={viewedStageId}
            onViewedStageChange={(stageId) => {
              setViewedStageId(stageId);
              navigateToRoute({
                ...(taskRoute ?? { kind: "task", taskId: activeRuntimeTask.id }),
                stageId,
                detail: undefined,
              });
            }}
            routeDetail={taskRouteDetail}
            onRouteDetailChange={(detail, stageId) => {
              const baseRoute = taskRoute ?? { kind: "task" as const, taskId: activeRuntimeTask.id };
              navigateToRoute({
                ...parentTaskRoute(baseRoute),
                stageId: stageId ?? baseRoute.stageId ?? activeRuntimeTask.currentStage,
                detail: detail ?? undefined,
              });
            }}
            onBack={() => {
              navigateToRoute({ kind: "screen", screen: taskRoute?.returnTo ?? "tasks" });
              void refreshTasks();
            }}
            onRun={async () => {
              await runTask(activeRuntimeTask.id);
              await refreshActiveTask(activeRuntimeTask.id);
              showToast("success", "Task run started.");
            }}
            onCancel={async () => {
              await cancelTask(activeRuntimeTask.id);
              await refreshActiveTask(activeRuntimeTask.id);
              showToast("success", "Active run cancelled.");
            }}
            onCloseTask={async (reason, note, supersededBy) => {
              const result = await closeTask(activeRuntimeTask.id, reason, note, supersededBy);
              setActiveRuntimeTask(result.task);
              await refreshTasks();
              showToast(
                "success",
                reason === "superseded"
                  ? `Task marked superseded${supersededBy ? ` by ${supersededBy}` : ""}.`
                  : "Task closed as not needed.",
              );
            }}
            onArchiveTask={async () => {
              const result = await archiveTask(activeRuntimeTask.id);
              setActiveRuntimeTask(result.task);
              await refreshTasks();
              // The retained count is the part the operator has to act on, so it leads and it
              // is a warning: those worktrees still hold uncommitted work and still take disk.
              showToast(
                result.retainedWorktrees.length ? "error" : "success",
                result.retainedWorktrees.length
                  ? `Task archived. ${result.retainedWorktrees.length} worktree${result.retainedWorktrees.length === 1 ? "" : "s"} kept — uncommitted work.`
                  : `Task archived.${result.removedWorktrees.length ? ` ${result.removedWorktrees.length} worktree${result.removedWorktrees.length === 1 ? "" : "s"} removed.` : ""}`,
              );
            }}
            onEvaluate={async (score, outcome, notes) => {
              const result = await evaluateTask(activeRuntimeTask.id, score, outcome, notes);
              setActiveRuntimeTask(result.task);
              setEvaluationSummary(await getEvaluationSummary());
              showToast("success", "Task outcome added to the model scorecard.");
            }}
            onAction={async (action, note) => {
              try {
                if (action === "continue-implementation") {
                  const result = await continueTaskToImplementation(activeRuntimeTask.id);
                  setActiveRuntimeTask(result.task);
                  await refreshTasks();
                  navigateToRoute({
                    kind: "task",
                    taskId: result.task.id,
                    stageId: result.task.currentStage,
                  });
                  showToast(
                    "success",
                    result.created
                      ? `${result.task.id} created from the approved investigation; planning started.`
                      : `Opened existing implementation task ${result.task.id}.`,
                  );
                  return;
                }
                await runTaskAction(activeRuntimeTask.id, action, note);
                await refreshActiveTask(activeRuntimeTask.id);
                showToast(
                  "success",
                  action === "grant-retry"
                    ? "One repair attempt was granted. The stage limit is updated."
                    : action === "refresh-candidate"
                      ? "Candidate refreshed from the latest target. All candidate-bound gates must run again."
                    : action === "retry-test"
                      ? "Test retry started against the unchanged candidate revision."
                    : action === "repair"
                      ? "Repair started. Downstream gates now require fresh evidence."
                      : action === "complete-merged"
                        ? "Task marked completed."
                        : "Task action completed.",
                );
                if (["repair", "implement", "review", "test", "retry-test", "final-review"].includes(action)) {
                  window.setTimeout(() => {
                    void getTaskCore(activeRuntimeTask.id)
                      .then((latest) => {
                        if (["failed", "blocked"].includes(latest.status) && latest.error) {
                          showToast("error", `${latest.currentStage} stopped: ${latest.error}`);
                          void refreshActiveTask(latest.id);
                        }
                      })
                      .catch(() => undefined);
                  }, 1_000);
                }
              } catch (error) {
                const message = error instanceof Error ? error.message : "The task action failed.";
                showToast("error", message);
                throw error;
              }
            }}
            onDecision={async (question, answer) => {
              await recordTaskDecision(activeRuntimeTask.id, question, answer);
              await refreshActiveTask(activeRuntimeTask.id);
              showToast("success", "Decision recorded.");
            }}
            onGrillAnswer={async (questionId, answer) => {
              await answerGrillQuestion(activeRuntimeTask.id, questionId, answer);
              await refreshActiveTask(activeRuntimeTask.id);
              showToast("success", "Grill answer recorded.");
            }}
            onFinishGrill={async (acceptRemaining) => {
              await finishGrill(activeRuntimeTask.id, acceptRemaining);
              await refreshActiveTask(activeRuntimeTask.id);
              showToast("success", "Grill completed; specification run started.");
            }}
            onRemoveWorktree={async (rowId) => {
              try {
                await removeRuntimeWorktree(activeRuntimeTask.id, rowId);
                await refreshActiveTask(activeRuntimeTask.id);
                showToast("success", "Worktree removed.");
              } catch (error) {
                showToast(
                  "error",
                  error instanceof Error ? error.message : "The worktree could not be removed.",
                );
                throw error;
              }
            }}
            onProfileChange={async (profile, reason) => {
              try {
                const updated = await updateTaskWorkflowProfile(activeRuntimeTask.id, profile, reason);
                setActiveRuntimeTask(updated);
                setRuntimeTasks((tasks) => tasks.map((task) => task.id === updated.id ? taskSummaryFromDetail(updated) : task));
                showToast("success", `Workflow profile changed to ${profile}.`);
              } catch (error) {
                const message = error instanceof Error ? error.message : "The workflow profile could not be changed.";
                showToast("error", message);
                throw error;
              }
            }}
          />
        ) : workspaceOpen && activeTaskLoading ? (
          <TaskWorkspaceSkeleton />
        ) : null}
        {!workspaceOpen && screen === "command" ? (
          <CommandCentre
            previewMode={hostedPreviewMode}
            runtimeTasks={runtimeTasks}
            runtimeStatus={runtimeStatus}
            runtimeLoading={runtimeLoading}
            runtimeError={runtimeError}
            onNewTask={() => {
              if (hostedPreviewMode)
                showToast(
                  "error",
                  "The hosted atlas is a read-only UI preview. Task execution remains local.",
                );
              else setNewTaskOpen(true);
            }}
            onOpenTask={(taskId, stageId) => openWorkspace("command", taskId, stageId)}
            onSeeAllTasks={() => navigate("tasks")}
          />
        ) : null}
        {!workspaceOpen && screen === "tasks" ? (
          <TasksScreen
            runtimeTasks={runtimeTasks}
            onOpenTask={(taskId, stageId) => openWorkspace("tasks", taskId, stageId)}
          />
        ) : null}
        {!workspaceOpen && screen === "skills" ? (
          <SkillsScreen
            runtimeTasks={runtimeTasks}
            selectedId={selectedSkillId}
            onSelect={(skillId) =>
              navigateToRoute(skillId ? { kind: "skill", skillId } : { kind: "screen", screen: "skills" })
            }
          />
        ) : null}
        {!workspaceOpen && screen === "agents" ? (
          <AgentsScreen
            runtimeTasks={runtimeTasks}
            runtimeStatus={runtimeStatus}
            selectedId={selectedAgentId}
            onSelect={(agentId) =>
              navigateToRoute(agentId ? { kind: "agent", agentId } : { kind: "screen", screen: "agents" })
            }
            onSave={saveRuntimeSettings}
          />
        ) : null}
        {!workspaceOpen && screen === "settings" ? (
          <SettingsScreen
            runtimeStatus={runtimeStatus}
            evaluationSummary={evaluationSummary}
            onRefresh={refreshRuntime}
            onSave={saveRuntimeSettings}
            onVerifyPricing={async () => {
              const result = await verifyRuntimePricing();
              await refreshRuntime();
              showToast(
                "success",
                `Pricing verified with ${result.usage.totalTokens.toLocaleString()} agent tokens.`,
              );
            }}
            refreshing={runtimeRefreshing}
          />
        ) : null}
      </main>
      <NewTaskDialog
        open={newTaskOpen}
        defaultRepository={runtimeStatus?.suggestedRepository ?? ""}
        runtimeStatus={runtimeStatus}
        onClose={() => setNewTaskOpen(false)}
        onStart={startTask}
      />
      {currentRoute.kind === "changelog" ? (
        <ChangelogModal
          commitSha={currentRoute.commitSha}
          filePath={currentRoute.filePath}
          onClose={() => navigateToRoute(currentRoute.returnTo)}
          onSelectCommit={(commitSha) =>
            navigateToRoute(createChangelogRoute(currentRoute.returnTo, commitSha))
          }
          onSelectFile={(filePath) =>
            navigateToRoute(createChangelogRoute(currentRoute.returnTo, currentRoute.commitSha, filePath))
          }
        />
      ) : null}
      {toast ? (
        <div className={`app-toast app-toast--${toast.tone}`} role="status">
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}

function TaskWorkspaceSkeleton() {
  return (
    <div className="task-workspace-skeleton" role="status" aria-label="Loading task details" aria-busy="true">
      <header>
        <span />
        <div>
          <i />
          <i />
        </div>
        <span />
      </header>
      <nav>
        {workflowStages.map((stage) => (
          <span key={stage.id} />
        ))}
      </nav>
      <div className="task-workspace-skeleton__grid">
        <main>
          <i />
          <section />
          <section />
        </main>
        <aside>
          <section />
          <section />
          <section />
        </aside>
      </div>
    </div>
  );
}
