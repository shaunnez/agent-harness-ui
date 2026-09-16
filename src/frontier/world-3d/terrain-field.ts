import {
  builtEdges,
  type ColonyEdge,
  colonyContract,
  colonyEdges,
  colonySlot,
  hubSlot,
  type Point2,
} from "./colony.ts";

/**
 * Contract 2.0 land: a runtime height field instead of baked parcel tiles. Every occupied slot
 * contributes a rocky parcel profile seeded by its slot id (so land never changes while the slot is
 * occupied); the colony's height at a point is the highest parcel profile there, which makes the
 * archipelago one continuous, watertight surface with water channels wherever two coasts fall away.
 * Nothing here reads task or run state.
 */
const terrain = colonyContract.terrain;
const levels = colonyContract.levels;
export const seaLevel = levels.sea;
export const seabed = terrain.relief.cliff.toSeabed;
export const plateauLevel = terrain.plateau.level;
export const padLevel = colonyContract.colony.pads.top;
const plateauRadius = terrain.plateau.flatRadius;
const plateauBlend = terrain.plateau.blend;
const apron = terrain.plateau.courtApron;
const padRadial: [number, number] = [terrain.coast.edgeCorridorMax - 4, terrain.coast.edgeCorridorMax];
const padHalfWidth = colonyContract.colony.pads.width / 2;
const spurHalfWidth = colonyContract.colony.spurs.width / 2;
const cliffDrop = terrain.relief.cliff.dropOver;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const smooth = (t: number) => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Shortest signed angular distance in degrees. */
const angleDelta = (a: number, b: number) => ((((a - b) % 360) + 540) % 360) - 180;

function hash(value: string) {
  let n = 2166136261;
  for (const char of value) n = Math.imul(n ^ char.charCodeAt(0), 16777619);
  return n >>> 0;
}
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
/** Deterministic 2D value noise in [-1, 1]; `salt` decorrelates parcels. */
function hash2(ix: number, iz: number, salt: number) {
  let n = (ix * 374761393 + iz * 668265263 + salt * 2246822519) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
export function valueNoise(x: number, z: number, salt = 0) {
  const ix = Math.floor(x),
    iz = Math.floor(z);
  const fx = x - ix,
    fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx),
    sz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, salt),
    b = hash2(ix + 1, iz, salt),
    c = hash2(ix, iz + 1, salt),
    d = hash2(ix + 1, iz + 1, salt);
  return (lerp(lerp(a, b, sx), lerp(c, d, sx), sz) - 0.5) * 2;
}
/** Two-octave ridged noise for cliff jaggedness. */
function ridged(x: number, z: number, salt: number) {
  return 1 - Math.abs(valueNoise(x, z, salt)) * 0.7 - Math.abs(valueNoise(x * 2.3, z * 2.3, salt + 7)) * 0.3;
}

interface Outcrop {
  /** Parcel-local centre. */
  x: number;
  z: number;
  height: number;
  /** Gaussian half-width. */
  width: number;
  /** Elongation direction and ratio. */
  angleDeg: number;
  stretch: number;
}
interface CoastWave {
  frequency: number;
  amplitude: number;
  phase: number;
}
export interface ParcelProfile {
  id: string;
  hub: boolean;
  centre: Point2;
  salt: number;
  waves: CoastWave[];
  coast: { min: number; typical: number; max: number };
  outcrops: Outcrop[];
  /** World angle range (deg) of the low wave-cut shelf, or null. */
  shelf: [number, number] | null;
  /** Radius the flat ground extends to (pad disc on the landing, HQ plateau elsewhere). */
  flatRadius: number;
  flatLevel: number;
  /** Edges with a spur, pad and bridge. */
  built: ColonyEdge[];
}

