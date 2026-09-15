import type { RuntimeProject } from "../../domain.ts";
import type { WorkspaceChange, WorkspaceHistoryPage } from "../../domain/workspace-history.ts";
import type { TaskSummary } from "./contracts.ts";
import { usageTotals } from "./usage.ts";

export function mergeHistory(items: WorkspaceChange[], page: WorkspaceHistoryPage) {
  return [...new Map([...items, ...page.items].map((item) => [item.sequence, item])).values()].sort(
    (a, b) => a.sequence - b.sequence,
  );
}
export function summarizeBriefing(
  items: WorkspaceChange[],
  from: string,
  through: string,
  tasks: TaskSummary[],
  projects: RuntimeProject[],
) {
  const completedRuns = new Map<string, WorkspaceChange>();
  for (const item of items)
    if (item.kind === "run-completed" && item.run) completedRuns.set(`${item.taskId}:${item.run.id}`, item);
  const within = [...completedRuns.values()].filter(
    (item) =>
      item.run?.completedAt &&
      Date.parse(item.run.completedAt) > Date.parse(from) &&
      Date.parse(item.run.completedAt) <= Date.parse(through),
  );
  const totals = usageTotals(within.map((item) => item.run?.usage));
  const groups = new Map<
    string,
    {
      id: string;
      project: string;
      tasks: Map<string, { id: string; title: string; available: boolean; items: WorkspaceChange[] }>;
    }
  >();
  for (const item of items) {
    const key = item.projectId ?? "unregistered";
    let group = groups.get(key);
    if (!group) {
      group = {
        id: key,
        project:
          projects.find((project) => project.id === item.projectId)?.name ??
          item.projectName ??
          "Unregistered project",
        tasks: new Map(),
      };
      groups.set(key, group);
    }
    const current = tasks.find((task) => task.id === item.taskId);
    let task = group.tasks.get(item.taskId);
    if (!task) {
      task = {
        id: item.taskId,
        title: current?.title ?? item.taskTitle,
        available: Boolean(current),
        items: [],
      };
      group.tasks.set(item.taskId, task);
    }
    task.items.push(item);
  }
  return {
    totals,
    completedRuns: within.length,
    lateRuns: completedRuns.size - within.length,
    groups: [...groups.values()]
      .sort((a, b) => a.project.localeCompare(b.project))
      .map((group) => ({
        id: group.id,
        project: group.project,
        tasks: [...group.tasks.values()].sort((a, b) => a.id.localeCompare(b.id)),
      })),
  };
}
