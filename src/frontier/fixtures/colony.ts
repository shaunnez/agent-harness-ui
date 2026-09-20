import type { RuntimeTask } from "../../domain.ts";
import { fixtureProjects, fixtureRun, fixtureTask, makeFixtureTasks } from "./scenarios.ts";
import { samplePackages } from "./workflow.ts";

/** Explicit, isolated colony acceptance fixture: ten parcels and a genuinely parallel busy HQ. */
export function colonyStressFixtures() {
  const projects = structuredClone(fixtureProjects);
  for (let index = 4; index <= 10; index++)
    projects.push({
      id: `colony-${index}`,
      name: `Colony ${index}`,
      repositoryPath: `/demo/colony-${index}`,
      createdAt: `2026-09-${String(index).padStart(2, "0")}T00:00:00Z`,
    });
  const tasks: RuntimeTask[] = makeFixtureTasks().filter(
    (task) => task.repositoryPath !== projects[0]?.repositoryPath,
  );
  const repositoryPath = projects[0]?.repositoryPath ?? "/demo/eversor-plancheck";
  for (let index = 1; index <= 14; index++) {
    const id = `COL-${String(index).padStart(3, "0")}`;
    const packages =
      index <= 3
        ? samplePackages(2).map((pkg) => ({ ...pkg, dependencies: [], batch: 1, status: "running" as const }))
        : [];
    const runs = (packages.length ? packages : [null]).map((pkg, i) => ({
      ...fixtureRun(id, "implement", "running"),
      id: `R-${id}-implement-${i + 1}`,
      workPackageId: pkg?.id ?? null,
    }));
    tasks.push(
      fixtureTask(id, `Sample colony implementation ${index}`, repositoryPath, {
        workflow: "implement",
        status: "running",
        currentStage: "implement",
        workPackages: packages,
        runs,
        activeRunIds: runs.map((run) => run.id),
        activeRunKind: "implement",
      }),
    );
  }
  for (const project of projects.slice(3))
    tasks.push(
      fixtureTask(`COL-${project.id}`, `Sample work for ${project.name}`, project.repositoryPath, {
        status: "awaiting-grill",
        currentStage: "grill",
      }),
    );
  return { projects, tasks };
}
