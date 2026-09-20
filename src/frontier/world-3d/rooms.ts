import type { StageId } from "../../domain.ts";
import type { TaskSummary } from "../runtime/contracts.ts";
import { colonyContract, type Point3 } from "./colony.ts";
import { clearOfObstacles, clearStandingPoint, type StandingObstacle } from "./room-clearance.ts";

/**
 * Room geometry and occupancy come from the frozen HQ floor plan. Nothing here reads attention or
 * run semantics; callers decide which robots work, roam or park and this module only decides where
 * a robot stands.
 */
export const roomIds = ["briefing", "planning", "implementation", "review", "testing", "dispatch"] as const;
export type RoomId = (typeof roomIds)[number];
export const roomNames: Record<RoomId, string> = {
  briefing: "Briefing",
  planning: "Planning",
  implementation: "Implementation",
  review: "Review",
  testing: "Testing",
  dispatch: "Dispatch",
};

export interface RoomSocket {
  id: string;
  position: Point3;
  facingDeg: number;
}
export interface Room {
  id: RoomId;
  stages: StageId[];
  hubDoorFlats: number[];
  cornerRadials: [number, number];
  sockets: RoomSocket[];
  labelAnchor: Point3;
}

const hq = colonyContract.hq;
const socket = (entry: { id: string; xz: number[]; y: number; facingDeg: number }): RoomSocket => ({
  id: entry.id,
  position: [entry.xz[0] ?? 0, entry.y, entry.xz[1] ?? 0],
  facingDeg: entry.facingDeg,
});
const anchor = (value: number[]): Point3 => [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0];
const stageIds = new Set<string>(Object.keys(colonyContract.hq.stageToRoom));
export const rooms: Record<RoomId, Room> = Object.fromEntries(
  roomIds.map((id) => {
    const source = hq.rooms[id];
    const doors = source.hubDoorFlat;
    return [
      id,
      {
        id,
        stages: source.stages.filter((stage): stage is StageId => stageIds.has(stage)),
        hubDoorFlats: Array.isArray(doors) ? doors : [doors],
        cornerRadials: [source.cornerRadials[0] ?? 0, source.cornerRadials[1] ?? 0],
        sockets: source.sockets.map(socket),
        labelAnchor: anchor(colonyContract.interactionSockets.room_label_anchors[id]),
      } satisfies Room,
    ];
  }),
) as Record<RoomId, Room>;
export const hubOverflowSockets: RoomSocket[] = hq.hubOverflowSockets.map(socket);
export const courtSockets: RoomSocket[] = hq.courtSockets.map(socket);
export const minRobotSpacing = hq.occupancy.minRobotSpacing;
export const courtIdleLoop: Point3[] = colonyContract.movement.routes.court_idle_loop.map(anchor);
export const hqFloor = colonyContract.levels.hqFloor;
export const courtPaving = colonyContract.levels.courtPaving;

/** Statuses whose robot stands in dispatch regardless of stage: the work is done or awaiting merge. */
export const dispatchStatuses = new Set<TaskSummary["status"]>([
  "awaiting-pr-merge",
  "merging",
  "merged-to-target",
  "completed",
]);
const stageRooms = new Map<string, RoomId>(
  Object.entries(hq.stageToRoom).filter((entry): entry is [string, RoomId] =>
    (roomIds as readonly string[]).includes(entry[1]),
  ),
);
export function roomForStage(stage: StageId): RoomId {
  return stageRooms.get(stage) ?? "briefing";
}
export function roomForTask(task: Pick<TaskSummary, "status"> & { stage: StageId }): RoomId {
  return dispatchStatuses.has(task.status) ? "dispatch" : roomForStage(task.stage);
}

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const normalise = (degrees: number) => ((degrees % 360) + 360) % 360;
/** The two hub corner positions flanking each of the room's hub doors, nearest door first. */
export function hubSocketsForRoom(room: Room): RoomSocket[] {
  const result: RoomSocket[] = [];
  for (const flat of room.hubDoorFlats)
    for (const corner of [flat - 30, flat + 30]) {
      const match = hubOverflowSockets.find((entry) => {
        const angle = normalise((Math.atan2(entry.position[2], entry.position[0]) * 180) / Math.PI);
        return Math.abs(normalise(angle - corner)) < 1 || Math.abs(normalise(angle - corner)) > 359;
      });
      if (match && !result.includes(match)) result.push(match);
    }
  return result;
}

const laneStart = 7.4;
const lanePitch = 1.6;
const laneWallClearance = 0.8 + 0.15;
const laneInnerEnd = 16.6;

