import { MagnifyingGlass, SlidersHorizontal } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { type RuntimeTask, type StageId, workflowStages } from "../domain";
import { Button, SectionHeader } from "./Primitives";
import { TaskTable } from "./TaskTable";

export function TasksScreen({
  onOpenTask,
  runtimeTasks,
}: {
  onOpenTask: (taskId: string, stageId?: StageId) => void;
  runtimeTasks: RuntimeTask[];
}) {
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [status, setStatus] = useState("open");
  const [stage, setStage] = useState("all");
  const [priority, setPriority] = useState("all");
  const tasks = useMemo(
    () =>
      [...runtimeTasks]
        .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
        .filter((task) => {
          const haystack = [
            task.id,
            task.title,
            task.description,
            task.status,
            task.currentStage,
            task.priority,
            task.repositoryPath,
            ...task.models.map((model) => model.model),
            ...task.artifacts.map((artifact) => artifact.name),
          ]
            .join(" ")
            .toLowerCase();
          // Archived is opt-in, and excluded even from "All statuses": the point of archiving is
          // that the task stops appearing unless it is asked for by name. Only the explicit
          // Archived filter shows them, and it shows nothing else.
          if (task.status === "archived" || status === "archived") {
            if (task.status !== "archived" || status !== "archived") return false;
          }
          const statusMatches =
            status === "all" ||
            (status === "open" && task.status !== "closed") ||
            (status === "attention"
              ? ["failed", "blocked", "cancelled", "repair-required"].includes(task.status)
              : status === "waiting"
                ? task.status.startsWith("awaiting-") || task.status.startsWith("ready-for-")
                : task.status === status);
          return (
            haystack.includes(query.trim().toLowerCase()) &&
            statusMatches &&
            (stage === "all" || task.currentStage === stage) &&
            (priority === "all" || task.priority === priority)
          );
        }),
    [priority, query, runtimeTasks, stage, status],
  );
  const hasFilters =
    Boolean(query.trim()) || !["all", "open"].includes(status) || stage !== "all" || priority !== "all";
  return (
    <div className="page library-page">
      <SectionHeader
        eyebrow="Agent Harness"
        title="Tasks"
        description="Every persisted task, its current gate, dates, real token usage, cache rate, and approximate API-rate cost."
        action={
          <Button
            tone={filtersOpen || hasFilters ? "primary" : "secondary"}
            icon={SlidersHorizontal}
            onClick={() => setFiltersOpen((value) => !value)}
          >
            Filters{hasFilters ? " active" : ""}
          </Button>
        }
      />
      <div className="toolbar">
        <MagnifyingGlass size={18} />
        <input
          aria-label="Search tasks"
          placeholder="Search tasks, IDs, models, repositories, or artifacts…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span>
          {tasks.length} of {runtimeTasks.length} tasks
        </span>
      </div>
      {filtersOpen ? (
        <div className="task-filters">
          <label>
            Status
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="open">Open tasks</option>
              <option value="all">All statuses</option>
              <option value="attention">Needs attention</option>
              <option value="waiting">Waiting for action</option>
              <option value="running">Running</option>
              <option value="completed">Completed</option>
              <option value="closed">Closed</option>
              <option value="archived">Archived</option>
            </select>
          </label>
          <label>
            Stage
            <select value={stage} onChange={(event) => setStage(event.target.value)}>
              <option value="all">All stages</option>
              {workflowStages.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Priority
            <select value={priority} onChange={(event) => setPriority(event.target.value)}>
              <option value="all">All priorities</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>
          <Button
            tone="ghost"
            onClick={() => {
              setQuery("");
              setStatus("open");
              setStage("all");
              setPriority("all");
            }}
            disabled={!hasFilters}
          >
            Clear filters
          </Button>
        </div>
      ) : null}
      <TaskTable
        tasks={tasks}
        onOpenTask={onOpenTask}
        emptyTitle={hasFilters ? "No tasks match these filters" : "No local tasks yet"}
        emptyCopy={
          hasFilters
            ? "Clear one or more filters to broaden the result."
            : "Create a task to begin a real Evidence Gate workflow."
        }
      />
    </div>
  );
}
