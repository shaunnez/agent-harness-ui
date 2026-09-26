// Where a squad stands at a building, and the roads it marches between them.
import { stageIds } from "../../domain.ts";
import type { Kingdom } from "../realm.ts";
import type { ReplayPlace } from "../replay/script.ts";
import { type World, roadRadius, stageAngle } from "./world.ts";

type Point = { x: number; y: number };

/** The yard in front of a building, on the town side, nudged sideways by `lane` tiles. */
export function placePoint(world: World, kingdom: Kingdom, place: ReplayPlace, lane = 0): Point {
  if (place === "market") return world.market;
  if (place === "capital") return { x: world.capital.x + 1.8, y: world.capital.y + 1.8 };
  const b = world.buildings.find((item) => item.kingdomId === kingdom.id && item.stage === place);
  if (!b) return { x: kingdom.origin.x, y: kingdom.origin.y };
  const a = Math.atan2(b.y - kingdom.origin.y - 0.5, b.x - kingdom.origin.x - 0.5);
  const inward = b.size / 2 + 1.1;
  return {
    x: b.x - Math.cos(a) * inward - Math.sin(a) * lane,
    y: b.y - Math.sin(a) * inward + Math.cos(a) * lane,
  };
}

function arc(kingdom: Kingdom, from: number, to: number, backward: boolean): Point[] {
  const cx = kingdom.origin.x + 0.5;
  const cy = kingdom.origin.y + 0.5;
  let span = to - from;
  if (backward) while (span > 0) span -= Math.PI * 2;
  else while (span < 0) span += Math.PI * 2;
  const steps = Math.max(2, Math.ceil(Math.abs(span) / 0.15));
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = from + (span * i) / steps;
    return { x: cx + Math.cos(a) * roadRadius, y: cy + Math.sin(a) * roadRadius };
  });
}

const angleOf = (stage: ReplayPlace) =>
  stageAngle(Math.max(0, stageIds.indexOf(stage as never)), stageIds.length);

/** Road from one place to another: out to the ring road, around it, and in again. */
export function marchRoute(
  world: World,
  kingdom: Kingdom,
  from: ReplayPlace,
  to: ReplayPlace,
  backward = false,
  lane = 0,
) {
  const end = placePoint(world, kingdom, to, lane);
  if (from === "market") {
    const trade = world.paths.find((path) => path.id === `trade-${kingdom.id}`)?.points ?? [];
    const inbound = [...trade].reverse();
    const gate = inbound[inbound.length - 1] ?? end;
    const gateAngle = Math.atan2(gate.y - kingdom.origin.y - 0.5, gate.x - kingdom.origin.x - 0.5);
    const forward = arc(kingdom, gateAngle, angleOf(to), false);
    const back = arc(kingdom, gateAngle, angleOf(to), true);
    return [...inbound, ...(forward.length <= back.length ? forward : back), end];
  }
  const start = placePoint(world, kingdom, from, lane);
  return [start, ...arc(kingdom, angleOf(from), angleOf(to), backward), end];
}