/**
 * The approved overflow lane: standing positions at 1.6 m pitch along the room's inner partition,
 * 0.8 m off the wall. The first partition fills first, then the second; if even those are full the
 * lane continues out along the room midline onto the plateau, so no robot is ever dropped.
 */
export function lanePositions(room: Room, count: number): RoomSocket[] {
  const midline = room.cornerRadials[0] + normalise(room.cornerRadials[1] - room.cornerRadials[0]) / 2;
  const result: RoomSocket[] = [];
  const along = (angleDeg: number, offsetDeg: number, from: number, to: number, y: number) => {
    const a = toRadians(angleDeg);
    const inward = toRadians(offsetDeg);
    for (let r = from; r <= to && result.length < count; r += lanePitch) {
      result.push({
        id: `lane_${room.id}_${result.length + 1}`,
        position: [
          r * Math.cos(a) + laneWallClearance * Math.cos(inward),
          y,
          r * Math.sin(a) + laneWallClearance * Math.sin(inward),
        ],
        facingDeg: normalise(angleDeg + 180),
      });
    }
  };
  for (const radial of room.cornerRadials) {
    // Step off the partition toward the room's own midline.
    const towardRoom = normalise(midline - radial) < 180 ? radial + 90 : radial - 90;
    along(radial, towardRoom, laneStart, laneInnerEnd, hqFloor);
  }

  return result;
}
/** Clear fallback lanes remain on the existing plateau and outside the HQ/court. */
export function plateauLanePositions(): RoomSocket[] {
  const result: RoomSocket[] = [];
  for (const radius of [22, 25.5]) {
    for (let degrees = 145; degrees <= 395; degrees += 9) {
      const a = toRadians(degrees);
      result.push({
        id: `plateau_${radius}_${degrees}`,
        position: [radius * Math.cos(a), colonyContract.levels.plateauGround, radius * Math.sin(a)],
        facingDeg: degrees + 180,
      });
    }
  }
  return result;
}
export function courtLanePositions(count: number): RoomSocket[] {
  return plateauLanePositions().slice(0, count);
}

export interface AllocationRequest {
  id: string;
  room: RoomId | "court";
  workers: number;
}
export interface AllocatedWorker {
  requestId: string;
  index: number;
  socket: RoomSocket;
  /** True when the robot stands in the overflow lane and counts toward the room's "+N". */
  lane: boolean;
}
export interface Allocation {
  workers: AllocatedWorker[];
  overflow: Record<RoomId | "court", number>;
}
const spacingOk = (point: Point3, occupied: Point3[], spacing: number) =>
  occupied.every((other) => Math.hypot(point[0] - other[0], point[2] - other[2]) >= spacing - 1e-9);
/**
 * Deterministic in request order: room sockets in listed order, then the hub corners flanking the
 * room's door, then the court, then the overflow lane. Spacing is enforced by skipping a candidate,
 * never by dropping a worker; workers of one request take consecutive candidates so packages of one
 * task stand together.
 */
export function allocateSockets(
  requests: AllocationRequest[],
  spacing = minRobotSpacing,
  obstacles: StandingObstacle[] = [],
): Allocation {
  const occupied: Point3[] = [];
  const used = new Set<string>();
  const overflow = Object.fromEntries([...roomIds, "court"].map((id) => [id, 0])) as Allocation["overflow"];
  const workers: AllocatedWorker[] = [];
  const total = requests.reduce((sum, request) => sum + Math.max(1, request.workers), 0);
  for (const request of requests) {
    const candidates =
      request.room === "court"
        ? [...courtSockets, ...courtLanePositions(total).map((entry) => ({ ...entry, lane: true }))]
        : [
            ...rooms[request.room].sockets,
            ...hubSocketsForRoom(rooms[request.room]),
            ...courtSockets,
            ...lanePositions(rooms[request.room], total * 3).map((entry) => ({ ...entry, lane: true })),
            ...plateauLanePositions().map((entry) => ({ ...entry, lane: true })),
          ];
    for (let index = 0; index < Math.max(1, request.workers); index++) {
      const chosen = candidates.find(
        (entry) =>
          !used.has(entry.id) &&
          clearStandingPoint(entry.position, entry.id) &&
          clearOfObstacles(entry.position, obstacles) &&
          spacingOk(entry.position, occupied, spacing),
      );
      if (!chosen)
        throw new Error(
          `The colony has no clear standing position for ${request.id}. Reduce the fixture crew before previewing this project.`,
        );
      used.add(chosen.id);
      occupied.push(chosen.position);
      const lane = "lane" in chosen && Boolean(chosen.lane);
      if (lane) overflow[request.room]++;
      workers.push({ requestId: request.id, index, socket: chosen, lane });
    }
  }
  return { workers, overflow };
}
