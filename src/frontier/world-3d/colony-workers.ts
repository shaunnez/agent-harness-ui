import { attentionFor, isOpen, stageLabels } from "../runtime/presentation.ts";
import { workAction, workerBehavior } from "../scene/worker-behavior.ts";
import type { ProjectBase } from "./layout.ts";
import { translated, visibleBases } from "./layout.ts";
import type { ProofInput, ProofManifest } from "./model.ts";
import { propObstacles } from "./prop-placement.ts";
import { allocateSockets, courtIdleLoop, roomForTask } from "./rooms.ts";

/** Every actor is grounded in task/run/package state. Package count never becomes task count. */
export function colonyWorkers(input: ProofInput, bases: ProjectBase[], manifest: ProofManifest) {
  return visibleBases(bases, input)
    .filter((base) => !base.project.archivedAt)
    .flatMap((base) => {
      const tasks = input.tasks.filter(
        (task) =>
          task.repositoryPath === base.project.repositoryPath &&
          (isOpen(task) || task.id === input.selectedId || task.id === input.location.taskId),
      );
      const states = tasks.map((task) => {
        const watching = input.location.view === "agent" && input.location.taskId === task.id;
        const historical = watching && !input.watchedRunActive;
        const active = watching ? input.watchedRunActive : Boolean(task.activeRunIds?.length);
        const behavior = workerBehavior(
          task,
          input.connected,
          active,
          Boolean(input.idleRoaming),
          historical,
        );
        const stage = watching ? (input.watchedStage ?? task.currentStage) : task.currentStage;
        const packages =
          !historical && stage === "implement"
            ? (task.workPackages ?? []).filter((p) => p.status === "running")
            : [];
        const room = roomForTask({ status: task.status, stage });
        return { task, watching, historical, behavior, stage, room, packages };
      });
      const allocation = allocateSockets(
        states.map((s) => ({
          id: s.task.id,
          room: input.location.view === "world" || s.behavior === "roam" ? "court" : s.room,
          workers: Math.max(1, s.packages.length),
        })),
        undefined,
        // The scanned props stand on floor the plan reserved but the obstacle list predates them.
        [...(manifest.colony?.obstacles ?? []), ...(manifest.colony?.props ? propObstacles : [])],
      );
      return allocation.workers.map((allocated) => {
        const state = states.find((s) => s.task.id === allocated.requestId);
        if (!state) throw new Error("Allocated colony task is missing.");
        const { task, watching, historical, behavior, stage, room, packages } = state;
        const attention = attentionFor(task);
        const packageId = packages[allocated.index]?.id;
        return {
          id: allocated.index === 0 ? task.id : `${task.id}:package:${packageId}`,
          task,
          projectId: base.project.id,
          room,
          overflow: allocated.lane,
          packageId,
          packageCount: packages.length,
          position: translated(allocated.socket.position, base.position),
          facing: ((90 - allocated.socket.facingDeg) * Math.PI) / 180,
          route: courtIdleLoop.map((p) => translated(p, base.position)),
          behavior,
          action: workAction(stage, watching ? input.watchedRole : undefined),
          moving: input.motion && input.connected && behavior !== "park",
          stage,
          title: `${task.id} · ${stageLabels[stage]}${packages.length > 1 ? ` ×${packages.length} packages` : ""}`,
          detail: !input.connected
            ? "Connection unknown"
            : historical
              ? input.watchedRunStatus
                ? `Recorded run · ${input.watchedRunStatus.replaceAll("-", " ")}`
                : "Run details unavailable"
              : attention.label,
          tone: !input.connected
            ? "unavailable"
            : historical
              ? input.watchedRunStatus === "completed"
                ? "completed"
                : input.watchedRunStatus === "failed"
                  ? "failed"
                  : "unavailable"
              : attention.kind,
        };
      });
    });
}
