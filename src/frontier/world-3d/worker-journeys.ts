import { colonyContract, type Point3 } from "./colony.ts";
import { propPlacements } from "./prop-placement.ts";
import { clearOfObstacles, insideClearPolygon, type StandingObstacle } from "./room-clearance.ts";

const movement = colonyContract.movement;
const floor = colonyContract.levels.hqFloor;
const polygons = [
  movement.hub_floor,
  movement.corridor_dispatch,
  movement.room_planning,
  movement.room_implementation,
  movement.room_review,
  movement.room_testing,
  movement.room_briefing,
  movement.room_dispatch_marshalling,
  movement.bay,
  movement.court,
];

/** Door strips explicitly bridge the clearance gaps between the room and hub polygons. */
export function walkableHq(point: Point3, obstacles: StandingObstacle[]) {
  if (Math.hypot(point[0], point[2]) < 2.2) return false;
  for (const obstacle of obstacles) {
    const prop = propPlacements.find((entry) => entry.id === obstacle.name);
    if (!prop) {
      if (!clearOfObstacles(point, [obstacle])) return false;
      continue;
    }
    const yaw = ((90 - prop.facingDeg) * Math.PI) / 180;
    const dx = point[0] - prop.position[0],
      dz = point[2] - prop.position[2];
    const localX = dx * Math.cos(yaw) - dz * Math.sin(yaw);
    const localZ = dx * Math.sin(yaw) + dz * Math.cos(yaw);
    if (
      Math.hypot(
        Math.max(0, Math.abs(localX) - prop.footprint[0] / 2),
        Math.max(0, Math.abs(localZ) - prop.footprint[1] / 2),
      ) < 0.6
    )
      return false;
  }
  if (polygons.some((region) => insideClearPolygon(point, region.polygon))) return true;
  return colonyContract.hq.doors.some((door) => {
    // Rear service yard is outside this room-to-room graph.
    if (door.kind === "hex-to-yard") return false;
    const angle = typeof door.flat === "number" ? (door.flat * Math.PI) / 180 : Math.PI / 2;
    const dx = point[0] - (door.centre[0] ?? 0),
      dz = point[2] - (door.centre[1] ?? 0);
    const along = dx * Math.cos(angle) + dz * Math.sin(angle);
    const across = -dx * Math.sin(angle) + dz * Math.cos(angle);
    return Math.abs(along) <= 2 && Math.abs(across) <= door.width / 2 - 0.6;
  });
}
export function clearHqSegment(a: Point3, b: Point3, obstacles: StandingObstacle[]) {
  const steps = Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / 0.2);
  for (let i = 0; i <= steps; i++) {
    const t = steps ? i / steps : 0;
    if (!walkableHq([a[0] + (b[0] - a[0]) * t, floor, a[2] + (b[2] - a[2]) * t], obstacles)) return false;
  }
  return true;
}

/** Bounded local floor graph. No path means static feedback, never a straight-line teleport. */
export function hqJourney(from: Point3, to: Point3, obstacles: StandingObstacle[]): Point3[] | null {
  if (!walkableHq(from, obstacles) || !walkableHq(to, obstacles)) return null;
  if (clearHqSegment(from, to, obstacles)) return [from, to];
  const step = 0.5;
  const key = (x: number, z: number) => `${x},${z}`;
  const point = (x: number, z: number): Point3 => [x * step, floor, z * step];
  const near = (p: Point3) => {
    const choices: { x: number; z: number; distance: number }[] = [];
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++) {
        const x = Math.round(p[0] / step) + dx,
          z = Math.round(p[2] / step) + dz;
        if (clearHqSegment(p, point(x, z), obstacles))
          choices.push({ x, z, distance: Math.hypot(x * step - p[0], z * step - p[2]) });
      }
    return choices.sort((a, b) => a.distance - b.distance)[0];
  };
  const start = near(from),
    end = near(to);
  if (!start || !end) return null;
  const endKey = key(end.x, end.z),
    startKey = key(start.x, start.z);
  const open = [{ ...start, cost: 0, score: 0 }],
    costs = new Map([[startKey, 0]]);
  const parents = new Map<string, string>();
  const visited = new Set<string>();
  while (open.length && visited.size < 6500) {
    open.sort((a, b) => b.score - a.score);
    const current = open.pop();
    if (!current) break;
    const id = key(current.x, current.z);
    if (visited.has(id)) continue;
    if (id === endKey) {
      const path: Point3[] = [to];
      let cursor: string | undefined = id;
      while (cursor) {
        const [x = 0, z = 0] = cursor.split(",").map(Number);
        path.push(point(x, z));
        cursor = parents.get(cursor);
      }
      path.push(from);
      path.reverse();
      const simplified: Point3[] = [from];
      for (let i = 0; i < path.length - 1; ) {
        let next = path.length - 1;
        while (next > i + 1 && !clearHqSegment(path[i] as Point3, path[next] as Point3, obstacles)) next--;
        simplified.push(path[next] as Point3);
        i = next;
      }
      return simplified;
    }
    visited.add(id);
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dz) continue;
        const x = current.x + dx,
          z = current.z + dz,
          nextId = key(x, z);
        if (x < -36 || x > 36 || z < -32 || z > 56 || visited.has(nextId)) continue;
        const cost = current.cost + Math.hypot(dx, dz);
        if (
          cost >= (costs.get(nextId) ?? Infinity) ||
          !clearHqSegment(point(current.x, current.z), point(x, z), obstacles)
        )
          continue;
        costs.set(nextId, cost);
        parents.set(nextId, id);
        open.push({ x, z, distance: 0, cost, score: cost + Math.hypot(end.x - x, end.z - z) });
      }
  }
  return null;
}

export function journeyLength(route: Point3[]) {
  return route.slice(1).reduce((length, b, i) => {
    const a = route[i] as Point3;
    return length + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }, 0);
}
export function journeyPose(route: Point3[], distance: number) {
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1] as Point3,
      b = route[i] as Point3;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (distance <= length) {
      const t = length ? distance / length : 1;
      return {
        position: a.map((v, axis) => v + ((b[axis] ?? v) - v) * t) as Point3,
        facing: Math.atan2(b[0] - a[0], b[2] - a[2]),
        done: false,
      };
    }
    distance -= length;
  }
  return { position: route.at(-1) ?? ([0, floor, 0] as Point3), facing: 0, done: true };
}
