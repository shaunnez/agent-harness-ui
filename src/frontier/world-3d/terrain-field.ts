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
const ringRoad = colonyContract.colony.ringRoad;
const ringHalfWidth = ringRoad.width / 2;
const cliffDrop = terrain.relief.cliff.dropOver;
/** Nothing on land rises above this (the label anchor is 19.5). */
export const landCap = 14.6;

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
export interface WaterPath {
  x: number;
  z: number;
  /** Channel bed and water surface heights at this sample. */
  bed: number;
  water: number;
  /** Cumulative distance along the path from the spring pool (metres). */
  s: number;
}
export interface WaterPool {
  x: number;
  z: number;
  radius: number;
  bed: number;
  water: number;
}
/**
 * A seeded stream on a parcel: a spring pool on the rear shoulder, a channel that drops through a
 * second pool to the cliff lip, and a fall over the face into the sea. Everything is parcel-local.
 */
export interface WaterFeature {
  path: WaterPath[];
  pools: WaterPool[];
  /** Where the channel leaves the lip, the world angle of the fall, and the sea-level splash point. */
  fall: { x: number; z: number; angleDeg: number; top: number; base: Point2 };
  /** Channel half-width in metres (water is a little narrower than the cut). */
  halfWidth: number;
  /** Parcel-local box, with carving margin, so the field can skip the path test elsewhere. */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
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
  /** Stream, pools and waterfall, on about half the project parcels. */
  water: WaterFeature | null;
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
  // A stream on the right flank replaces the wave-cut shelf there (the shelf would sink its lip).
  const streamBand =
    !hub && random() < waterRules.chance ? Math.floor(random() * waterRules.bands.length) : -1;
  const shelfRules = terrain.relief.sideShelves.worldAngleDeg;
  const shelf: [number, number] | null =
    !hub && streamBand !== 1 && random() < 0.7
      ? [
          between(shelfRules[0] ?? 0, 15),
          between(Math.max(30, (shelfRules[1] ?? 60) - 15), shelfRules[1] ?? 60),
        ]
      : null;
  const profile: ParcelProfile = {
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
    water: null,
  };
  // The stream is drawn after the land it cuts through exists; it depends on the slot only.
  if (streamBand >= 0) profile.water = buildWaterFeature(profile, streamBand, random);
  return profile;
}

