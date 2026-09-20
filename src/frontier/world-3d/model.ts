import type { RuntimeProject } from "../../domain.ts";
import type { TaskSummary } from "../runtime/contracts.ts";
import { attentionFor, isOpen, stageLabels } from "../runtime/presentation.ts";
import type { SceneInput } from "../world/scene.ts";
import { workAction, workerBehavior } from "../world/worker-behavior.ts";
import { type BaseVariant, type LegacyBaseVariant, legacyBaseVariants } from "./appearance.ts";
import { colonyWorkers } from "./colony-workers.ts";
import { type ProjectBase, projectBases, translated, visibleBases } from "./layout.ts";

export type Point3 = [number, number, number];
export type ProofInput = SceneInput & { watchedRunStatus?: string | null };
export interface ProofCamera {
  position: Point3;
  target: Point3;
  verticalSpan: number;
}
export interface ProofManifest {
  version: 1 | 2 | 3;
  colony?: {
    contract: string;
    shell?: string;
    crowns?: Partial<Record<BaseVariant, string>>;
    /** Picker thumbnails of each crown on the shared shell. */
    crownPreviews?: Partial<Record<BaseVariant, string>>;
    /** Shared scatter kit (trees, boulders, lanterns, vehicles) instanced per parcel from a seeded layout. */
    scatterKit?: string;
    /** Transport standing on the hub landing terrace (contract `spaceport_pad`). */
    shuttle?: string;
    /** Scanned interior hero props, anchored to the room sockets that already name them. */
    props?: string;
    /** Contract 2.0 land is a runtime height field; these textures dress it (tri-planar in the shader). */
    terrainTextures?: Partial<Record<"gravel" | "limestone" | "cliff" | "cliffNormal" | "basalt", string>>;
    parcelHub?: string;
    parcelA?: string;
    bridgeSpan?: string;
    bridgeEnd?: string;
    obstacles?: { name: string; min: Point3; max: Point3 }[];
    hqLightPositions?: Point3[];
    parcelLightPositions?: Point3[];
    hubShorelineXZ?: [number, number][][];
  };
  bases?: Record<LegacyBaseVariant, { src: string; preview?: string; lightPositions: Point3[] }>;
  environmentLightPositions?: Point3[];
  scene: string;
  worker: string;
  cameras: { exterior: ProofCamera; cutaway: ProofCamera };
  sockets: Record<string, Point3>;
  walkableRoutes: { court: Point3[] };
  shorelineXZ: [number, number][][];
  practicalLightPositions: Point3[];
}
export interface ProofControls {
  frame(): void;
  focusProject(id: string): void;
  follow(id: string): void;
  pan(x: number, y: number): void;
  zoom(factor: number): void;
  simulateContextLoss(): void;
  readonly worldHour: number;
  headquartersPreview(projectId: string): Promise<string | null>;
}

export function proofProject(projects: RuntimeProject[]) {
  return (
    projects.find((project) => project.id === "plancheck" && !project.archivedAt) ??
    projects.find((project) => !project.archivedAt)
  );
}
/**
 * Whether the world has something to draw.
 *
 * It used to also ask for `?renderer=3d` and for fixture data. Both are gone: the colony is the only
 * world there is, and it draws live projects on the same contracts the fixtures implement, so a
 * renderer flag would only have offered a way to get the retired one back. What is left is the
 * question that was always the real one -- is there a project, a located project, or a located task.
 */
export function proofVisible(input: SceneInput) {
  const projects = input.projects.filter((project) => !project.archivedAt);
  if (input.location.view === "world") return input.projects.length > 0;
  if (input.location.view === "project")
    return projects.some((project) => project.id === input.location.projectId);
  return (
    input.location.view === "agent" &&
    input.tasks.some(
      (task) =>
        task.id === input.location.taskId &&
        projects.some((project) => project.repositoryPath === task.repositoryPath),
    )
  );
}

