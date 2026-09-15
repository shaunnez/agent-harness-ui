import type { RuntimeProject, RuntimeRun, RuntimeTask } from "../src/domain.ts";
import type { WorkspaceChange, WatchRun } from "../src/domain/workspace-history.ts";
export function projectWatchRun(run: RuntimeRun | undefined | null): WatchRun | null;
export function materialCoreChanges(previous: RuntimeTask | null, next: RuntimeTask): Array<Pick<WorkspaceChange, "kind" | "label" | "stage" | "reason">>;
export function workspaceIdentity(task: RuntimeTask, projects: RuntimeProject[]): Pick<WorkspaceChange, "taskId" | "taskTitle" | "projectId" | "projectName" | "stage">;

export function isWatchRunActive(task: RuntimeTask | undefined | null, run: RuntimeRun | WatchRun | undefined | null): boolean;
