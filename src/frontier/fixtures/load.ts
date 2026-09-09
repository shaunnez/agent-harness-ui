import type { RuntimeProject, RuntimeTask } from "../../domain";
import { fixtureRun, fixtureTask } from "./scenarios.ts";

export function loadFixture(size: "normal" | "stress"): { projects: RuntimeProject[]; tasks: RuntimeTask[] } {
  const projects = Array.from({ length: size === "normal" ? 10 : 50 }, (_, index) => ({
    id: `load-project-${index + 1}`,
    name: `Project ${String(index + 1).padStart(2, "0")}`,
    repositoryPath: `/demo/load/project-${index + 1}`,
    createdAt: `2026-08-${String((index % 28) + 1).padStart(2, "0")}T00:00:00Z`,
  }));
  const tasks = projects.flatMap((project, index) =>
    Array.from({ length: size === "normal" ? 10 : 20 }, (_, taskIndex) => {
      const id = `LOAD-${index + 1}-${taskIndex + 1}`;
      return fixtureTask(
        id,
        `Sample task ${taskIndex + 1} for ${project.name}`,
        project.repositoryPath,
        taskIndex < 2
          ? {
              status: "running",
              currentStage: "implement",
              activeRunKind: "implement",
              activeRunIds: [`R-${id}-implement-1`],
              runs: [fixtureRun(id, "implement", "running")],
            }
          : taskIndex === 2
            ? {
                status: "failed",
                currentStage: "test",
                error: "Sample verification failure requiring inspection.",
                runs: [fixtureRun(id, "test", "failed")],
              }
            : {},
      );
    }),
  );
  return { projects, tasks };
}
