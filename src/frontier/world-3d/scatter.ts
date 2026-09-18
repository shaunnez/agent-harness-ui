import { colonyEdges, parcelPlateauRadius } from "./colony.ts";
import { shuttleKeepOut } from "./shuttle-placement.ts";

/**
 * Seeded parcel scatter for Contract 2.0 land (environment pass). Every project gets its own
 * arrangement of purple trees, scrub, grass, reeds, scanned cliff pieces, rocks, crystal clusters,
 * lantern posts and parked vehicles from one shared kit, placed on its rocky parcel from a hash of the
 * project key so the layout is stable across reloads and different for every neighbour. The ground is
 * described to the layout, not baked into it: coast radius per angle, the flat radius, a height/slope
 * sampler, the stream and the shelf, all parcel-local. Nothing here reads task or run state.
 */
export type ScatterKind =
  | "tree"
  | "scrub"
  | "grass"
  | "reed"
  | "cliff"
  | "rock"
  | "boulder"
  | "shore"
  | "crystal"
  | "lantern"
  | "vehicle";
export interface ScatterPlacement {
  kind: ScatterKind;
  /** Kit root name, e.g. `MF_Tree_Purple_A`. */
  item: string;
  x: number;
  z: number;
  /** Radians about +Y. */
  rotation: number;
  scale: number;
  /** Radians about the piece's own X axis after the yaw (cliff pieces lean their face outward). */
  tilt?: number;
}
export interface ScatterWater {
  /** World angle (deg) of the waterfall. */
  fallAngleDeg: number;
  pools: { x: number; z: number; radius: number }[];
  /** Channel centre line, parcel-local, spring first. */
  path: { x: number; z: number }[];
  halfWidth: number;
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
  /** The parcel's stream, if it has one. */
  water?: ScatterWater | null;
  /** World angle range (deg) of the low wave-cut shelf, if any. */
  shelf?: [number, number] | null;
}
/** Four scanned blossom silhouettes. The flat-card E, F, G and olive trees were dropped from the kit
 * when the scans landed: beside a scanned canopy they read as painted blobs rather than foliage. */
