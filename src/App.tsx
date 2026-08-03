import { useCallback, useEffect, useRef, useState } from "react";
import {
  answerGrillQuestion,
  cancelTask,
  closeTask,
  createTask,
  evaluateTask,
  finishGrill,
  getEvaluationSummary,
  getRuntimeStatus,
  getRuntimeWorktreeInventory,
  getTask,
  listTasks,
  recordTaskDecision,
  runTask,
  runTaskAction,
  updateRuntimeSettings,
  verifyRuntimePricing,
} from "./api";
import { CommandCentre } from "./components/CommandCentre";
import { ChangelogModal } from "./components/ChangelogModal";
import { AgentsScreen } from "./components/AgentsScreen";
import { TasksScreen } from "./components/LibraryScreens";
import { SettingsScreen } from "./components/SettingsScreen";
import { SkillsScreen } from "./components/SkillsScreen";
import { NewTaskDialog } from "./components/NewTaskDialog";
import { RuntimeTaskWorkspace } from "./components/RuntimeTaskWorkspace";
import { Shell } from "./components/Shell";
import {
  type AppScreen,
  type AgentRoleId,
  type NewTaskDraft,
  type RuntimeEvaluationSummary,
  type RuntimeSettings,
  type RuntimeStatus,
  type RuntimeTask,
  type StageId,
  workflowStages,
} from "./domain";
import {
  appScreenForRoute,
  changelogRoute as createChangelogRoute,
  parseHashRoute,
  parentTaskRoute,
  serializeHashRoute,
  type HashRoute,
  type PrimaryRoute,
  type TaskRoute,
} from "./routes";
import { isCurrentRequest } from "./requestIdentity";

