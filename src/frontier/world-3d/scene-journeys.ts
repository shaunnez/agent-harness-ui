import type { WorldFeedback } from "../runtime/world-feedback.ts";
import { exteriorArrival } from "./arrival-journey.ts";
import type { ProjectBase } from "./layout.ts";
import { type Point3, type ProofInput, type ProofManifest, type ProofWorker, proofWorkers } from "./model.ts";
import { propObstacles } from "./prop-placement.ts";
import type { TerrainField } from "./terrain-field.ts";
import { hqJourney, journeyLength } from "./worker-journeys.ts";

export interface WorkerJourney {
  route: Point3[];
  startedAt: number;
  speed: number;
}
export function planWorkerJourney(
  effect: WorldFeedback,
  worker: ProofWorker,
  input: ProofInput,
  manifest: ProofManifest,
  bases: ProjectBase[],
  field: TerrainField | null,
): WorkerJourney | null {
  if (
    !input.motion ||
    !input.connected ||
    worker.behavior === "park" ||
    (input.location.view === "agent" && !input.watchedRunActive)
  )
    return null;
  const base = bases.find((item) => item.project.id === worker.projectId);
  if (!base) return null;
  // Idle actors actually roam the court. Their allocated overflow socket may be behind the HQ.
  const destination = worker.behavior === "roam" ? (worker.route[0] ?? worker.position) : worker.position;
  let route: Point3[] | null = null;
  if (input.location.view === "world") {
    if (effect.kind !== "task-created" || !field) return null;
    route = exteriorArrival(base, bases, field, destination);
  } else {
    const local = (p: Point3): Point3 => [p[0] - base.position[0], p[1], p[2] - base.position[2]];
    let from: Point3 | undefined;
    if (effect.kind === "task-created") from = [0, 4.3, 24];
    else if (
      (effect.kind === "stage-advanced" || effect.kind === "repair-started") &&
      effect.fact.fromStage
    ) {
      const old = proofWorkers(
        {
          ...input,
          watchedStage: input.location.view === "agent" ? effect.fact.fromStage : input.watchedStage,
          tasks: input.tasks.map((task) =>
            task.id === worker.task.id
              ? { ...task, currentStage: effect.fact.fromStage ?? task.currentStage }
              : task,
          ),
        },
        manifest,
        bases,
      ).find((actor) => actor.id === worker.id);
      if (old?.room === worker.room) return null;
      if (old) from = local(old.position);
    }
    if (from) {
      const obstacles = [
        ...(manifest.colony?.obstacles ?? []),
        ...(manifest.colony?.props ? propObstacles : []),
      ];
      route =
        hqJourney(from, local(destination), obstacles)?.map(
          (p): Point3 => [p[0] + base.position[0], p[1], p[2] + base.position[2]],
        ) ?? null;
    }
  }
  if (!route || journeyLength(route) > 55 || journeyLength(route) < 0.5) return null;
  return { route, startedAt: effect.receivedAt, speed: 4.2 };
}
