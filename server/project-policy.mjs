import path from "node:path";

const TERMINAL = new Set(["completed", "closed", "archived"]);

/** A research project has no repository. It carries this sentinel in `repositoryPath` so every
 *  project keeps one stable identity field, and every route that validates a repository refuses
 *  it by prefix. */
export const RESEARCH_REPOSITORY_PREFIX = "research://";

export function isResearchRepositoryPath(value) {
  return typeof value === "string" && value.startsWith(RESEARCH_REPOSITORY_PREFIX);
}

/** Projects saved before `kind` existed are delivery projects. */
export function projectKindOf(project) {
  return project?.kind === "research" ? "research" : "delivery";
}

export function withProjectKind(project) {
  return { ...project, kind: projectKindOf(project) };
}

export function assertProjectAcceptsTask(settings, repositoryPath) {
  const project = (settings.projects ?? []).find(
    (item) => path.resolve(item.repositoryPath) === path.resolve(repositoryPath),
  );
  if (project?.archivedAt)
    throw conflict("PROJECT_ARCHIVED", `Restore ${project.name} before creating another task.`);
}

export function changeProject(projects, tasks, id, change) {
  const project = projects.find((item) => item.id === id);
  if (!project) return null;
  if (change.kind === "rename") {
    const name = String(change.name ?? "").trim();
    if (!name || name.length > 120) throw new Error("Project name must be between 1 and 120 characters.");
    if (projects.some((item) => item.id !== id && item.name.trim().toLowerCase() === name.toLowerCase()))
      throw new Error("A project with that name already exists.");
    project.name = name;
  } else if (change.kind === "archive") {
    const blocked = tasks.find(
      (task) =>
        path.resolve(task.repositoryPath) === path.resolve(project.repositoryPath) &&
        (!TERMINAL.has(task.status) ||
          task.activeRunKind ||
          task.activeRunReservationId ||
          task.activeRunIds?.length ||
          task.runs?.some((run) => run.status === "running") ||
          task.workPackages?.some((item) => item.status === "running") ||
          task.mergeIntent?.status === "pending" ||
          ["publishing", "open"].includes(task.pullRequestIntent?.status)),
    );
    if (blocked)
      throw conflict(
        "PROJECT_HAS_ACTIVE_TASKS",
        `${blocked.id} still has unresolved work. Finish or close its work before archiving this project.`,
      );
    project.archivedAt ??= new Date().toISOString();
  } else if (change.kind === "restore") {
    project.archivedAt = null;
  } else throw new Error("Unknown project change.");
  return project;
}

function conflict(code, message) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 409;
  return error;
}