/** The seeded shape of one parcel; depends only on the slot id and which of its edges are built. */
export function parcelProfile(slotId: string, occupiedSlotIds: Iterable<string>): ParcelProfile {
  const slot = colonySlot(slotId);
  if (!slot) throw new Error(`Unknown colony slot ${slotId}`);
  const hub = slotId === hubSlot.id;
  const random = seeded(hash(`land:${slotId}`));
  const between = (low: number, high: number) => low + random() * (high - low);
  const coast = hub ? terrain.landing.coast : terrain.coast;
  const waves: CoastWave[] = [3, 5, 8, 13].map((frequency, index) => ({
    frequency,
    amplitude: [0.42, 0.28, 0.18, 0.12][index] ?? 0.1,
    phase: random() * Math.PI * 2,
  }));
  const rules = terrain.relief.rearOutcrops;
  const count = hub ? 1 : Math.round(between(rules.count[0] ?? 2, rules.count[1] ?? 3));
  const outcrops: Outcrop[] = [];
  for (let i = 0; i < count; i++) {
    const arc = rules.worldAngleDeg;
    const angle = between(arc[0] ?? 190, arc[1] ?? 300) + (i * 110) / count;
    const radial = hub ? between(13, 17) : between(rules.radial[0] ?? 22, rules.radial[1] ?? 30);
    const a = toRadians(angle);
    outcrops.push({
      x: Math.cos(a) * radial,
      z: Math.sin(a) * radial,
      height: hub ? between(3, 5) : between(rules.height[0] ?? 9, rules.height[1] ?? 14) - plateauLevel,
      width: hub ? between(4, 6) : between(rules.width[0] ?? 8, rules.width[1] ?? 14) / 2,
      angleDeg: angle + between(-35, 35),
      stretch: between(1.2, 1.9),
    });
  }
  const shelfRules = terrain.relief.sideShelves.worldAngleDeg;
  const shelf: [number, number] | null =
    !hub && random() < 0.7
      ? [
          between(shelfRules[0] ?? 0, 15),
          between(Math.max(30, (shelfRules[1] ?? 60) - 15), shelfRules[1] ?? 60),
        ]
      : null;
  return {
    id: slotId,
    hub,
    centre: slot.world,
    salt: hash(`salt:${slotId}`) % 100000,
    waves,
    coast,
    outcrops,
    shelf,
    flatRadius: hub ? terrain.landing.padRadius : plateauRadius,
    flatLevel: hub ? terrain.landing.padTop : plateauLevel,
    built: colonyEdges.filter((edge) => builtEdges(slotId, occupiedSlotIds).has(edge.id)),
  };
}

/** Coast radius R(theta) for a parcel: seeded lobes, clamped so bridges fit and the court stays on land. */
export function coastRadius(profile: ParcelProfile, angleDeg: number) {
  const a = toRadians(angleDeg);
  let wave = 0;
  for (const w of profile.waves) wave += Math.sin(a * w.frequency + w.phase) * w.amplitude;
  const { min, typical, max } = profile.coast;
  let r = wave >= 0 ? lerp(typical, max, Math.min(1, wave)) : lerp(typical, min, Math.min(1, -wave));
  if (!profile.hub) {
    const [front0, front1] = terrain.coast.frontArcDeg;
    const frontCentre = ((front0 ?? 60) + (front1 ?? 120)) / 2;
    const frontHalf = ((front1 ?? 120) - (front0 ?? 60)) / 2;
    const inFront = 1 - smooth((Math.abs(angleDelta(angleDeg, frontCentre)) - frontHalf) / 8);
    r = Math.max(r, lerp(min, terrain.coast.frontArcMin, inFront));
  }
  for (const edge of colonyEdges) {
    const corridor =
      1 -
      smooth(
        (Math.abs(angleDelta(angleDeg, edge.worldAngleDeg)) - terrain.coast.edgeCorridorHalfAngleDeg) / 6,
      );
    r = Math.min(r, lerp(r, terrain.coast.edgeCorridorMax - 0.5, corridor));
  }
  return r;
}

export interface SurfaceSample {
  height: number;
  /** 1 on spur, pad and court apron paving. */
  road: number;
  /** 1 on the flat HQ ground and landing pad. */
  flat: number;
  /** 1 on low wave-cut shelves (shingle). */
  shelf: number;
  /** 1 where the point is land from at least one parcel (above the seabed slope). */
  land: number;
}

/** Signed distance (metres, negative inside) to the flat HQ ground: plateau disc plus court apron. */
function flatDistance(profile: ParcelProfile, dx: number, dz: number) {
  const disc = Math.hypot(dx, dz) - profile.flatRadius;
  if (profile.hub) return disc;
  const ax = Math.max((apron.x[0] ?? -12.5) - dx, dx - (apron.x[1] ?? 12.5), 0);
  const az = Math.max((apron.z[0] ?? 14) - dz, dz - (apron.z[1] ?? 26), 0);
  const inside = Math.max(
    (apron.x[0] ?? -12.5) - dx,
    dx - (apron.x[1] ?? 12.5),
    (apron.z[0] ?? 14) - dz,
    dz - (apron.z[1] ?? 26),
  );
  const rect = ax === 0 && az === 0 ? inside : Math.hypot(ax, az);
  return Math.min(disc, rect);
}

