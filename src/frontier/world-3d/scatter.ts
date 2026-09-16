import { colonyEdges, parcelPlateauRadius, type Point2 } from "./colony.ts";

/**
 * Seeded parcel scatter. Every project gets its own arrangement of purple trees, boulders, lantern
 * posts and parked vehicles from one shared kit, placed at load from a hash of the project key so the
 * layout is stable across reloads and different for every neighbour. Nothing here is baked into an
 * asset and nothing reads task or run state.
 */
export type ScatterKind = "tree" | "boulder" | "lantern" | "vehicle";
export interface ScatterPlacement {
  kind: ScatterKind;
  /** Kit root name, e.g. `MF_Tree_Purple_A`. */
  item: string;
  x: number;
  z: number;
  /** Radians about +Y. */
  rotation: number;
  scale: number;
}
export const treeItems = [
  "MF_Tree_Purple_A",
  "MF_Tree_Purple_B",
  "MF_Tree_Purple_C",
  "MF_Tree_Purple_D",
] as const;
export const oliveTreeItem = "MF_Tree_Olive_A";
export const boulderItems = ["MF_Boulder_A", "MF_Boulder_B", "MF_Boulder_C"] as const;
export const lanternItem = "MF_Lantern";
export const vehicleItems = ["MF_Vehicle_Rover", "MF_Vehicle_Cart"] as const;
export const scatterItems = [...treeItems, oliveTreeItem, ...boulderItems, lanternItem, ...vehicleItems];
/** Lantern lamp position above its foot, from the kit. */
export const lanternLampOffset: [number, number, number] = [0, 2.72, 0];

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
export const scatterRules = {
  /** Planting stays off the flat plateau; the cliff lip is about 42 m out. */
  minRadius: parcelPlateauRadius + 1.2,
  maxTreeRadius: 41.5,
  /** Clear of every spur corridor (built or not) so growth never lands a bridge in a copse. */
  corridorHalfWidth: 7,
  /** No trees in the front arc so the court and bay stay readable from the exterior camera. */
  frontArcDeg: [50, 130] as [number, number],
  clusterSize: [5, 12] as [number, number],
};

function hash(value: string) {
  let n = 2166136261;
  for (const char of value) n = Math.imul(n ^ char.charCodeAt(0), 16777619);
  return n >>> 0;
}
/** mulberry32: small, fast and deterministic. */
function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Distance from the nearest spur corridor centre line, measured only outside the ring road. */
export function corridorDistance(x: number, z: number) {
  let nearest = Number.POSITIVE_INFINITY;
  for (const edge of colonyEdges) {
    const a = toRadians(edge.worldAngleDeg);
    const along = x * Math.cos(a) + z * Math.sin(a);
    if (along > 28) nearest = Math.min(nearest, Math.abs(-x * Math.sin(a) + z * Math.cos(a)));
  }
  return nearest;
}
const inFrontArc = (angleDeg: number) => {
  const a = ((angleDeg % 360) + 360) % 360;
  return a >= scatterRules.frontArcDeg[0] && a <= scatterRules.frontArcDeg[1];
};
const polar = (r: number, angleDeg: number): Point2 => [
  r * Math.cos(toRadians(angleDeg)),
  r * Math.sin(toRadians(angleDeg)),
];

/**
 * Parcel-local placements for one project (or the hub with `{ hub: true }`), y unresolved: the
 * renderer drops each piece onto the terrain mesh. Deterministic in `key`.
 */
