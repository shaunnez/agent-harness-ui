import { type RuntimeProject, type RuntimeTask, stageIds } from "../../domain.ts";
import { fixtureRun, fixtureTask } from "./scenarios.ts";
import { samplePackages } from "./workflow.ts";

/** Explicit visual QA uses the same task/run projections and scene paths as the product. */
export function stationFixtures(): { projects: RuntimeProject[]; tasks: RuntimeTask[] } {
  const project = {
    id: "station-qa",
    name: "Station review",
    repositoryPath: "/demo/station-review",
    createdAt: new Date().toISOString(),
  };
  const tasks = stageIds.map((stage) => {
    const id = `ART-${stage}`,
      run = fixtureRun(id, stage, "running");
    return fixtureTask(id, `${stage} station`, project.repositoryPath, {
      workflow: "implement",
      currentStage: stage,
      status: stage === "approval" ? "awaiting-human-approval" : "running",
      activeRunKind: stage === "approval" ? null : stage,
      activeRunIds: stage === "approval" ? [] : [run.id],
      runs: stage === "approval" ? [] : [run],
      workPackages: stage === "implement" ? samplePackages(1) : [],
    });
  });
  const design = fixtureTask("ART-design", "Design projection station", project.repositoryPath, {
    workflow: "implement",
    currentStage: "specification",
    status: "generating-designs",
    activeRunKind: "design",
    activeRunIds: ["R-ART-design-specification-1"],
    runs: [fixtureRun("ART-design", "specification", "running")],
  });
  return { projects: [project], tasks: [...tasks, design] };
}
