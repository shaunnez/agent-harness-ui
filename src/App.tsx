import { useEffect, useState } from "react";
import { CommandCentre } from "./components/CommandCentre";
import { AgentsScreen, SettingsScreen, SkillsScreen, TasksScreen } from "./components/LibraryScreens";
import { NewTaskDialog } from "./components/NewTaskDialog";
import { Shell } from "./components/Shell";
import { TaskWorkspace } from "./components/TaskWorkspace";
import { type AppScreen, EXAMPLE_DESCRIPTION, EXAMPLE_TITLE, type NewTaskDraft } from "./domain";

export function App() {
  const [screen, setScreen] = useState<AppScreen>("tasks");
  const [workspaceOpen, setWorkspaceOpen] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [workspaceKey, setWorkspaceKey] = useState(0);
  const [initialStage, setInitialStage] = useState(5);
  const [returnScreen, setReturnScreen] = useState<AppScreen>("command");
  const [taskDraft, setTaskDraft] = useState<NewTaskDraft>({
    title: EXAMPLE_TITLE,
    description: EXAMPLE_DESCRIPTION,
    workflow: "implement",
    priority: "medium",
  });

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
  };

  const openWorkspace = (from: "command" | "tasks") => {
    setReturnScreen(from);
    setScreen("tasks");
    setInitialStage(5);
    setTaskDraft({
      title: EXAMPLE_TITLE,
      description: EXAMPLE_DESCRIPTION,
      workflow: "implement",
      priority: "medium",
    });
    setWorkspaceOpen(true);
  };

  const startTask = (draft: NewTaskDraft) => {
    setNewTaskOpen(false);
    setScreen("tasks");
    setReturnScreen("tasks");
    setTaskDraft(draft);
    setInitialStage(0);
    setWorkspaceKey((value) => value + 1);
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
      />
      <main className="app-main">
        {workspaceOpen ? (
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
        ) : null}
        {!workspaceOpen && screen === "command" ? (
          <CommandCentre onOpenTask={() => openWorkspace("command")} />
        ) : null}
        {!workspaceOpen && screen === "tasks" ? (
          <TasksScreen onOpenTask={() => openWorkspace("tasks")} />
        ) : null}
        {!workspaceOpen && screen === "skills" ? <SkillsScreen /> : null}
        {!workspaceOpen && screen === "agents" ? <AgentsScreen /> : null}
        {!workspaceOpen && screen === "settings" ? <SettingsScreen /> : null}
      </main>
      <NewTaskDialog open={newTaskOpen} onClose={() => setNewTaskOpen(false)} onStart={startTask} />
    </div>
  );
}
