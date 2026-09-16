import { colonyContract, type Point3 } from "./colony.ts";

/** Conservative point-to-boundary checks use the authored walkable polygons, not wall art. */
export function insideClearPolygon(point: Point3, polygon: number[][], clearance = 0.6) {
  const [x, , z] = point;
  let inside = false;
  let distance = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (!a || !b) continue;
    const ax = a[0] ?? 0,
      az = a[1] ?? 0,
      bx = b[0] ?? 0,
      bz = b[1] ?? 0;
    if (az > z !== bz > z && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
    const dx = bx - ax,
      dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    distance = Math.min(distance, Math.hypot(x - ax - t * dx, z - az - t * dz));
  }
  return inside && distance >= clearance - 1e-6;
}
const movement = colonyContract.movement;
export function clearStandingPoint(point: Point3, id: string) {
  const [x, , z] = point;
  if (id.startsWith("plateau_")) return Math.hypot(x, z) <= 26 && Math.hypot(x, z) >= 22 && z < 14;
  if (id.startsWith("court_") || id.startsWith("lane_court"))
    return insideClearPolygon(point, movement.court.polygon);
  if (id.startsWith("hq_hub"))
    return insideClearPolygon(point, movement.hub_floor.polygon) && Math.hypot(x, z) >= 2.1;
  const room = id.includes("implement")
    ? "implementation"
    : id.includes("dispatch")
      ? "dispatch"
      : id.includes("planning")
        ? "planning"
        : id.includes("review")
          ? "review"
          : id.includes("testing")
            ? "testing"
            : "briefing";
  const polygon =
    room === "dispatch"
      ? z > 15.59
        ? movement.bay.polygon
        : movement.room_dispatch_marshalling.polygon
      : movement[`room_${room}`].polygon;
  if (!insideClearPolygon(point, polygon)) return false;
  if (room === "dispatch")
    return colonyContract.hq.rooms.dispatch.cargoPads.every(
      (pad) =>
        Math.abs(x - (pad.xz[0] ?? 0)) > (pad.footprint[0] ?? 0) / 2 + 0.6 ||
        Math.abs(z - (pad.xz[1] ?? 0)) > (pad.footprint[1] ?? 0) / 2 + 0.6,
    );
  // Bench envelopes from the floor-plan: the long fabrication bench follows the 240° radial.
  if (room === "implementation") {
    const along = x * -0.5 + (z * -Math.sqrt(3)) / 2;
    const across = (x * Math.sqrt(3)) / 2 - z * 0.5;
    return along < 7.4 || along > 14.6 || Math.abs(across) >= 1.4;
  }
  if (room === "review")
    return Math.hypot(x - 9 * Math.cos((Math.PI * 11) / 6), z - 9 * Math.sin((Math.PI * 11) / 6)) >= 2.2;
  return true;
}

export interface StandingObstacle {
  name: string;
  min: Point3;
  max: Point3;
}
export function clearOfObstacles(point: Point3, obstacles: StandingObstacle[]) {
  return obstacles.every((obstacle) => {
    if (point[1] > obstacle.max[1] || point[1] + 3.1 < obstacle.min[1]) return true;
    const dx = Math.max(obstacle.min[0] - point[0], 0, point[0] - obstacle.max[0]);
    const dz = Math.max(obstacle.min[2] - point[2], 0, point[2] - obstacle.max[2]);
    return Math.hypot(dx, dz) >= 0.6;
  });
}