export const proofWorkerScale = 3.1 / 1.8;
export const proofWorkerHeight = 3.1;
export type ProofView = "world" | "exterior" | "cutaway";
/**
 * Robots read at a glance from every distance: 2.5x in the World view, 1.4x on a focused exterior,
 * true size in the cutaway. Rings, labels and picking follow the same factor; standing positions,
 * spacing and gait speed stay in true world units.
 */
/** World view read 20% too large against the scanned kit and the 18 m shuttle; 2.5 -> 2.0. */
export const workerViewScale: Record<ProofView, number> = { world: 1.6, exterior: 1.3, cutaway: 1.15 };
export function proofView(input: Pick<ProofInput, "location">, focusId: string | null): ProofView {
  return input.location.view !== "world" ? "cutaway" : focusId ? "exterior" : "world";
}
export function workerScale(view: ProofView) {
  return proofWorkerScale * workerViewScale[view];
}
export function workerHeight(view: ProofView) {
  return proofWorkerHeight * workerViewScale[view];
}
export function proofWorkers(
  input: ProofInput,
  manifest: ProofManifest,
  bases: ProjectBase[] = projectBases(input.projects),
) {
  if (manifest.version === 3) return colonyWorkers(input, bases, manifest);
  const cutaway = input.location.view !== "world";
  return visibleBases(bases, input).flatMap((base) => {
    const tasks = input.tasks.filter(
      (task) =>
        task.repositoryPath === base.project.repositoryPath &&
        (isOpen(task) || task.id === input.selectedId || task.id === input.location.taskId),
    );
    const occupied: Point3[] = [];
    return tasks.map((task, index) => {
      const watching = input.location.view === "agent" && input.location.taskId === task.id;
      const historical = watching && !input.watchedRunActive;
      const active = watching ? input.watchedRunActive : Boolean(task.activeRunIds?.length);
      const behavior = workerBehavior(task, input.connected, active, Boolean(input.idleRoaming), historical);
      const stage = watching ? (input.watchedStage ?? task.currentStage) : task.currentStage;
      const area = stage === "grill" ? "answer" : stage === "dev-review" ? "review" : "implement";
      const socket = manifest.sockets[`${cutaway && behavior !== "roam" ? "interior" : "court"}_${area}`] ?? [
        0, 4.3, 15,
      ];
      const sameAreaBefore = tasks.slice(0, index).filter((other) => areaFor(other) === area).length;
      const interior = cutaway && behavior !== "roam";
      // Additional workers use authored clear floor positions, not the central analysis bench.
      const spareInterior: Point3[] = [
        [5, 4.3, -5],
        [-5, 4.3, 5],
        [5, 4.3, 5],
        [0, 4.3, 5],
      ];
      const spareCourt: Point3[] = [10, 14, 18].flatMap((z) =>
        [-6, -2, 2, 6].map((x): Point3 => [x, 4.25, z]),
      );
      const candidates = interior ? spareInterior : spareCourt;
      const preferred: Point3 = [socket[0], socket[1], socket[2]];
      const reserved = tasks
        .filter((other) => other.id !== task.id && areaFor(other) !== area)
        .map((other) => manifest.sockets[`${interior ? "interior" : "court"}_${areaFor(other)}`]);
      const clear = (point: Point3) =>
        [...occupied, ...reserved].every(
          (other) => !other || Math.hypot(point[0] - other[0], point[2] - other[2]) >= 3.3,
        );
      const local =
        sameAreaBefore === 0 && clear(preferred)
          ? preferred
          : (candidates.find(clear) ?? spareCourt.find(clear) ?? preferred);
      occupied.push(local);
      const attention = attentionFor(task);
      return {
        id: task.id,
        facing: 0,
        room: undefined,
        overflow: false,
        packageId: undefined,
        packageCount: 0,
        task,
        projectId: base.project.id,
        position: translated(local, base.position),
        route: manifest.walkableRoutes.court.map((point) => translated(point, base.position)),
        behavior,
        action: workAction(stage, watching ? input.watchedRole : undefined),
        moving: input.motion && input.connected && behavior !== "park",
        stage,
        title: `${task.id} · ${stageLabels[stage]}`,
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

/**
 * The overview mirrors the reference: one relevant task label per base, with every worker still
 * pickable. Inside a base every robot carries its own card, because a robot standing in a room with
 * nothing above its head is an agent you cannot identify without clicking it. The crowding guard
 * that collapses cards to markers is `compactWorkerLabels`, not this.
 */
export function visibleWorkerLabels(
  workers: ProofWorker[],
  input: ProofInput,
  focusedProjectId: string | null,
) {
  if (input.location.view !== "world" || focusedProjectId) return workers;
  const taskWorkers = workers.filter(
    (worker, index) => workers.findIndex((other) => other.task.id === worker.task.id) === index,
  );
  const chosen = new Map<string, ProofWorker>();
  for (const worker of taskWorkers) {
    const previous = chosen.get(worker.projectId);
    const priority = (value: ProofWorker) =>
      value.task.id === input.selectedId
        ? 3
        : ["answer", "repair", "failed", "blocked"].includes(value.tone)
          ? 2
          : value.behavior === "work"
            ? 1
            : 0;
    if (!previous || priority(worker) > priority(previous)) chosen.set(worker.projectId, worker);
  }
  return [...chosen.values()];
}

/** Tones that always earn a full card: the robot needs the operator or is in trouble. */
const attentionTones = new Set(["answer", "approval", "repair", "failed", "blocked", "ready"]);
/**
 * Crowded rooms collapse their plain cards to dot markers. Once a room (or a focused exterior court)
 * shows more than `limit` cards, only attention, selected and watched robots keep full cards; every
 * plain "Working" or idle card becomes a compact marker that is still labelled and pickable, and
 * selecting a marker expands it. Fourteen 57 px cards cannot all stand above one room at 1280 x 720
 * beside the selection panel; fourteen markers can.
 */
export function compactWorkerLabels(
  workers: ProofWorker[],
  input: ProofInput,
  focusedProjectId: string | null,
  limit = 4,
) {
  const compact = new Set<string>();
  if (input.location.view === "world" && !focusedProjectId) return compact;
  const groups = new Map<string, ProofWorker[]>();
  for (const worker of workers) {
    const key = `${worker.projectId}:${worker.room ?? "court"}`;
    groups.set(key, [...(groups.get(key) ?? []), worker]);
  }
  for (const group of groups.values()) {
    if (group.length <= limit) continue;
    for (const worker of group) {
      const kept =
        worker.task.id === input.selectedId ||
        worker.task.id === input.location.taskId ||
        attentionTones.has(worker.tone);
      // Keyed by worker, not task: two package robots of one task are two cards to weigh separately.
      if (!kept) compact.add(worker.id);
    }
  }
  return compact;
}

function areaFor(task: TaskSummary) {
  return task.currentStage === "grill"
    ? "answer"
    : task.currentStage === "dev-review"
      ? "review"
      : "implement";
}
export type ProofWorker = ReturnType<typeof proofWorkers>[number];

export function parseProofManifest(value: unknown): ProofManifest {
  const data = value as Partial<ProofManifest> | null;
  if (!data) throw new Error("The 3D scene manifest is missing.");
  const point = (v: unknown, length = 3): boolean =>
    Array.isArray(v) && v.length === length && v.every((n) => typeof n === "number" && Number.isFinite(n));
  const camera = (v: ProofCamera | undefined) =>
    v && point(v.position) && point(v.target) && Number.isFinite(v.verticalSpan) && v.verticalSpan > 0;
  const asset = (v: unknown) => typeof v === "string" && /^\/assets\/3d-proof\/[\w.-]+\.glb$/.test(v);
  if (
    ![1, 2, 3].includes(data?.version ?? 0) ||
    !asset(data.scene) ||
    !asset(data.worker) ||
    !camera(data.cameras?.exterior) ||
    !camera(data.cameras?.cutaway) ||
    !data.sockets ||
    ![
      "court_implement",
      "court_review",
      "court_answer",
      "interior_implement",
      "interior_review",
      "interior_answer",
      "base_label",
    ].every((key) => point(data.sockets?.[key])) ||
    !Array.isArray(data.walkableRoutes?.court) ||
    data.walkableRoutes.court.length < 2 ||
    !data.walkableRoutes.court.every((p) => point(p)) ||
    !Array.isArray(data.shorelineXZ) ||
    !data.shorelineXZ.length ||
    !data.shorelineXZ.every(
      (loop) => Array.isArray(loop) && loop.length >= 3 && loop.every((p) => point(p, 2)),
    ) ||
    !Array.isArray(data.practicalLightPositions) ||
    !data.practicalLightPositions.every((p) => point(p))
  )
    throw new Error("The 3D scene export is incomplete. Return to the existing world or retry the artwork.");
  if (
    (data.version === 2 || (data.version === 3 && data.bases)) &&
    (!data.bases ||
      !legacyBaseVariants.every((key) => {
        const base = data.bases?.[key];
        return (
          base &&
          asset(base.src) &&
          (!base.preview || /^\/assets\/3d-proof\/[\w.-]+\.(png|webp)$/.test(base.preview)) &&
          Array.isArray(base.lightPositions) &&
          base.lightPositions.every((p) => point(p))
        );
      }) ||
      !Array.isArray(data.environmentLightPositions) ||
      !data.environmentLightPositions.every((p) => point(p)))
  )
    throw new Error(
      "The exterior base kit is incomplete. Retry the artwork or return to the existing world.",
    );
  if (data.version === 3) {
    const colony = data.colony;
    if (
      !colony ||
      (colony.obstacles !== undefined &&
        (!Array.isArray(colony.obstacles) ||
          !colony.obstacles.every(
            (o) =>
              typeof o.name === "string" &&
              point(o.min) &&
              point(o.max) &&
              o.min.every((v, i) => v <= (o.max[i] ?? -Infinity)),
          ))) ||
      !/^\/assets\/3d-proof\/[\w.-]+\.json$/.test(colony.contract) ||
      [
        colony.shell,
        colony.parcelHub,
        colony.parcelA,
        colony.bridgeSpan,
        colony.bridgeEnd,
        colony.scatterKit,
        colony.shuttle,
        colony.props,
        ...Object.values(colony.crowns ?? {}),
      ].some((value) => value !== undefined && !asset(value)) ||
      Object.values(colony.crownPreviews ?? {}).some(
        (value) => typeof value !== "string" || !/^\/assets\/3d-proof\/[\w.-]+\.(png|webp)$/.test(value),
      ) ||
      Object.values(colony.terrainTextures ?? {}).some(
        (value) => typeof value !== "string" || !/^\/assets\/3d-proof\/[\w.-]+\.(jpg|png|webp)$/.test(value),
      ) ||
      [colony.hqLightPositions, colony.parcelLightPositions].some(
        (points) => points !== undefined && (!Array.isArray(points) || !points.every((p) => point(p))),
      ) ||
      (colony.hubShorelineXZ !== undefined &&
        (!Array.isArray(colony.hubShorelineXZ) ||
          !colony.hubShorelineXZ.every(
            (loop) => Array.isArray(loop) && loop.length >= 4 && loop.every((p) => point(p, 2)),
          )))
    )
      throw new Error("The colony asset manifest is incomplete or references an unsafe asset.");
  }
  return data as ProofManifest;
}

/** Allocation failure must stay inside the preview boundary; task records remain inspectable. */
export function proofWorkerState(input: ProofInput, manifest: ProofManifest | null, bases: ProjectBase[]) {
  try {
    return { workers: manifest ? proofWorkers(input, manifest, bases) : [], problem: null };
  } catch (cause) {
    return {
      workers: [],
      problem: cause instanceof Error ? cause.message : "The colony crew could not be placed safely.",
    };
  }
}