/** One parcel's contribution at a parcel-local point. */
function sampleParcel(profile: ParcelProfile, dx: number, dz: number): SurfaceSample {
  const r = Math.hypot(dx, dz);
  const angleDeg = (Math.atan2(dz, dx) * 180) / Math.PI;
  const coast = coastRadius(profile, angleDeg);
  // Land core: flat ground, then a gently rising shoulder, outcrops behind, shelves in front-left.
  let land = profile.flatLevel;
  const flatD = flatDistance(profile, dx, dz);
  const shoulderT = smooth(flatD / plateauBlend);
  const shoulderRise = (profile.hub ? 0.3 : 0.9) * valueNoise(dx * 0.11, dz * 0.11, profile.salt) + 0.35;
  land = lerp(profile.flatLevel, plateauLevel + shoulderRise, shoulderT);
  // Broken ground: ridged noise part-quantised into ledges, so the shoulder reads as rock terraces
  // rather than a lawn. Zero at the flat edge, full strength two metres out.
  const rough = ridged(dx * 0.13, dz * 0.13, profile.salt + 41);
  const ledge = Math.floor(rough * 3) / 3;
  const relief = (lerp(rough, ledge, 0.6) - 0.5) * (profile.hub ? 1.2 : 2.4);
  land += relief * smooth((flatD - 1.5) / 3);
  let shelf = 0;
  if (profile.shelf) {
    const [s0, s1] = profile.shelf;
    const centre = (s0 + s1) / 2,
      half = (s1 - s0) / 2;
    const inArc = 1 - smooth((Math.abs(angleDelta(angleDeg, centre)) - half) / 10);
    const outward = smooth((r - (profile.flatRadius + 2.5)) / 5);
    shelf = inArc * outward * shoulderT;
    const shelfHeight = lerp(
      terrain.relief.sideShelves.height[0] ?? 1.5,
      terrain.relief.sideShelves.height[1] ?? 3,
      valueNoise(dx * 0.2, dz * 0.2, profile.salt + 3) * 0.5 + 0.5,
    );
    land = lerp(land, shelfHeight, shelf);
  }
  for (const outcrop of profile.outcrops) {
    const a = toRadians(outcrop.angleDeg);
    const ox = dx - outcrop.x,
      oz = dz - outcrop.z;
    const along = (ox * Math.cos(a) + oz * Math.sin(a)) / outcrop.stretch;
    const across = -ox * Math.sin(a) + oz * Math.cos(a);
    const d2 = (along * along + across * across) / (outcrop.width * outcrop.width);
    const bump = Math.exp(-d2 * 1.6) * outcrop.height;
    // Rock, not a dune: ridged noise carves ledges into the blob, and it never rises on flat ground.
    const rock = 0.72 + 0.28 * ridged(dx * 0.19, dz * 0.19, profile.salt + 11);
    land += bump * rock * shoulderT;
  }
  // Cliff: a lip, then a steep jagged drop to the seabed, then flat seabed.
  const jag = (ridged(dx * 0.31, dz * 0.31, profile.salt + 23) - 0.5) * 2.4;
  const edge = coast + jag;
  const over = r - edge;
  let height: number;
  let landMask: number;
  if (over <= 0) {
    // A slight lip rise just before the drop reads as an eroded rim.
    const lip = smooth((over + 3) / 3) * 0.45 * (1 - shelf);
    height = Math.min(land + lip, 14.6);
    landMask = 1;
  } else {
    const t = clamp01(over / cliffDrop);
    // Near-vertical upper face, easing into the toe: 1 - (1 - t)^3 keeps the top steep.
    const fall = 1 - (1 - t) * (1 - t) * (1 - t);
    height = lerp(land, seabed + 0.4 * valueNoise(dx * 0.5, dz * 0.5, profile.salt + 31), fall);
    landMask = 1 - t;
  }
  // Built edges: a level spur from the flat ground to a pad with a vertical seaward face.
  let road = 0;
  let flat = 1 - shoulderT;
  for (const built of profile.built) {
    const a = toRadians(built.worldAngleDeg);
    const along = dx * Math.cos(a) + dz * Math.sin(a);
    const across = Math.abs(-dx * Math.sin(a) + dz * Math.cos(a));
    if (along < profile.flatRadius - 4 || along > padRadial[1] + 2.5) continue;
    const onPad = along >= padRadial[0] - 0.5;
    const halfWidth = onPad ? padHalfWidth : spurHalfWidth;
    const inside = 1 - smooth((across - halfWidth) / 1.6);
    const seaward = 1 - smooth((along - padRadial[1]) / 1.4);
    const weight = inside * seaward;
    if (weight <= 0) continue;
    const ramp = smooth((along - (padRadial[0] - 2)) / 2);
    const level = lerp(plateauLevel, padLevel, ramp);
    // Land is forced under the corridor whatever the coast does, and dropped hard beyond the pad.
    height = lerp(height, Math.max(level, onPad ? level : Math.min(height, level + 0.0)), weight);
    if (weight > 0.5) height = lerp(height, level, smooth((weight - 0.5) / 0.35));
    road = Math.max(road, weight);
    landMask = Math.max(landMask, weight);
    flat = Math.max(flat, weight);
    if (along > padRadial[1] && across < padHalfWidth + 1.5) {
      const drop = smooth((along - padRadial[1]) / 1.6);
      height = Math.min(height, lerp(padLevel, seabed, drop));
    }
  }
  // The court apron is paving, not gravel.
  if (!profile.hub) {
    const ax = Math.max((apron.x[0] ?? -12.5) - dx, dx - (apron.x[1] ?? 12.5));
    const az = Math.max((apron.z[0] ?? 14) - dz, dz - (apron.z[1] ?? 26));
    const apronIn = 1 - smooth(Math.max(ax, az) / 0.8);
    road = Math.max(road, apronIn);
  }
  if (profile.hub) road = Math.max(road, 1 - smooth((r - profile.flatRadius) / 0.8));
  return { height, road, flat, shelf: shelf * landMask, land: landMask };
}

