import { useCallback, useEffect, useState } from "react";
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
import { AgentsScreen, SettingsScreen, SkillsScreen, TasksScreen } from "./components/LibraryScreens";
import { NewTaskDialog } from "./components/NewTaskDialog";
import { RuntimeTaskWorkspace } from "./components/RuntimeTaskWorkspace";
import { Shell } from "./components/Shell";
import {
  type AppScreen,
  agentRoleIds,
  type AgentRoleId,
  type NewTaskDraft,
  type RuntimeEvaluationSummary,
  type RuntimeStatus,
  type RuntimeTask,
  type StageId,
  workflowStages,
} from "./domain";

function readHashRoute() {
  const parts = window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const screenPart = parts[0];
  const screen = (screenPart && ["command", "tasks", "skills", "agents", "settings"].includes(screenPart) ? screenPart : "command") as AppScreen;
  const taskId = screen === "tasks" && parts[1] ? decodeURIComponent(parts[1]) : null;
  const agentId = screen === "agents" && parts[1] && agentRoleIds.includes(parts[1] as AgentRoleId) ? (parts[1] as AgentRoleId) : null;
  const stagePart = parts[2];
  const stageId = stagePart && workflowStages.some((stage) => stage.id === stagePart) ? (stagePart as StageId) : null;
  return { screen, taskId, stageId, agentId };
}

function screenHash(screen: AppScreen) {
  return `#/${screen}`;
}

export function App() {
  const [screen, setScreen] = useState<AppScreen>("command");
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [returnScreen, setReturnScreen] = useState<AppScreen>("tasks");
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null);
  const [runtimeTasks, setRuntimeTasks] = useState<RuntimeTask[]>([]);
  const [runtimeLoading, setRuntimeLoading] = useState(true);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [activeRuntimeTask, setActiveRuntimeTask] = useState<RuntimeTask | null>(null);
  const [activeTaskLoading, setActiveTaskLoading] = useState(false);
  const [evaluationSummary, setEvaluationSummary] = useState<RuntimeEvaluationSummary | null>(null);
  const [viewedStageId, setViewedStageId] = useState<StageId | undefined>();
  const [selectedAgentId, setSelectedAgentId] = useState<AgentRoleId | null>(null);
  const [runtimeRefreshing, setRuntimeRefreshing] = useState(false);
  const [toast, setToast] = useState<{ tone: "success" | "error"; message: string } | null>(null);

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
    const task = await getTask(id);
    setActiveRuntimeTask((current) => ({ ...task, worktreeInventory: current?.id === id ? current.worktreeInventory : [] }));
    setRuntimeTasks((tasks) => [task, ...tasks.filter((item) => item.id !== task.id)]);
    const inventory = await getRuntimeWorktreeInventory(id);
    const enriched = { ...task, worktreeInventory: inventory.rows };
    setActiveRuntimeTask((current) => current?.id === id ? enriched : current);
    return enriched;
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
    if (!window.location.hash) window.history.replaceState(null, "", screenHash("command"));
    const applyRoute = () => {
      const route = readHashRoute();
      setScreen(route.screen);
      setViewedStageId(route.stageId ?? undefined);
      setSelectedAgentId(route.agentId);
      if (!route.taskId) {
        setActiveTaskLoading(false);
        setWorkspaceOpen(false);
        setActiveRuntimeTask(null);
        return;
      }
      setWorkspaceOpen(true);
      setActiveTaskLoading(true);
      setActiveRuntimeTask((current) => current?.id === route.taskId ? current : null);
      void refreshActiveTask(route.taskId).catch((error) => {
        showToast("error", error instanceof Error ? error.message : "The task could not be loaded.");
        window.location.hash = screenHash("tasks");
      }).finally(() => setActiveTaskLoading(false));
    };
    applyRoute();
    window.addEventListener("hashchange", applyRoute);
    window.addEventListener("popstate", applyRoute);
    return () => {
      window.removeEventListener("hashchange", applyRoute);
      window.removeEventListener("popstate", applyRoute);
    };
  }, [refreshActiveTask, showToast]);

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

  const navigate = (nextScreen: AppScreen) => { window.location.hash = screenHash(nextScreen); };

  const openWorkspace = (from: "command" | "tasks", taskId?: string) => {
    setReturnScreen(from);
    if (taskId) window.location.hash = `#/tasks/${encodeURIComponent(taskId)}`;
  };

  const startTask = async (draft: NewTaskDraft) => {
    const task = await createTask(draft);
    await runTask(task.id);
    setNewTaskOpen(false);
    setReturnScreen("tasks");
    setRuntimeTasks((tasks) => [task, ...tasks.filter((item) => item.id !== task.id)]);
    window.location.hash = `#/tasks/${encodeURIComponent(task.id)}/${task.currentStage}`;
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

  return (
    <div className={`app-shell ${sidebarCollapsed ? "app-shell--collapsed" : ""}`}>
      <Shell screen={screen} collapsed={sidebarCollapsed} onToggleCollapsed={() => setSidebarCollapsed((value) => !value)} onNavigate={navigate} onNewTask={() => setNewTaskOpen(true)} onOpenChangelog={() => setChangelogOpen(true)} runtimeStatus={runtimeStatus} />
      <main className="app-main">
        {workspaceOpen && activeRuntimeTask ? (
          <RuntimeTaskWorkspace
            key={activeRuntimeTask.id}
            task={activeRuntimeTask}
            initialViewedStageId={viewedStageId}
            onViewedStageChange={(stageId) => {
              setViewedStageId(stageId);
              window.history.pushState(null, "", `#/tasks/${encodeURIComponent(activeRuntimeTask.id)}/${stageId}`);
            }}
            onBack={() => { window.location.hash = screenHash(returnScreen); void refreshTasks(); }}
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
        {!workspaceOpen && screen === "skills" ? <SkillsScreen runtimeTasks={runtimeTasks} /> : null}
        {!workspaceOpen && screen === "agents" ? (
          <AgentsScreen
            runtimeTasks={runtimeTasks}
            runtimeStatus={runtimeStatus}
            selectedId={selectedAgentId}
            onSelect={(agentId) => { window.location.hash = agentId ? `#/agents/${agentId}` : screenHash("agents"); }}
          />
        ) : null}
        {!workspaceOpen && screen === "settings" ? (
          <SettingsScreen
            runtimeStatus={runtimeStatus}
            evaluationSummary={evaluationSummary}
            onRefresh={refreshRuntime}
            onSave={async (settings) => {
              await updateRuntimeSettings(settings);
              await refreshRuntime();
              setEvaluationSummary(await getEvaluationSummary());
              showToast("success", "Model policy saved. New tasks will use the updated defaults.");
            }}
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
      {changelogOpen ? <ChangelogModal onClose={() => setChangelogOpen(false)} /> : null}
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
