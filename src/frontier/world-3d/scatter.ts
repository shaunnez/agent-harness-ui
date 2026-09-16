import { colonyEdges, parcelPlateauRadius } from "./colony.ts";

/**
 * Seeded parcel scatter for Contract 2.0 land. Every project gets its own arrangement of purple
 * trees, boulders, lantern posts and parked vehicles from one shared kit, placed on its rocky parcel
 * from a hash of the project key so the layout is stable across reloads and different for every
 * neighbour. The ground is described to the layout, not baked into it: coast radius per angle, the
 * flat radius, and a height/slope sampler, all parcel-local. Nothing here reads task or run state.
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
export interface ScatterGround {
  hub: boolean;
  /** Radius of the flat ground (HQ plateau or landing pad). */
  flatRadius: number;
  /** Coast radius at a parcel-local world angle in degrees. */
  coast(angleDeg: number): number;
  /** Parcel-local height and slope (degrees). */
  ground(x: number, z: number): { height: number; slope: number };
  /** World angles (deg) of the edges with a spur and pad. */
  builtEdgeAngles: number[];
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
  /** Planting starts just off the flat ground and stops short of the cliff lip. */
  treeInset: [1.5, 2.0] as [number, number],
  /** Clear of every spur corridor (built or not) so growth never lands a bridge in a copse. */
  corridorHalfWidth: 4.5,
  /** No trees in the front arc so the court and bay stay readable from the exterior camera. */
  frontArcDeg: [55, 125] as [number, number],
  clusterSize: [5, 12] as [number, number],
  /** Trees need ground, not rock face or splash shelf. */
  treeMinHeight: 3.2,
  treeMaxSlopeDeg: 32,
  boulderMaxSlopeDeg: 58,
  /** Court apron where vehicles park (parcel-local). */
  apron: { x: [-11.5, 11.5] as [number, number], z: [15.5, 25] as [number, number] },
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
/** Distance from the nearest spur corridor centre line, measured only outside the flat ground. */
export function corridorDistance(x: number, z: number, flatRadius = parcelPlateauRadius) {
  let nearest = Number.POSITIVE_INFINITY;
  for (const edge of colonyEdges) {
    const a = toRadians(edge.worldAngleDeg);
    const along = x * Math.cos(a) + z * Math.sin(a);
    if (along > flatRadius - 3) nearest = Math.min(nearest, Math.abs(-x * Math.sin(a) + z * Math.cos(a)));
  }
  return nearest;
}
const inFrontArc = (angleDeg: number) => {
  const a = ((angleDeg % 360) + 360) % 360;
  return a >= scatterRules.frontArcDeg[0] && a <= scatterRules.frontArcDeg[1];
};
const polar = (r: number, angleDeg: number): [number, number] => [
  r * Math.cos(toRadians(angleDeg)),
  r * Math.sin(toRadians(angleDeg)),
];
const angleOf = (x: number, z: number) => (Math.atan2(z, x) * 180) / Math.PI;

/**
 * Parcel-local placements for one project (or the landing terrace when `ground.hub`), y unresolved:
 * the renderer drops each piece onto the field. Deterministic in `key` and the ground description.
 */