export interface TerrainField {
  profiles: ParcelProfile[];
  /** World XZ bounds of the land plus the cliff toe. */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Farthest any parcel reaches from its centre, including the drop. */
  reach: number;
}
export function buildField(occupiedSlotIds: Iterable<string>): TerrainField {
  const ids = [...new Set([hubSlot.id, ...occupiedSlotIds])];
  const profiles = ids.map((id) => parcelProfile(id, ids));
  const reach = terrain.coast.max + 2.5 + cliffDrop + 4;
  const bounds = {
    minX: Math.min(...profiles.map((p) => p.centre[0])) - reach,
    maxX: Math.max(...profiles.map((p) => p.centre[0])) + reach,
    minZ: Math.min(...profiles.map((p) => p.centre[1])) - reach,
    maxZ: Math.max(...profiles.map((p) => p.centre[1])) + reach,
  };
  return { profiles, bounds, reach };
}

const seabedSample: SurfaceSample = { height: seabed, road: 0, flat: 0, shelf: 0, land: 0 };
/** The colony surface at a world point: the highest parcel profile wins. */
export function surfaceAt(field: TerrainField, x: number, z: number): SurfaceSample {
  let best: SurfaceSample = seabedSample;
  let bestHeight = Number.NEGATIVE_INFINITY;
  for (const profile of field.profiles) {
    const dx = x - profile.centre[0],
      dz = z - profile.centre[1];
    if (Math.abs(dx) > field.reach || Math.abs(dz) > field.reach) continue;
    const sample = sampleParcel(profile, dx, dz);
    if (sample.height > bestHeight) {
      bestHeight = sample.height;
      best = sample;
    }
  }
  if (best === seabedSample) {
    // Open water: a gently undulating seabed so the shallows are not a plane.
    return { ...seabedSample, height: seabed + 0.3 * valueNoise(x * 0.07, z * 0.07, 5) };
  }
  return best;
}
export function heightAt(field: TerrainField, x: number, z: number) {
  return surfaceAt(field, x, z).height;
}
/** Slope in degrees from central differences. */
export function slopeAt(field: TerrainField, x: number, z: number, step = 0.6) {
  const dhx = heightAt(field, x + step, z) - heightAt(field, x - step, z);
  const dhz = heightAt(field, x, z + step) - heightAt(field, x, z - step);
  return (Math.atan(Math.hypot(dhx, dhz) / (2 * step)) * 180) / Math.PI;
}

/** Shoreline check used by tests and the scatter rules: land at y > 0.5 counts. */
export function isLand(field: TerrainField, x: number, z: number) {
  return heightAt(field, x, z) > seaLevel + 0.5;
}
/** Minimum open water along the straight line between two neighbouring parcel centres. */
export function channelWidthBetween(field: TerrainField, a: Point2, b: Point2, step = 0.5) {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  let water = 0,
    best = Number.POSITIVE_INFINITY,
    seen = false;
  for (let s = 0; s <= length; s += step) {
    const t = s / length;
    const x = lerp(a[0], b[0], t),
      z = lerp(a[1], b[1], t);
    if (heightAt(field, x, z) < seaLevel) {
      water += step;
      seen = true;
    } else if (seen && water > 0) {
      best = Math.min(best, water);
      water = 0;
    }
  }
  return best === Number.POSITIVE_INFINITY ? water : best;
}