const waterRules = {
  chance: 0.6,
  /**
   * World-angle bands on the flanks the world and exterior cameras see (they look from +x, +z), clear
   * of every edge line by 20 deg so the fall and its splash never touch a pad or bridge: left flank
   * between the front edge (113) and the rear edge (173), right flank between the front-right edge (-7)
   * and the front edge (53); a parcel with a right-flank stream has no wave-cut shelf.
   */
  bands: [
    [133, 153],
    [13, 33],
  ] as [number, number][],
  springRadial: 25.2,
  poolRadius: [3.0, 2.2] as [number, number],
  poolDepth: [1.1, 0.9] as [number, number],
  channelDepth: 0.65,
  halfWidth: 1.55,
  waterAboveBed: 0.3,
};
/** Land height with no stream cut and no cliff: what the channel is carved out of. */
function coreLand(profile: ParcelProfile, dx: number, dz: number) {
  const flatD = flatDistance(profile, dx, dz);
  const shoulderT = smooth(flatD / plateauBlend);
  const shoulderRise = (profile.hub ? 0.3 : 0.9) * valueNoise(dx * 0.11, dz * 0.11, profile.salt) + 0.35;
  let land = lerp(profile.flatLevel, plateauLevel + shoulderRise, shoulderT);
  const rough = ridged(dx * 0.13, dz * 0.13, profile.salt + 41);
  const ledge = Math.floor(rough * 3) / 3;
  const relief = (lerp(rough, ledge, 0.6) - 0.5) * (profile.hub ? 1.2 : 2.4);
  land += relief * smooth((flatD - 1.5) / 3);
  const r = Math.hypot(dx, dz);
  const angleDeg = (Math.atan2(dz, dx) * 180) / Math.PI;
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
  return { land, shelf, shoulderT, flatD, r, angleDeg };
}
function buildWaterFeature(profile: ParcelProfile, bandIndex: number, random: () => number): WaterFeature {
  const between = (low: number, high: number) => low + random() * (high - low);
  const band = waterRules.bands[bandIndex] ?? [133, 153];
  const [b0, b1] = band;
  // The spring needs high ground to fall from, but taking the highest sample outright perched the
  // pool on top of an outcrop, where a flat disc of water reads as a puddle balanced on a boulder.
  // Take the upper-middle of the candidates instead: still a source above the run, on ground that
  // sits rather than crowns.
  const candidates: { angle: number; radial: number; ground: number }[] = [];
  for (let i = 0; i < 9; i++) {
    const angle = between(b0 + 3, b1 - 3);
    const radial = between(waterRules.springRadial - 0.6, waterRules.springRadial + 2.4);
    const point = polarPoint(radial, angle);
    candidates.push({ angle, radial, ground: coreLand(profile, point[0], point[1]).land });
  }
  candidates.sort((p, q) => q.ground - p.ground);
  const chosenSpring = candidates[Math.min(2, candidates.length - 1)] ?? candidates[0];
  const springAngle = chosenSpring?.angle ?? between(b0 + 3, b1 - 3);
  const springRadial = chosenSpring?.radial ?? waterRules.springRadial;
  const toward = springAngle - b0 < b1 - springAngle ? 1 : -1;
  const fallAngle = Math.min(b1 - 3, Math.max(b0 + 3, springAngle + toward * between(12, 22)));
  const lipRadius = coastRadius(profile, fallAngle) - 0.6;
  const a = polarPoint(springRadial, springAngle);
  const c = polarPoint(lipRadius, fallAngle);
  const midAngle = lerp(springAngle, fallAngle, 0.5) + between(-4, 4);
  const b = polarPoint(lerp(springRadial, lipRadius, 0.45), midAngle);
  const samples = 18;
  const raw: { x: number; z: number; ground: number; s: number }[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const x = (1 - t) * (1 - t) * a[0] + 2 * (1 - t) * t * b[0] + t * t * c[0];
    const z = (1 - t) * (1 - t) * a[1] + 2 * (1 - t) * t * b[1] + t * t * c[1];
    const previous = raw[raw.length - 1];
    const s = previous ? previous.s + Math.hypot(x - previous.x, z - previous.z) : 0;
    raw.push({ x, z, ground: Math.min(landCap - 0.3, coreLand(profile, x, z).land), s });
  }
  // Beyond the lip the bed keeps falling so the face is notched under the fall.
  for (let k = 1; k <= 3; k++) {
    const p = polarPoint(lipRadius + k * 1.3, fallAngle);
    const previous = raw[raw.length - 1] as { x: number; z: number; ground: number; s: number };
    raw.push({ x: p[0], z: p[1], ground: previous.ground - 0.8, s: previous.s + 1.3 });
  }
  // The bed only ever descends, at least 6 cm a metre, so the water visibly runs; the spring pool
  // is cut deeper than the channel that leaves it.
  const path: WaterPath[] = [];
  const springGround = raw[0]?.ground ?? plateauLevel;
  let bed = springGround - waterRules.channelDepth;
  for (const [index, sample] of raw.entries()) {
    const previous = raw[index - 1];
    const step = previous ? (sample.s - previous.s) * 0.06 : 0;
    const wanted = sample.ground - (index <= samples ? waterRules.channelDepth : 1.4);
    bed = Math.min(bed - step, wanted);
    path.push({ x: sample.x, z: sample.z, bed, water: bed + waterRules.waterAboveBed, s: sample.s });
  }
  for (let i = 1; i < path.length; i++) {
    const previous = path[i - 1] as WaterPath;
    const current = path[i] as WaterPath;
    current.water = Math.min(previous.water, current.water);
  }
  const first = path[0] as WaterPath;
  const pools: WaterPool[] = [
    {
      x: first.x,
      z: first.z,
      radius: waterRules.poolRadius[0],
      bed: springGround - (waterRules.poolDepth[0] ?? 1.1),
      water: first.water,
    },
  ];
  const lip = path[samples] as WaterPath;
  // The second pool sits at the head of the fall rather than half way down the run, so the stream
  // visibly gathers before it goes over the lip. Set back by its own radius so the disc stays on the
  // land behind the edge instead of overhanging the face.
  const lipDistance = Math.hypot(lip.x, lip.z);
  const setBack = waterRules.poolRadius[1] + 0.6;
  const lipPool =
    lipDistance > 0
      ? {
          x: (lip.x / lipDistance) * (lipDistance - setBack),
          z: (lip.z / lipDistance) * (lipDistance - setBack),
        }
      : { x: lip.x, z: lip.z };
  // Only where the run is long enough for the two cuts not to merge.
  if (
    Math.hypot(lipPool.x - first.x, lipPool.z - first.z) >
    waterRules.poolRadius[0] + waterRules.poolRadius[1] + 1.8
  )
    pools.push({
      x: lipPool.x,
      z: lipPool.z,
      radius: waterRules.poolRadius[1],
      bed: lip.bed - ((waterRules.poolDepth[1] ?? 0.9) - waterRules.channelDepth),
      water: lip.water,
    });
  const margin = waterRules.halfWidth + 2.2;
  const xs = [...path.map((p) => p.x), ...pools.map((p) => p.x)];
  const zs = [...path.map((p) => p.z), ...pools.map((p) => p.z)];
  const poolReach = Math.max(...pools.map((p) => p.radius));
  return {
    path,
    pools,
    fall: {
      x: lip.x,
      z: lip.z,
      angleDeg: fallAngle,
      top: lip.water,
      base: polarPoint(coastRadius(profile, fallAngle) + cliffDrop * 0.8, fallAngle),
    },
    halfWidth: waterRules.halfWidth,
    bounds: {
      minX: Math.min(...xs) - margin - poolReach,
      maxX: Math.max(...xs) + margin + poolReach,
      minZ: Math.min(...zs) - margin - poolReach,
      maxZ: Math.max(...zs) + margin + poolReach,
    },
  };
}
const polarPoint = (radius: number, angleDeg: number): Point2 => [
  radius * Math.cos(toRadians(angleDeg)),
  radius * Math.sin(toRadians(angleDeg)),
];
/** Distance to the channel centre line and the bed height there, or null outside the feature box. */
function channelAt(feature: WaterFeature, dx: number, dz: number) {
  const { bounds } = feature;
  if (dx < bounds.minX || dx > bounds.maxX || dz < bounds.minZ || dz > bounds.maxZ) return null;
  let best = Number.POSITIVE_INFINITY;
  let bed = 0;
  let water = 0;
  for (let i = 0; i < feature.path.length - 1; i++) {
    const p = feature.path[i] as WaterPath;
    const q = feature.path[i + 1] as WaterPath;
    const ex = q.x - p.x,
      ez = q.z - p.z;
    const length2 = ex * ex + ez * ez || 1;
    const t = clamp01(((dx - p.x) * ex + (dz - p.z) * ez) / length2);
    const px = p.x + ex * t - dx,
      pz = p.z + ez * t - dz;
    const d2 = px * px + pz * pz;
    if (d2 < best) {
      best = d2;
      bed = lerp(p.bed, q.bed, t);
      water = lerp(p.water, q.water, t);
    }
  }
  return { distance: Math.sqrt(best), bed, water };
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
  /** 1 in and beside a stream channel or pool: dark, wet rock. */
  wet: number;
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

/**
 * Centreline radius of the ring road at this angle. Exported so the painted band in the height field
 * and the kerb geometry laid on top are the same curve: two copies of this would drift apart.
 * valueNoise is already [-1, 1], so the wobble is symmetric and never exceeds ringRoad.wobble.
 */
export function ringRoadRadius(profile: ParcelProfile, angleDeg: number) {
  const a = toRadians(angleDeg);
  return ringRoad.radius + valueNoise(Math.cos(a) * 3, Math.sin(a) * 3, profile.salt + 57) * ringRoad.wobble;
}

/** One parcel's contribution at a parcel-local point. */
function sampleParcel(profile: ParcelProfile, dx: number, dz: number): SurfaceSample {
  // Land core: flat ground, then a gently rising shoulder with terraced relief, outcrops behind,
  // shelves in front-left (see coreLand).
  const core = coreLand(profile, dx, dz);
  const { land, shelf, shoulderT, r, angleDeg } = core;
  const coast = coastRadius(profile, angleDeg);
  // Cliff: a lip, then a steep jagged drop to the seabed, then flat seabed.
  const jag = (ridged(dx * 0.31, dz * 0.31, profile.salt + 23) - 0.5) * 2.4;
  const edge = coast + jag;
  const over = r - edge;
  let height: number;
  let landMask: number;
  if (over <= 0) {
    // A slight lip rise just before the drop reads as an eroded rim.
    const lip = smooth((over + 3) / 3) * 0.45 * (1 - shelf);
    height = Math.min(land + lip, landCap);
    landMask = 1;
  } else {
    const t = clamp01(over / cliffDrop);
    // Near-vertical upper face, easing into the toe: 1 - (1 - t)^3 keeps the top steep.
    const fall = 1 - (1 - t) * (1 - t) * (1 - t);
    height = lerp(land, seabed + 0.4 * valueNoise(dx * 0.5, dz * 0.5, profile.salt + 31), fall);
    landMask = 1 - t;
  }
  // Stream: the channel and pools are cut out of whatever is there (shoulder, outcrop or lip); the
  // ground within a metre or so of the water is wet rock.
  let wet = 0;
  if (profile.water) {
    const channel = channelAt(profile.water, dx, dz);
    if (channel) {
      const wall = smooth((channel.distance - profile.water.halfWidth) / 1.4);
      height = Math.min(height, channel.bed + (height - channel.bed) * wall);
      wet = Math.max(wet, 1 - smooth((channel.distance - profile.water.halfWidth - 0.4) / 1.4));
      for (const pool of profile.water.pools) {
        const distance = Math.hypot(dx - pool.x, dz - pool.z);
        const poolWall = smooth((distance - pool.radius) / 1.6);
        height = Math.min(height, pool.bed + (height - pool.bed) * poolWall);
        wet = Math.max(wet, 1 - smooth((distance - pool.radius - 0.4) / 1.6));
      }
    }
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
  // A ring road links every built spur around the plateau, so a parcel reads as one connected place
  // rather than separate stubs pointing at bridges. It sits outside the HQ corners (18 m) and inside
  // the narrowest coast, and holds a constant radius -- which on this shoulder is close to a contour,
  // so it is paving rather than a cut. A seeded wobble keeps it off a drawn-compass circle.
  // The apron already paves the whole court front at its own level, so the loop runs into it rather
  // than across it: levelling the ring through the apron would lift its far corners off plateau level.
  const inApron =
    dx >= (apron.x[0] ?? -12.5) - 1 &&
    dx <= (apron.x[1] ?? 12.5) + 1 &&
    dz >= (apron.z[0] ?? 14) - 1 &&
    dz <= (apron.z[1] ?? 27) + 1;
  if (!profile.hub && !inApron && profile.built.length > 0) {
    const a = toRadians(angleDeg);
    // valueNoise is already [-1, 1], so the wobble is symmetric and never exceeds ringRoad.wobble --
    // which is what keeps the inner edge off the flat plateau the HQ stands on.
    const ringR = ringRoadRadius(profile, angleDeg);
    // A stream cuts the loop rather than being paved over: the road fords it. Where a spur already
    // holds the ground at plateau level the ring yields to it, so the junction is the spur's height
    // and the loop reads as joining the approach rather than crossing over it.
    const on =
      (1 - smooth((Math.abs(r - ringR) - ringHalfWidth) / ringRoad.edge)) *
      (1 - clamp01(wet)) *
      (1 - clamp01(road));
    if (on > 0) {
      // A road is level across its width. Carry the centreline height across the band so the surface
      // faces the sky like the court apron does, instead of tilting with the shoulder: the paving is
      // the same basalt either way, and it was the tilt alone that made the ring read darker.
      height = lerp(height, coreLand(profile, Math.cos(a) * ringR, Math.sin(a) * ringR).land, on);
      road = Math.max(road, on);
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
  return { height, road, flat, shelf: shelf * landMask, land: landMask, wet };
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

const seabedSample: SurfaceSample = { height: seabed, road: 0, flat: 0, shelf: 0, land: 0, wet: 0 };
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