export function App() {
  const [screen, setScreen] = useState<AppScreen>("command");
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null);
  const [runtimeTasks, setRuntimeTasks] = useState<RuntimeTask[]>([]);
  const [runtimeLoading, setRuntimeLoading] = useState(true);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [activeRuntimeTask, setActiveRuntimeTask] = useState<RuntimeTask | null>(null);
  const [activeTaskLoading, setActiveTaskLoading] = useState(false);
  const [evaluationSummary, setEvaluationSummary] = useState<RuntimeEvaluationSummary | null>(null);
  const [viewedStageId, setViewedStageId] = useState<StageId | undefined>();
  const [selectedAgentId, setSelectedAgentId] = useState<AgentRoleId | null>(null);
  const [selectedSkillId, setSelectedSkillId] = useState<StageId | null>(null);
  const [taskRouteDetail, setTaskRouteDetail] = useState<TaskRoute["detail"]>();
  const [currentRoute, setCurrentRoute] = useState<HashRoute>(() => parseHashRoute(window.location.hash).route);
  const [runtimeRefreshing, setRuntimeRefreshing] = useState(false);
  const [toast, setToast] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const activeTaskIdentityRef = useRef<string | null>(null);
  const activeTaskRequestRef = useRef(0);

  const showToast = useCallback((tone: "success" | "error", message: string) => {
    setToast({ tone, message });
    window.setTimeout(() => setToast(null), 4_000);
  }, []);

  const refreshTasks = useCallback(async () => {
    const tasks = await listTasks();
    setRuntimeTasks(tasks);
    return tasks;
  }, []);

  const refreshActiveTask = useCallback(async (id: string) => {
    const requestId = activeTaskRequestRef.current + 1;
    activeTaskRequestRef.current = requestId;
    const requested = { identity: id, generation: requestId };
    const task = await getTask(id);
    if (!isCurrentRequest(requested, { identity: activeTaskIdentityRef.current, generation: activeTaskRequestRef.current })) return null;
    setActiveRuntimeTask((current) => ({ ...task, worktreeInventory: current?.id === id ? current.worktreeInventory : [] }));
    setRuntimeTasks((tasks) => [task, ...tasks.filter((item) => item.id !== task.id)]);
    const inventory = await getRuntimeWorktreeInventory(id);
    if (!isCurrentRequest(requested, { identity: activeTaskIdentityRef.current, generation: activeTaskRequestRef.current })) return null;
    const enriched = { ...task, worktreeInventory: inventory.rows };
    setActiveRuntimeTask((current) => current?.id === id ? enriched : current);
    return enriched;
  }, []);

  const navigateToRoute = useCallback((route: HashRoute, replace = false) => {
    const hash = serializeHashRoute(route);
    if (window.location.hash === hash) return;
    if (replace) window.history.replaceState(null, "", hash);
    else window.location.hash = hash;
  }, []);

  useEffect(() => {
    let current = true;
    void Promise.allSettled([getRuntimeStatus(), listTasks(), getEvaluationSummary()]).then(([statusResult, tasksResult, evaluationResult]) => {
      if (!current) return;
      if (statusResult.status === "fulfilled") setRuntimeStatus(statusResult.value);
      if (tasksResult.status === "fulfilled") setRuntimeTasks(tasksResult.value);
      if (evaluationResult.status === "fulfilled") setEvaluationSummary(evaluationResult.value);
      const failure = statusResult.status === "rejected" ? statusResult.reason : tasksResult.status === "rejected" ? tasksResult.reason : null;
      setRuntimeError(failure instanceof Error ? failure.message : failure ? "The local Agent Harness runtime is unavailable." : null);
      setRuntimeLoading(false);
    });
    return () => { current = false; };
  }, []);

  useEffect(() => {
    if (!window.location.hash) window.history.replaceState(null, "", serializeHashRoute({ kind: "screen", screen: "command" }));
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
      setActiveRuntimeTask((current) => current?.id === taskId ? current : null);
      void refreshActiveTask(taskId).catch((error) => {
        if (activeTaskIdentityRef.current !== taskId) return;
        showToast("error", error instanceof Error ? error.message : "The task could not be loaded.");
        navigateToRoute({ kind: "screen", screen: "tasks" });
      }).finally(() => setActiveTaskLoading(false));
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

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "n" && !event.metaKey && !event.ctrlKey && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
        setNewTaskOpen(true);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  const navigate = (nextScreen: AppScreen) => navigateToRoute({ kind: "screen", screen: nextScreen });

  const openWorkspace = (from: "command" | "tasks", taskId?: string) => {
    if (taskId) navigateToRoute({ kind: "task", taskId, returnTo: from === "command" ? "command" : undefined });
  };

  const startTask = async (draft: NewTaskDraft) => {
    const task = await createTask(draft);
    await runTask(task.id);
    setNewTaskOpen(false);
    setRuntimeTasks((tasks) => [task, ...tasks.filter((item) => item.id !== task.id)]);
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
    settings: Pick<RuntimeSettings, "allowedModels" | "defaultModel" | "defaultReasoning" | "stagePolicies">,
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
      <Shell screen={screen} collapsed={sidebarCollapsed} onToggleCollapsed={() => setSidebarCollapsed((value) => !value)} onNavigate={navigate} onNewTask={() => setNewTaskOpen(true)} onOpenChangelog={() => navigateToRoute(createChangelogRoute(primaryRoute))} runtimeStatus={runtimeStatus} />
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
            onRun={async () => { await runTask(activeRuntimeTask.id); await refreshActiveTask(activeRuntimeTask.id); showToast("success", "Task run started."); }}
            onCancel={async () => { await cancelTask(activeRuntimeTask.id); await refreshActiveTask(activeRuntimeTask.id); showToast("success", "Active run cancelled."); }}
            onCloseTask={async (reason, note, supersededBy) => {
              const result = await closeTask(activeRuntimeTask.id, reason, note, supersededBy);
              setActiveRuntimeTask(result.task);
              await refreshTasks();
              showToast("success", reason === "superseded" ? `Task marked superseded${supersededBy ? ` by ${supersededBy}` : ""}.` : "Task closed as not needed.");
            }}
            onEvaluate={async (score, outcome, notes) => {
              const result = await evaluateTask(activeRuntimeTask.id, score, outcome, notes);
              setActiveRuntimeTask(result.task);
              setEvaluationSummary(await getEvaluationSummary());
              showToast("success", "Task outcome added to the model scorecard.");
            }}
            onAction={async (action, note) => {
              try {
                await runTaskAction(activeRuntimeTask.id, action, note);
                await refreshActiveTask(activeRuntimeTask.id);
                showToast("success", action === "grant-retry" ? "One repair attempt was granted. The stage limit is updated." : action === "repair" ? "Repair started. Downstream gates now require fresh evidence." : "Task action completed.");
                if (["repair", "implement", "review", "test", "final-review"].includes(action)) {
                  window.setTimeout(() => {
                    void getTask(activeRuntimeTask.id).then((latest) => {
                      if (["failed", "blocked"].includes(latest.status) && latest.error) {
                        showToast("error", `${latest.currentStage} stopped: ${latest.error}`);
                        void refreshActiveTask(latest.id);
                      }
                    }).catch(() => undefined);
                  }, 1_000);
                }
              } catch (error) {
                const message = error instanceof Error ? error.message : "The task action failed.";
                showToast("error", message);
                throw error;
              }
            }}
            onDecision={async (question, answer) => { await recordTaskDecision(activeRuntimeTask.id, question, answer); await refreshActiveTask(activeRuntimeTask.id); showToast("success", "Decision recorded."); }}
            onGrillAnswer={async (questionId, answer) => { await answerGrillQuestion(activeRuntimeTask.id, questionId, answer); await refreshActiveTask(activeRuntimeTask.id); showToast("success", "Grill answer recorded."); }}
            onFinishGrill={async (acceptRemaining) => { await finishGrill(activeRuntimeTask.id, acceptRemaining); await refreshActiveTask(activeRuntimeTask.id); showToast("success", "Grill completed; specification run started."); }}
          />
        ) : workspaceOpen && activeTaskLoading ? <TaskWorkspaceSkeleton /> : null}
        {!workspaceOpen && screen === "command" ? <CommandCentre runtimeTasks={runtimeTasks} runtimeStatus={runtimeStatus} runtimeLoading={runtimeLoading} runtimeError={runtimeError} onNewTask={() => setNewTaskOpen(true)} onOpenTask={(taskId) => openWorkspace("command", taskId)} onSeeAllTasks={() => navigate("tasks")} onRefreshRuntime={() => void refreshRuntime()} runtimeRefreshing={runtimeRefreshing} /> : null}
        {!workspaceOpen && screen === "tasks" ? <TasksScreen runtimeTasks={runtimeTasks} onOpenTask={(taskId) => openWorkspace("tasks", taskId)} /> : null}
        {!workspaceOpen && screen === "skills" ? <SkillsScreen runtimeTasks={runtimeTasks} selectedId={selectedSkillId} onSelect={(skillId) => navigateToRoute(skillId ? { kind: "skill", skillId } : { kind: "screen", screen: "skills" })} /> : null}
        {!workspaceOpen && screen === "agents" ? (
          <AgentsScreen
            runtimeTasks={runtimeTasks}
            runtimeStatus={runtimeStatus}
            selectedId={selectedAgentId}
            onSelect={(agentId) => navigateToRoute(agentId ? { kind: "agent", agentId } : { kind: "screen", screen: "agents" })}
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
      <NewTaskDialog open={newTaskOpen} defaultRepository={runtimeStatus?.suggestedRepository ?? ""} runtimeStatus={runtimeStatus} onClose={() => setNewTaskOpen(false)} onStart={startTask} />
      {currentRoute.kind === "changelog" ? (
        <ChangelogModal
          commitSha={currentRoute.commitSha}
          filePath={currentRoute.filePath}
          onClose={() => navigateToRoute(currentRoute.returnTo)}
          onSelectCommit={(commitSha) => navigateToRoute(createChangelogRoute(currentRoute.returnTo, commitSha))}
          onSelectFile={(filePath) => navigateToRoute(createChangelogRoute(currentRoute.returnTo, currentRoute.commitSha, filePath))}
        />
      ) : null}
      {toast ? <div className={`app-toast app-toast--${toast.tone}`} role="status">{toast.message}</div> : null}
    </div>
  );
}

function TaskWorkspaceSkeleton() {
  return (
    <div className="task-workspace-skeleton" role="status" aria-label="Loading task details" aria-busy="true">
      <header><span /><div><i /><i /></div><span /></header>
      <nav>{workflowStages.map((stage) => <span key={stage.id} />)}</nav>
      <div className="task-workspace-skeleton__grid">
        <main><i /><section /><section /></main>
        <aside><section /><section /><section /></aside>
      </div>
    </div>
  );
}