export function scatterLayout(key: string, ground: ScatterGround): ScatterPlacement[] {
  const random = seeded(hash(`${ground.hub ? "hub" : "parcel"}:${key}`));
  const between = (low: number, high: number) => low + random() * (high - low);
  const pick = <T>(values: readonly T[]) => values[Math.floor(random() * values.length)] as T;
  const result: ScatterPlacement[] = [];
  const near = (x: number, z: number, distance: number, kind?: ScatterKind) =>
    result.some((other) => (!kind || other.kind === kind) && Math.hypot(other.x - x, other.z - z) < distance);
  const shoulder = (angleDeg: number) => [
    ground.flatRadius + scatterRules.treeInset[0],
    ground.coast(angleDeg) - scatterRules.treeInset[1],
  ];
  // Purple copses on the rear and side arcs, on ground that is neither rock face nor shelf. Cluster
  // centres go where the shoulder is widest, so small parcels still carry a copse.
  const clusters = ground.hub ? 1 : random() < 0.5 ? 2 : 3;
  const candidates: { angle: number; width: number }[] = [];
  for (let i = 0; i < 14; i++) {
    const angle = between(130, 410);
    if (!ground.hub && inFrontArc(angle)) continue;
    const [inner, outer] = shoulder(angle);
    const mid = polar(((inner ?? 22) + (outer ?? 26)) / 2, angle);
    const width =
      (outer ?? 26) - (inner ?? 22) - (corridorDistance(mid[0], mid[1], ground.flatRadius) < 5 ? 6 : 0);
    candidates.push({ angle, width });
  }
  candidates.sort((a, b) => b.width - a.width);
  const chosen: number[] = [];
  for (const candidate of candidates) {
    if (chosen.length >= clusters) break;
    if (chosen.some((angle) => Math.abs(((((angle - candidate.angle) % 360) + 540) % 360) - 180) < 40))
      continue;
    chosen.push(candidate.angle);
  }
  for (const centreAngle of chosen) {
    const [inner, outer] = shoulder(centreAngle);
    const centre = polar(between(inner ?? 22, Math.max(inner ?? 22, outer ?? 26)), centreAngle);
    const size = ground.hub
      ? Math.round(between(3, 5))
      : Math.round(between(scatterRules.clusterSize[0], scatterRules.clusterSize[1]));
    const spread = between(3, 5.5);
    let planted = 0;
    for (let attempt = 0; attempt < size * 8 && planted < size; attempt++) {
      const angle = random() * Math.PI * 2;
      const distance = Math.sqrt(random()) * spread;
      const x = centre[0] + Math.cos(angle) * distance;
      const z = centre[1] + Math.sin(angle) * distance;
      const angleDeg = angleOf(x, z);
      const r = Math.hypot(x, z);
      const [low, high] = shoulder(angleDeg);
      if (!ground.hub && inFrontArc(angleDeg)) continue;
      if (r < (low ?? 0) || r > (high ?? 0)) continue;
      if (corridorDistance(x, z, ground.flatRadius) < scatterRules.corridorHalfWidth) continue;
      const at = ground.ground(x, z);
      if (at.height < scatterRules.treeMinHeight || at.slope > scatterRules.treeMaxSlopeDeg) continue;
      if (near(x, z, 1.6, "tree")) continue;
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
  // Boulders along the cliff lip and on the outcrops.
  const boulders = Math.round(between(ground.hub ? 4 : 7, ground.hub ? 7 : 11));
  for (let attempt = 0, placed = 0; attempt < boulders * 8 && placed < boulders; attempt++) {
    const angle = between(0, 360);
    const coast = ground.coast(angle);
    const [x, z] = polar(between(coast - 5.5, coast - 0.8), angle);
    if (corridorDistance(x, z, ground.flatRadius) < 4) continue;
    const at = ground.ground(x, z);
    if (at.height < 0.8 || at.slope > scatterRules.boulderMaxSlopeDeg) continue;
    if (near(x, z, 2.2)) continue;
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
  // Lantern posts: two along every built spur, four at the court apron corners (or around the pad).
  const lantern = (x: number, z: number, rotation: number) =>
    result.push({ kind: "lantern", item: lanternItem, x, z, rotation, scale: 1 });
  for (const angle of ground.builtEdgeAngles) {
    const a = toRadians(angle);
    for (const along of [ground.flatRadius + 2.5, ground.flatRadius + 6.5]) {
      const side = 3.1;
      lantern(
        along * Math.cos(a) - side * Math.sin(a),
        along * Math.sin(a) + side * Math.cos(a),
        -a + Math.PI / 2,
      );
    }
  }
  if (ground.hub) {
    for (let i = 0; i < 4; i++) {
      const angle = 45 + i * 90;
      if (ground.builtEdgeAngles.some((edge) => Math.abs(((((angle - edge) % 360) + 540) % 360) - 180) < 20))
        continue;
      const [x, z] = polar(ground.flatRadius + 1.4, angle);
      lantern(x, z, -toRadians(angle) + Math.PI / 2);
    }
  } else {
    const { apron } = scatterRules;
    for (const x of [apron.x[0] - 0.8, apron.x[1] + 0.8])
      for (const z of [apron.z[0], apron.z[1]]) lantern(x, z, x < 0 ? 0 : Math.PI);
  }
  // Parked vehicles on the court apron, clear of the bay doors and the robots' court sockets.
  const vehicles = ground.hub ? 1 : 2;
  for (let attempt = 0, parked = 0; attempt < 24 && parked < vehicles; attempt++) {
    let x: number, z: number;
    if (ground.hub) {
      const angle = between(0, 360);
      if (ground.builtEdgeAngles.some((edge) => Math.abs(((((angle - edge) % 360) + 540) % 360) - 180) < 25))
        continue;
      [x, z] = polar(ground.flatRadius - 2.5, angle);
    } else {
      const side = parked === 0 ? -1 : 1;
      x = side * between(8.2, 10.2);
      z = between(scatterRules.apron.z[0] + 1.5, scatterRules.apron.z[1] - 1.5);
    }
    if (near(x, z, 6, "vehicle")) continue;
    result.push({
      kind: "vehicle",
      item: vehicleItems[parked % vehicleItems.length] as string,
      x,
      z,
      rotation: (random() < 0.5 ? 0 : Math.PI) + between(-0.2, 0.2),
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
