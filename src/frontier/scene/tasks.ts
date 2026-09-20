import type { RuntimeProject } from "../../domain.ts";
import type { TaskSummary } from "../runtime/contracts.ts";

/**
 * A project's tasks, matched on repository path with any trailing slashes ignored.
 *
 * Lifted out of the 2D world's layout module, which is the only thing in that folder the rest of the
 * app ever needed and has nothing to do with laying anything out.
 */
export function tasksInProject(tasks: TaskSummary[], project: RuntimeProject) {
  const path = project.repositoryPath.replace(/\/+$/, "");
  return tasks.filter((task) => task.repositoryPath.replace(/\/+$/, "") === path);
}
