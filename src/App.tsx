import { useCallback, useEffect, useState } from "react";
import { cancelTask, createTask, getRuntimeStatus, getTask, listTasks, runTask } from "./api";
import { CommandCentre } from "./components/CommandCentre";
import { AgentsScreen, SettingsScreen, SkillsScreen, TasksScreen } from "./components/LibraryScreens";
import { NewTaskDialog } from "./components/NewTaskDialog";
import { RuntimeTaskWorkspace } from "./components/RuntimeTaskWorkspace";
import { Shell } from "./components/Shell";
import { TaskWorkspace } from "./components/TaskWorkspace";
import {
  type AppScreen,
  EXAMPLE_DESCRIPTION,
  EXAMPLE_TITLE,
  type NewTaskDraft,
  type RuntimeStatus,
  type RuntimeTask,
} from "./domain";

export function App() {
  const [screen, setScreen] = useState<AppScreen>("command");
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [workspaceKey] = useState(0);
  const [initialStage, setInitialStage] = useState(5);
  const [returnScreen, setReturnScreen] = useState<AppScreen>("command");
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null);
  const [runtimeTasks, setRuntimeTasks] = useState<RuntimeTask[]>([]);
  const [activeRuntimeTask, setActiveRuntimeTask] = useState<RuntimeTask | null>(null);
  const [taskDraft, setTaskDraft] = useState<NewTaskDraft>({
    title: EXAMPLE_TITLE,
    description: EXAMPLE_DESCRIPTION,
    repositoryPath: "",
    workflow: "investigate",
    priority: "medium",
  });

  const refreshTasks = useCallback(async () => {
    const tasks = await listTasks();
    setRuntimeTasks(tasks);
    return tasks;
  }, []);

  useEffect(() => {
    void Promise.allSettled([getRuntimeStatus().then(setRuntimeStatus), refreshTasks()]);
  }, [refreshTasks]);

  useEffect(() => {
    const id = activeRuntimeTask?.id;
    if (!id) return;
    const refresh = async () => {
      try {
        const task = await getTask(id);
        setActiveRuntimeTask(task);
        setRuntimeTasks((tasks) => [task, ...tasks.filter((item) => item.id !== task.id)]);
      } catch {
        // Keep the last good task snapshot while the local runtime restarts.
      }
    };
    const interval = window.setInterval(refresh, activeRuntimeTask.status === "running" ? 1_250 : 5_000);
    return () => window.clearInterval(interval);
  }, [activeRuntimeTask?.id, activeRuntimeTask?.status]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
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
  }, []);

  const navigate = (nextScreen: AppScreen) => {
    setScreen(nextScreen);
    setWorkspaceOpen(false);
    setActiveRuntimeTask(null);
  };

  const openWorkspace = (from: "command" | "tasks", taskId?: string) => {
    setReturnScreen(from);
    setScreen("tasks");
    const runtimeTask = taskId ? (runtimeTasks.find((task) => task.id === taskId) ?? null) : null;
    setActiveRuntimeTask(runtimeTask);
    setInitialStage(5);
    setTaskDraft({
      title: EXAMPLE_TITLE,
      description: EXAMPLE_DESCRIPTION,
      repositoryPath: runtimeStatus?.suggestedRepository ?? "",
      workflow: "investigate",
      priority: "medium",
    });
    setWorkspaceOpen(true);
  };

  const startTask = async (draft: NewTaskDraft) => {
    const task = await createTask(draft);
    await runTask(task.id);
    setNewTaskOpen(false);
    setScreen("tasks");
    setReturnScreen("tasks");
    setTaskDraft(draft);
    setActiveRuntimeTask({ ...task, status: "running" });
    setRuntimeTasks((tasks) => [task, ...tasks.filter((item) => item.id !== task.id)]);
    setWorkspaceOpen(true);
  };

  return (
    <div className={`app-shell ${sidebarCollapsed ? "app-shell--collapsed" : ""}`}>
      <Shell
        screen={screen}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
        onNavigate={navigate}
        onNewTask={() => setNewTaskOpen(true)}
        runtimeStatus={runtimeStatus}
      />
      <main className="app-main">
        {workspaceOpen ? (
          activeRuntimeTask ? (
            <RuntimeTaskWorkspace
              task={activeRuntimeTask}
              onBack={() => {
                setScreen(returnScreen);
                setWorkspaceOpen(false);
                setActiveRuntimeTask(null);
                void refreshTasks();
              }}
              onRun={async () => {
                await runTask(activeRuntimeTask.id);
                setActiveRuntimeTask({ ...activeRuntimeTask, status: "running", error: null });
              }}
              onCancel={async () => {
                await cancelTask(activeRuntimeTask.id);
                setActiveRuntimeTask({
                  ...activeRuntimeTask,
                  status: "cancelled",
                  error: "Codex run cancelled.",
                });
              }}
            />
          ) : (
            <TaskWorkspace
              key={workspaceKey}
              initialStage={initialStage}
              taskTitle={taskDraft.title}
              taskDescription={taskDraft.description}
              taskPriority={taskDraft.priority}
              onBack={() => {
                setScreen(returnScreen);
                setWorkspaceOpen(false);
              }}
            />
          )
        ) : null}
        {!workspaceOpen && screen === "command" ? (
          <CommandCentre
            runtimeTasks={runtimeTasks}
            runtimeStatus={runtimeStatus}
            onOpenTask={(taskId) => openWorkspace("command", taskId)}
          />
        ) : null}
        {!workspaceOpen && screen === "tasks" ? (
          <TasksScreen runtimeTasks={runtimeTasks} onOpenTask={(taskId) => openWorkspace("tasks", taskId)} />
        ) : null}
        {!workspaceOpen && screen === "skills" ? <SkillsScreen /> : null}
        {!workspaceOpen && screen === "agents" ? <AgentsScreen /> : null}
        {!workspaceOpen && screen === "settings" ? <SettingsScreen /> : null}
      </main>
      <NewTaskDialog
        open={newTaskOpen}
        defaultRepository={runtimeStatus?.suggestedRepository ?? ""}
        runtimeStatus={runtimeStatus}
        onClose={() => setNewTaskOpen(false)}
        onStart={startTask}
      />
    </div>
  );
}