export const treeItems = [
  "MF_Tree_Purple_A",
  "MF_Tree_Purple_B",
  "MF_Tree_Purple_C",
  "MF_Tree_Purple_D",
] as const;
export const bareTreeItem = "MF_Tree_Bare_A";
export const scrubItems = ["MF_Scrub_Purple_A", "MF_Scrub_Purple_B", "MF_Scrub_Olive_A"] as const;
export const grassItems = ["MF_Grass_A", "MF_Grass_B"] as const;
export const reedItems = ["MF_Reed_A", "MF_Reed_B"] as const;
export const cliffItems = ["MF_Cliff_A", "MF_Cliff_B", "MF_Cliff_C"] as const;
export const largeRockItems = ["MF_Rock_Large_A", "MF_Rock_Large_B"] as const;
export const boulderItems = ["MF_Boulder_A", "MF_Boulder_B", "MF_Boulder_C"] as const;
export const shoreRockItems = ["MF_Rock_Shore_A", "MF_Rock_Shore_B", "MF_Rock_Shore_C"] as const;
export const crystalItems = ["MF_Crystal_A", "MF_Crystal_B", "MF_Crystal_C"] as const;
export const lanternItem = "MF_Lantern";
export const vehicleItems = ["MF_Vehicle_Rover", "MF_Vehicle_Cart"] as const;
export const scatterItems = [
  ...treeItems,
  bareTreeItem,
  ...scrubItems,
  ...grassItems,
  ...reedItems,
  ...cliffItems,
  ...largeRockItems,
  ...boulderItems,
  ...shoreRockItems,
  ...crystalItems,
  lanternItem,
  ...vehicleItems,
];
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
  clusterSize: [3, 7] as [number, number],
  /** Trunk-to-trunk minimum. Scanned canopies span 5.3 m to 9.5 m across, so anything under about
   * four metres interlocks them into one mass instead of reading as separate trees. */
  treeSpacing: 4.0,
  /** Trees need ground, not rock face or splash shelf. */
  treeMinHeight: 3.2,
  treeMaxSlopeDeg: 32,
  boulderMaxSlopeDeg: 58,
  /** Court apron where vehicles park (parcel-local). */
  apron: { x: [-11.5, 11.5] as [number, number], z: [15.5, 25] as [number, number] },
  /** Cliff pieces hang from the lip this far (deg) from a built edge (pad and bridge), from any other edge line, and from the waterfall. */
  cliffEdgeClearanceDeg: 24,
  cliffLineClearanceDeg: 9,
  cliffFallClearanceDeg: 16,
  cliffSpacingDeg: 26,
  cliffScale: [0.6, 0.85] as [number, number],
  /** Cliff pieces sit this far inside the coast line and lean outward by this much (radians). */
  cliffInset: 1.4,
  cliffLean: [0.08, 0.22] as [number, number],
  /** Shoreline rocks sit in the toe water this far beyond the coast, clear of every bridge line. */
  shoreReach: [1.2, 4.0] as [number, number],
  shoreEdgeClearanceDeg: 16,
  /** Crystal clusters per project parcel. */
  crystals: [2, 4] as [number, number],
  /** Nothing but reeds within this distance of the stream or its pools. */
  waterClearance: 2.5,
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
/** Shortest angular distance in degrees. */
export const angularGap = (a: number, b: number) => Math.abs(((((a - b) % 360) + 540) % 360) - 180);
/** Smallest angular distance from any edge line (or from the given edge angles only). */
export function edgeGap(
  angleDeg: number,
  edgeAngles: number[] = colonyEdges.map((edge) => edge.worldAngleDeg),
) {
  return Math.min(Number.POSITIVE_INFINITY, ...edgeAngles.map((edge) => angularGap(angleDeg, edge)));
}
/** Distance from the stream (channel centre line or pool rim); infinite without a stream. */
export function waterDistance(water: ScatterWater | null | undefined, x: number, z: number) {
  if (!water) return Number.POSITIVE_INFINITY;
  let best = Number.POSITIVE_INFINITY;
  for (const pool of water.pools) best = Math.min(best, Math.hypot(x - pool.x, z - pool.z) - pool.radius);
  for (let i = 0; i < water.path.length - 1; i++) {
    const p = water.path[i] as { x: number; z: number };
    const q = water.path[i + 1] as { x: number; z: number };
    const ex = q.x - p.x,
      ez = q.z - p.z;
    const t = Math.max(0, Math.min(1, ((x - p.x) * ex + (z - p.z) * ez) / (ex * ex + ez * ez || 1)));
    best = Math.min(best, Math.hypot(p.x + ex * t - x, p.z + ez * t - z) - water.halfWidth);
  }
  return best;
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
/** Rotation about +Y that turns a kit item's +Z face toward the outward radial at `angleDeg`. */
export const facingOutward = (angleDeg: number) => Math.PI / 2 - toRadians(angleDeg);

/**
 * Parcel-local placements for one project (or the landing terrace when `ground.hub`), y unresolved:
 * the renderer drops each piece onto the field. Deterministic in `key` and the ground description.
 */
export function scatterLayout(key: string, ground: ScatterGround): ScatterPlacement[] {
  const random = seeded(hash(`${ground.hub ? "hub" : "parcel"}:${key}`));
  const between = (low: number, high: number) => low + random() * (high - low);
  const pick = <T>(values: readonly T[]) => values[Math.floor(random() * values.length)] as T;
  const result: ScatterPlacement[] = [];
  const water = ground.water ?? null;
  const near = (x: number, z: number, distance: number, kind?: ScatterKind) =>
    result.some((other) => (!kind || other.kind === kind) && Math.hypot(other.x - x, other.z - z) < distance);
  const shoulder = (angleDeg: number) => [
    ground.flatRadius + scatterRules.treeInset[0],
    ground.coast(angleDeg) - scatterRules.treeInset[1],
  ];
  const place = (kind: ScatterKind, item: string, x: number, z: number, rotation: number, scale: number) => {
    result.push({ kind, item, x, z, rotation, scale });
  };
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
      (outer ?? 26) -
      (inner ?? 22) -
      (corridorDistance(mid[0], mid[1], ground.flatRadius) < 5 ? 6 : 0) -
      (waterDistance(water, mid[0], mid[1]) < 4 ? 6 : 0);
    candidates.push({ angle, width });
  }
  candidates.sort((a, b) => b.width - a.width);
  const chosen: number[] = [];
  for (const candidate of candidates) {
    if (chosen.length >= clusters) break;
    if (chosen.some((angle) => angularGap(angle, candidate.angle) < 40)) continue;
    chosen.push(candidate.angle);
  }
  let bare = 0;
  for (const centreAngle of chosen) {
    const [inner, outer] = shoulder(centreAngle);
    const centre = polar(between(inner ?? 22, Math.max(inner ?? 22, outer ?? 26)), centreAngle);
    const size = ground.hub
      ? Math.round(between(3, 5))
      : Math.round(between(scatterRules.clusterSize[0], scatterRules.clusterSize[1]));
    const spread = between(4.5, 7.5);
    let planted = 0;
    // Wider spacing rejects more candidates, so a tight parcel needs more tries to still carry a copse.
    for (let attempt = 0; attempt < size * 16 && planted < size; attempt++) {
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
      if (waterDistance(water, x, z) < scatterRules.waterClearance) continue;
      const at = ground.ground(x, z);
      if (at.height < scatterRules.treeMinHeight || at.slope > scatterRules.treeMaxSlopeDeg) continue;
      if (near(x, z, scatterRules.treeSpacing, "tree")) continue;
      // The four blossom silhouettes, with a bare trunk or two per parcel so a copse does not repeat.
      const roll = random();
      let item: string;
      if (roll < 0.88 || bare >= 2) item = treeItems[Math.floor(random() * treeItems.length)] as string;
      else {
        item = bareTreeItem;
        bare++;
      }
      place("tree", item, x, z, random() * Math.PI * 2, between(0.85, 1.1));
      planted++;
    }
  }
  // Scanned cliff pieces hang from the lip, faces to the sea, clear of every bridge line and the fall.
  const cliffs = Math.round(between(ground.hub ? 3 : 5, ground.hub ? 4 : 7));
  const cliffAngles: number[] = [];
  for (let attempt = 0; attempt < cliffs * 14 && cliffAngles.length < cliffs; attempt++) {
    const angle = between(0, 360);
    if (edgeGap(angle, ground.builtEdgeAngles) < scatterRules.cliffEdgeClearanceDeg) continue;
    if (edgeGap(angle) < scatterRules.cliffLineClearanceDeg) continue;
    if (water && angularGap(angle, water.fallAngleDeg) < scatterRules.cliffFallClearanceDeg) continue;
    if (cliffAngles.some((other) => angularGap(other, angle) < scatterRules.cliffSpacingDeg)) continue;
    cliffAngles.push(angle);
    const [x, z] = polar(ground.coast(angle) - scatterRules.cliffInset, angle);
    result.push({
      kind: "cliff",
      item: pick(cliffItems),
      x,
      z,
      rotation: facingOutward(angle) + between(-0.08, 0.08),
      scale: between(scatterRules.cliffScale[0], scatterRules.cliffScale[1]),
      tilt: between(scatterRules.cliffLean[0], scatterRules.cliffLean[1]),
    });
  }
  // Large rocks on the shoulder, off the court arc, the corridors, the stream and the copses.
  const large = ground.hub ? 1 : Math.round(between(2, 3));
  for (let attempt = 0, placed = 0; attempt < large * 16 && placed < large; attempt++) {
    const angle = between(0, 360);
    if (!ground.hub && inFrontArc(angle)) continue;
    const [x, z] = polar(between(ground.flatRadius + 3, ground.coast(angle) - 4.5), angle);
    if (corridorDistance(x, z, ground.flatRadius) < 5.5) continue;
    if (waterDistance(water, x, z) < 4) continue;
    const at = ground.ground(x, z);
    if (at.height < 3.2 || at.slope > 35) continue;
    if (near(x, z, 3.2)) continue;
    place("rock", pick(largeRockItems), x, z, random() * Math.PI * 2, between(0.7, 1.2));
    placed++;
  }
  // Medium boulders along the cliff lip and on the outcrops.
  const boulders = Math.round(between(ground.hub ? 4 : 7, ground.hub ? 7 : 11));
  for (let attempt = 0, placed = 0; attempt < boulders * 8 && placed < boulders; attempt++) {
    const angle = between(0, 360);
    const coast = ground.coast(angle);
    const [x, z] = polar(between(coast - 5.5, coast - 0.8), angle);
    if (corridorDistance(x, z, ground.flatRadius) < 4) continue;
    if (waterDistance(water, x, z) < scatterRules.waterClearance) continue;
    const at = ground.ground(x, z);
    if (at.height < 0.8 || at.slope > scatterRules.boulderMaxSlopeDeg) continue;
    if (near(x, z, 2.2)) continue;
    place("boulder", pick(boulderItems), x, z, random() * Math.PI * 2, between(0.7, 1.6));
    placed++;
  }
  // Shoreline rocks in the toe water, clear of every bridge line and the fall.
  const shore = Math.round(between(ground.hub ? 4 : 6, ground.hub ? 6 : 10));
  for (let attempt = 0, placed = 0; attempt < shore * 10 && placed < shore; attempt++) {
    const angle = between(0, 360);
    if (edgeGap(angle, ground.builtEdgeAngles) < scatterRules.shoreEdgeClearanceDeg) continue;
    if (edgeGap(angle) < 6) continue;
    if (water && angularGap(angle, water.fallAngleDeg) < 9) continue;
    const [x, z] = polar(ground.coast(angle) + between(...scatterRules.shoreReach), angle);
    if (near(x, z, 3.0, "shore")) continue;
    place("shore", pick(shoreRockItems), x, z, random() * Math.PI * 2, between(0.8, 1.6));
    placed++;
  }
  // Scrub: low bushes near the copses and rocks, never in the front arc.
  const scrub = Math.round(between(ground.hub ? 3 : 6, ground.hub ? 4 : 10));
  for (let attempt = 0, placed = 0; attempt < scrub * 10 && placed < scrub; attempt++) {
    const angle = between(0, 360);
    if (!ground.hub && inFrontArc(angle)) continue;
    const [x, z] = polar(between(ground.flatRadius + 1.0, ground.coast(angle) - 1.5), angle);
    if (corridorDistance(x, z, ground.flatRadius) < 3.5) continue;
    if (waterDistance(water, x, z) < scatterRules.waterClearance) continue;
    const at = ground.ground(x, z);
    if (at.height < 3.2 || at.slope > 38) continue;
    if (near(x, z, 1.3)) continue;
    place("scrub", pick(scrubItems), x, z, random() * Math.PI * 2, between(0.8, 1.3));
    placed++;
  }
  // Grass tufts anywhere on the shoulder ground, sparse.
  const grass = Math.round(between(ground.hub ? 5 : 14, ground.hub ? 8 : 22));
  for (let attempt = 0, placed = 0; attempt < grass * 6 && placed < grass; attempt++) {
    const angle = between(0, 360);
    const [x, z] = polar(between(ground.flatRadius + 0.8, ground.coast(angle) - 1.2), angle);
    if (corridorDistance(x, z, ground.flatRadius) < 3.5) continue;
    if (waterDistance(water, x, z) < 1.0) continue;
    const at = ground.ground(x, z);
    if (at.height < 3.4 || at.slope > 30) continue;
    if (near(x, z, 0.9)) continue;
    place("grass", pick(grassItems), x, z, random() * Math.PI * 2, between(0.8, 1.3));
    placed++;
  }
  // Reeds at the pools, along the channel banks and on the wave-cut shelf.
  if (water) {
    for (const pool of water.pools) {
      const count = Math.round(between(3, 5));
      for (let attempt = 0, placed = 0; attempt < count * 6 && placed < count; attempt++) {
        const angle = between(0, 360);
        const [dx, dz] = polar(pool.radius + between(0.3, 1.0), angle);
        const x = pool.x + dx,
          z = pool.z + dz;
        // The channel leaves the pool: no reeds in the water there.
        if (waterDistance({ ...water, pools: [] }, x, z) < 0.3) continue;
        if (near(x, z, 0.8)) continue;
        const at = ground.ground(x, z);
        if (at.slope > 50) continue;
        place("reed", pick(reedItems), x, z, random() * Math.PI * 2, between(0.8, 1.2));
        placed++;
      }
    }
    for (let i = 2; i < water.path.length - 1; i += 3) {
      const p = water.path[i] as { x: number; z: number };
      const q = water.path[i + 1] as { x: number; z: number };
      const length = Math.hypot(q.x - p.x, q.z - p.z) || 1;
      const side = random() < 0.5 ? 1 : -1;
      const offset = water.halfWidth + between(0.4, 0.9);
      const x = p.x + (-(q.z - p.z) / length) * offset * side;
      const z = p.z + ((q.x - p.x) / length) * offset * side;
      if (Math.hypot(x, z) > ground.coast(angleOf(x, z)) - 1.5) continue;
      if (near(x, z, 0.8)) continue;
      place("reed", pick(reedItems), x, z, random() * Math.PI * 2, between(0.8, 1.15));
    }
  }
  if (ground.shelf) {
    const [s0, s1] = ground.shelf;
    const count = Math.round(between(3, 5));
    for (let attempt = 0, placed = 0; attempt < count * 8 && placed < count; attempt++) {
      const angle = between(s0 + 3, s1 - 3);
      const [x, z] = polar(between(ground.flatRadius + 5, ground.coast(angle) - 2), angle);
      if (corridorDistance(x, z, ground.flatRadius) < 3.5) continue;
      const at = ground.ground(x, z);
      if (at.height < 1.2 || at.height > 3.2 || at.slope > 30) continue;
      if (near(x, z, 1.0)) continue;
      place("reed", pick(reedItems), x, z, random() * Math.PI * 2, between(0.9, 1.25));
      placed++;
    }
  }
  // Crystal clusters, sparingly: at the cliff shoulder, beside a large rock, at the spring pool.
  if (!ground.hub) {
    const wanted = Math.round(between(scatterRules.crystals[0], scatterRules.crystals[1]));
    const tryCrystal = (x: number, z: number) => {
      if (Math.hypot(x, z) < ground.flatRadius + 1.5) return false;
      if (corridorDistance(x, z, ground.flatRadius) < 5) return false;
      if (waterDistance(water, x, z) < 0.6) return false;
      if (near(x, z, 2.4)) return false;
      const at = ground.ground(x, z);
      if (at.height < 2.5 || at.slope > 45) return false;
      place("crystal", pick(crystalItems), x, z, random() * Math.PI * 2, between(0.7, 1.2));
      return true;
    };
    let placed = 0;
    const rocks = result.filter((p) => p.kind === "rock");
    if (rocks.length && random() < 0.8) {
      const rock = pick(rocks);
      for (let attempt = 0; attempt < 6 && placed < 1; attempt++) {
        const [dx, dz] = polar(between(2.2, 3.2), between(0, 360));
        if (tryCrystal(rock.x + dx, rock.z + dz)) placed++;
      }
    }
    if (water && placed < wanted) {
      const pool = water.pools[0] as { x: number; z: number; radius: number };
      for (let attempt = 0; attempt < 8 && placed < 2; attempt++) {
        const [dx, dz] = polar(pool.radius + between(1.3, 2.2), between(0, 360));
        if (tryCrystal(pool.x + dx, pool.z + dz)) placed++;
      }
    }
    for (let attempt = 0; attempt < 30 && placed < wanted; attempt++) {
      const angle = between(150, 330);
      if (water && angularGap(angle, water.fallAngleDeg) < 10) continue;
      const [x, z] = polar(ground.coast(angle) - between(2.0, 3.8), angle);
      if (tryCrystal(x, z)) placed++;
    }
  }
  // Lantern posts: two along every built spur, four at the court apron corners (or around the pad).
  const lantern = (x: number, z: number, rotation: number) =>
    place("lantern", lanternItem, x, z, rotation, 1);
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
      if (ground.builtEdgeAngles.some((edge) => angularGap(angle, edge) < 20)) continue;
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
      if (ground.builtEdgeAngles.some((edge) => angularGap(angle, edge) < 25)) continue;
      // Beyond the pad, not on it: the hub's flat radius is the pad itself, and a service truck
      // parked against an 18 m transport reads as a collision rather than a working apron.
      [x, z] = polar(ground.flatRadius + 3.5, angle);
      if (Math.hypot(x - shuttleKeepOut.x, z - shuttleKeepOut.z) < shuttleKeepOut.radius) continue;
    } else {
      const side = parked === 0 ? -1 : 1;
      x = side * between(8.2, 10.2);
      z = between(scatterRules.apron.z[0] + 1.5, scatterRules.apron.z[1] - 1.5);
    }
    if (near(x, z, 6, "vehicle")) continue;
    place(
      "vehicle",
      vehicleItems[parked % vehicleItems.length] as string,
      x,
      z,
      (random() < 0.5 ? 0 : Math.PI) + between(-0.2, 0.2),
      1,
    );
    parked++;
  }
  return result;
}
/** A compact fingerprint so tests and evidence can show ten projects produce ten different layouts. */
export function scatterFingerprint(placements: ScatterPlacement[]) {
  return hash(placements.map((p) => `${p.item}@${p.x.toFixed(2)},${p.z.toFixed(2)}`).join("|")).toString(16);
}