export function scatterLayout(key: string, options: { hub?: boolean } = {}): ScatterPlacement[] {
  const random = seeded(hash(`${options.hub ? "hub" : "parcel"}:${key}`));
  const between = (low: number, high: number) => low + random() * (high - low);
  const pick = <T>(values: readonly T[]) => values[Math.floor(random() * values.length)] as T;
  const result: ScatterPlacement[] = [];
  const clear = (x: number, z: number, minRadius: number, maxRadius: number, corridor: number) => {
    const r = Math.hypot(x, z);
    return r >= minRadius && r <= maxRadius && corridorDistance(x, z) >= corridor;
  };
  // Purple copses of five to twelve trees on the rear and side arcs.
  const clusters = options.hub ? 1 : random() < 0.5 ? 2 : 3;
  for (let c = 0; c < clusters; c++) {
    let centreAngle = between(130, 410);
    for (
      let attempt = 0;
      attempt < 12 && (inFrontArc(centreAngle) || !clear(...polar(38.4, centreAngle), 36, 41, 9));
      attempt++
    )
      centreAngle = between(130, 410);
    const size = Math.round(between(scatterRules.clusterSize[0], scatterRules.clusterSize[1]));
    const spread = between(3, 5);
    let planted = 0;
    for (let attempt = 0; attempt < size * 4 && planted < size; attempt++) {
      const centre = polar(38.4, centreAngle);
      const angle = random() * Math.PI * 2;
      const distance = Math.sqrt(random()) * spread;
      const x = centre[0] + Math.cos(angle) * distance;
      const z = centre[1] + Math.sin(angle) * distance;
      const angleDeg = (Math.atan2(z, x) * 180) / Math.PI;
      if (inFrontArc(angleDeg)) continue;
      if (!clear(x, z, scatterRules.minRadius, scatterRules.maxTreeRadius, scatterRules.corridorHalfWidth))
        continue;
      if (result.some((other) => other.kind === "tree" && Math.hypot(other.x - x, other.z - z) < 1.6))
        continue;
      result.push({
        kind: "tree",
        item: random() < 0.82 ? pick(treeItems) : oliveTreeItem,
        x,
        z,
        rotation: random() * Math.PI * 2,
        scale: between(0.8, 1.25),
      });
      planted++;
    }
  }
  // Boulders on the shoulder and the cliff lip.
  const boulders = Math.round(between(options.hub ? 5 : 7, options.hub ? 8 : 11));
  for (let attempt = 0, placed = 0; attempt < boulders * 6 && placed < boulders; attempt++) {
    const angle = between(0, 360);
    const [x, z] = polar(between(36, 42.5), angle);
    if (!clear(x, z, 35.5, 43, 5)) continue;
    if (result.some((other) => Math.hypot(other.x - x, other.z - z) < 2.2)) continue;
    result.push({
      kind: "boulder",
      item: pick(boulderItems),
      x,
      z,
      rotation: random() * Math.PI * 2,
      scale: between(0.7, 1.6),
    });
    placed++;
  }
  // Lantern posts on the outer kerb of the ring road, between the spur mouths.
  for (let i = 0; i < 6; i++) {
    const angle = i * 60 + between(-9, 9);
    const [x, z] = polar(33.3, angle);
    result.push({
      kind: "lantern",
      item: lanternItem,
      x,
      z,
      rotation: -toRadians(angle) + Math.PI / 2,
      scale: 1,
    });
  }
  // Two parked vehicles on the ring road, tangent to the lane, away from the front and the spur mouths.
  const vehicles = options.hub ? 1 : 2;
  for (let attempt = 0, parked = 0; attempt < 24 && parked < vehicles; attempt++) {
    const angle = between(140, 340);
    const nearestSpur = Math.min(
      ...[30, 90, 150, 210, 270, 330].map((spur) => Math.abs(((((angle - spur) % 360) + 540) % 360) - 180)),
    );
    if (nearestSpur < 9) continue;
    const [x, z] = polar(between(29.2, 30.8), angle);
    if (result.some((other) => other.kind === "vehicle" && Math.hypot(other.x - x, other.z - z) < 8))
      continue;
    result.push({
      kind: "vehicle",
      item: vehicleItems[parked % vehicleItems.length] as string,
      x,
      z,
      rotation: -toRadians(angle) + (random() < 0.5 ? 0 : Math.PI) + between(-0.12, 0.12),
      scale: 1,
    });
    parked++;
  }
  return result;
}
/** A compact fingerprint so tests and evidence can show ten projects produce ten different layouts. */
export function scatterFingerprint(placements: ScatterPlacement[]) {
  return hash(placements.map((p) => `${p.item}@${p.x.toFixed(2)},${p.z.toFixed(2)}`).join("|")).toString(16);
}
