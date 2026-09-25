import { colonyBridges, hubSlot, type Point3 } from "./colony.ts";
import type { ProjectBase } from "./layout.ts";
import { heightAt, ringRoadRadius, type TerrainField } from "./terrain-field.ts";
import { journeyLength, journeyPose } from "./worker-journeys.ts";

/** Find the real incoming bridge, including projects on outer rings. */
export function arrivalBridge(slot: string, occupied: string[]) {
  const bridges = colonyBridges(occupied),
    visited = new Set([hubSlot.id]);
  const pending = [hubSlot.id];
  while (pending.length) {
    const current = pending.shift();
    for (const bridge of bridges) {
      const next = bridge.from === current ? bridge.to : bridge.to === current ? bridge.from : null;
      if (!next || visited.has(next)) continue;
      if (next === slot)
        return bridge.to === next
          ? { start: bridge.start, end: bridge.end, edge: bridge.toEdge }
          : { start: bridge.end, end: bridge.start, edge: bridge.fromEdge };
      visited.add(next);
      pending.push(next);
    }
  }
  return null;
}

/** An arrival shows the final approach; it never speeds through an entire multi-parcel trip. */
export function exteriorArrival(
  base: ProjectBase,
  bases: ProjectBase[],
  field: TerrainField,
  target: Point3,
) {
  const bridge = arrivalBridge(
    base.slot,
    bases.map((item) => item.slot),
  );
  const profile = field.profiles.find((item) => item.id === base.slot);
  if (!bridge || !profile) return null;
  const route: Point3[] = [
    [bridge.start[0], 4.25, bridge.start[1]],
    [bridge.end[0], 4.25, bridge.end[1]],
  ];
  const angle = bridge.edge.worldAngleDeg;
  const turn = ((90 - angle + 540) % 360) - 180;
  const steps = Math.max(1, Math.ceil(Math.abs(turn) / 5));
  for (let i = 0; i <= steps; i++) {
    const a = angle + (turn * i) / steps,
      radius = ringRoadRadius(profile, a);
    const x = base.position[0] + radius * Math.cos((a * Math.PI) / 180);
    const z = base.position[2] + radius * Math.sin((a * Math.PI) / 180);
    route.push([x, heightAt(field, x, z) + 0.05, z]);
  }
  route.push([base.position[0], 4.25, base.position[2] + 26]);
  route.push([target[0], 4.25, base.position[2] + 24], target);
  const skip = journeyLength(route) - 42;
  if (skip <= 0) return route;
  let distance = 0;
  for (let i = 1; i < route.length; i++) {
    distance += journeyLength([route[i - 1] as Point3, route[i] as Point3]);
    if (distance >= skip) return [journeyPose(route, skip).position, ...route.slice(i)];
  }
  return null;
}
