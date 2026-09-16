import type { RuntimeProject } from "../../domain.ts";
import contractJson from "../../../design/mission-frontier/assets/staging/colony-hq-v1/contract.json" with {
  type: "json",
};

/**
 * The frozen colony contract is the placement authority: slot table, edge lines, bridge geometry
 * and cameras all come from it, so the runtime cannot drift from what the terrain builder and the
 * asset producer are building against. Never edit the JSON here; changes go through the lead.
 */
export const colonyContract = contractJson;
export type Point3 = [number, number, number];
export type Point2 = [number, number];

export interface ColonySlot {
  id: string;
  ring: number;
  phi: number | null;
  world: Point2;
}
export interface ColonyEdge {
  id: string;
  phi: number;
  worldAngleDeg: number;
  abutmentFace: Point2;
  padCentre: Point2;
}

export const cellPitch = contractJson.colony.cellPitch;
const ux = contractJson.colony.groundBasis.u_screenRight[0] ?? 0.8;
const uz = contractJson.colony.groundBasis.u_screenRight[2] ?? -0.6;
const vx = contractJson.colony.groundBasis.v_screenUp[0] ?? -0.6;
const vz = contractJson.colony.groundBasis.v_screenUp[2] ?? -0.8;
/** Screen-right and screen-up on the ground, in world XZ. */
export const groundBasis = { u: [ux, uz] as Point2, v: [vx, vz] as Point2 };

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
export function colonyToWorld(radius: number, phiDeg: number): Point2 {
  const c = Math.cos(toRadians(phiDeg)),
    s = Math.sin(toRadians(phiDeg));
  return [radius * (c * ux + s * vx), radius * (c * uz + s * vz)];
}

export const colonySlots: ColonySlot[] = contractJson.colony.slots.map((slot) => ({
  id: slot.slot,
  ring: slot.ring,
  phi: slot.phi,
  world: [slot.world[0] ?? 0, slot.world[1] ?? 0],
}));
export const hubSlot = colonySlots[0] as ColonySlot;
/** P1..P18 in fill order. */
export const projectSlots = colonySlots.filter((slot) => slot.id !== hubSlot.id);
const slotsById = new Map(colonySlots.map((slot) => [slot.id, slot]));
export function colonySlot(id: string) {
  return slotsById.get(id);
}
export function slotPosition(id: string): Point3 {
  const slot = slotsById.get(id) ?? hubSlot;
  return [slot.world[0], 0, slot.world[1]];
}

export const colonyEdges: ColonyEdge[] = contractJson.colony.edges.map((edge) => ({
  id: edge.edge,
  phi: edge.phi,
  worldAngleDeg: edge.worldAngleDeg,
  abutmentFace: [edge.abutmentFace[0] ?? 0, edge.abutmentFace[1] ?? 0],
  padCentre: [edge.padCentre[0] ?? 0, edge.padCentre[1] ?? 0],
}));
export const abutmentRadius = Math.hypot(...(colonyEdges[0]?.abutmentFace ?? [0, 0]));
export const bridgeSpan = contractJson.colony.bridge.span;
export const parcelCoastRadius = contractJson.colony.landRules.coastMaxRadius;
export const parcelPlateauRadius = contractJson.colony.landRules.plateauFlatRadius;
export const channelWidth = 16;

const latticeTolerance = 0.5;
export function latticeNeighbours(a: Point2, b: Point2) {
  return Math.abs(Math.hypot(b[0] - a[0], b[1] - a[1]) - cellPitch) < latticeTolerance;
}
/** The edge of `from` whose line points at `to`; only defined for lattice neighbours. */
export function edgeToward(from: Point2, to: Point2) {
  if (!latticeNeighbours(from, to)) return undefined;
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  return colonyEdges.find((edge) => {
    const delta = Math.abs(angle - toRadians(edge.worldAngleDeg));
    return Math.min(delta, Math.PI * 2 - delta) < toRadians(2);
  });
}
/** The cell centre one pitch along an edge; a slot only when the table has a cell there. */
export function neighbourSlot(slotId: string, edge: ColonyEdge) {
  const slot = slotsById.get(slotId);
  if (!slot) return undefined;
  const target: Point2 = [
    slot.world[0] + cellPitch * Math.cos(toRadians(edge.worldAngleDeg)),
    slot.world[1] + cellPitch * Math.sin(toRadians(edge.worldAngleDeg)),
  ];
  return colonySlots.find((other) => Math.hypot(other.world[0] - target[0], other.world[1] - target[1]) < 1);
}

/** Stable browser-local identity for a project, shared with the appearance record. */
export function projectKey(project: Pick<RuntimeProject, "id" | "repositoryPath">) {
  return `${project.id}:${project.repositoryPath}`;
}
export type SlotAssignments = Record<string, string>;
export const projectSlotIds = new Set(projectSlots.map((slot) => slot.id));

/**
 * The fill rule: a project takes the lowest free slot the first time it is seen, in createdAt then
 * id order. Saved assignments are never moved, even for projects no longer listed (archived bases
 * keep their land), so growth never relocates an existing base.
 */
export function assignSlots(
  projects: Pick<RuntimeProject, "id" | "repositoryPath" | "createdAt">[],
  saved: SlotAssignments = {},
): SlotAssignments {
  const result: SlotAssignments = {};
  const taken = new Set<string>();
  for (const [key, slot] of Object.entries(saved)) {
    if (!projectSlotIds.has(slot) || taken.has(slot)) continue;
    result[key] = slot;
    taken.add(slot);
  }
  const arrivals = [...projects].sort(
    (a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.id.localeCompare(b.id),
  );
  for (const project of arrivals) {
    const key = projectKey(project);
    if (result[key]) continue;
    const free = projectSlots.find((slot) => !taken.has(slot.id));
    if (!free) break;
    result[key] = free.id;
    taken.add(free.id);
  }
  return result;
}

export interface ColonyBridge {
  from: string;
  to: string;
  fromEdge: ColonyEdge;
  toEdge: ColonyEdge;
  /** World XZ of the abutment faces, so a 27 m span always fits between them. */
  start: Point2;
  end: Point2;
  worldAngleDeg: number;
}
const slotOrder = (id: string) => (id === hubSlot.id ? -1 : Number(id.slice(1)));
/**
 * The connection rule reduces to one statement: a bridge exists between every pair of occupied
 * lattice neighbours, and the hub is always occupied. This reproduces the growth table in
 * COLONY-PLAN.md for one to ten projects.
 */
export function colonyBridges(occupiedSlotIds: Iterable<string>): ColonyBridge[] {
  const occupied = [...new Set([hubSlot.id, ...occupiedSlotIds])]
    .map((id) => slotsById.get(id))
    .filter((slot): slot is ColonySlot => Boolean(slot))
    .sort((a, b) => slotOrder(a.id) - slotOrder(b.id));
  const bridges: ColonyBridge[] = [];
  for (let i = 0; i < occupied.length; i++)
    for (let j = i + 1; j < occupied.length; j++) {
      const a = occupied[i],
        b = occupied[j];
      if (!a || !b) continue;
      const fromEdge = edgeToward(a.world, b.world);
      const toEdge = edgeToward(b.world, a.world);
      if (!fromEdge || !toEdge) continue;
      bridges.push({
        from: a.id,
        to: b.id,
        fromEdge,
        toEdge,
        start: [a.world[0] + fromEdge.abutmentFace[0], a.world[1] + fromEdge.abutmentFace[1]],
        end: [b.world[0] + toEdge.abutmentFace[0], b.world[1] + toEdge.abutmentFace[1]],
        worldAngleDeg: fromEdge.worldAngleDeg,
      });
    }
  return bridges;
}
/** Edges of one parcel whose spur, pad and span are shown: the neighbour is occupied or is the hub. */
export function builtEdges(slotId: string, occupiedSlotIds: Iterable<string>) {
  const occupied = new Set([hubSlot.id, ...occupiedSlotIds]);
  return new Set(
    colonyEdges
      .filter((edge) => {
        const neighbour = neighbourSlot(slotId, edge);
        return neighbour ? occupied.has(neighbour.id) : false;
      })
      .map((edge) => edge.id),
  );
}
export const parcelEdgeGroups = (edge: ColonyEdge) => [`MF_Road_Spur_${edge.id}`, `MF_Pad_${edge.id}`];
/** Groups hidden on a parcel so an unfinished edge shows plain coast. */
export function hiddenEdgeGroups(slotId: string, occupiedSlotIds: Iterable<string>) {
  const built = builtEdges(slotId, occupiedSlotIds);
  return colonyEdges.filter((edge) => !built.has(edge.id)).flatMap(parcelEdgeGroups);
}

export interface ColonyCamera {
  position: Point3;
  target: Point3;
  verticalSpan: number;
}
const cameraFrom = (camera: { target: number[]; offset: number[]; verticalSpan: number }): ColonyCamera => ({
  target: [camera.target[0] ?? 0, camera.target[1] ?? 0, camera.target[2] ?? 0],
  position: [
    (camera.target[0] ?? 0) + (camera.offset[0] ?? 0),
    (camera.target[1] ?? 0) + (camera.offset[1] ?? 0),
    (camera.target[2] ?? 0) + (camera.offset[2] ?? 0),
  ],
  verticalSpan: camera.verticalSpan,
});
/** Base-local cameras; the runtime translates them to the parcel it is looking at. */
export const colonyCameras = {
  exterior: cameraFrom(contractJson.cameras.exterior),
  cutaway: cameraFrom(contractJson.cameras.cutaway),
};
export const baseLabelAnchor: Point3 = [
  contractJson.interactionSockets.base_label[0] ?? 0,
  contractJson.interactionSockets.base_label[1] ?? 0,
  contractJson.interactionSockets.base_label[2] ?? 0,
];
export function cameraElevationDeg(camera: ColonyCamera) {
  const dx = camera.position[0] - camera.target[0],
    dy = camera.position[1] - camera.target[1],
    dz = camera.position[2] - camera.target[2];
  return (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI;
}

export interface Viewport {
  width: number;
  height: number;
}
/**
 * HUD-safe content box in pixels. The contract gives the corner panels for 1280x800; they are
 * fixed-size panels, so the same pixel insets hold at other viewport sizes.
 */
export const hudSafeInsets = {
  left: contractJson.cameras.world.hudSafeInsets1280x800.bottomLeft[0] ?? 250,
  right: contractJson.cameras.world.hudSafeInsets1280x800.topRight[0] ?? 340,
  top: contractJson.cameras.world.hudSafeInsets1280x800.topLeft[1] ?? 150,
  bottom: contractJson.cameras.world.hudSafeInsets1280x800.bottomRight[1] ?? 260,
};
export const worldFitMargin = 10;
/** Screen axes of the exterior azimuth: right is the ground basis u, up is the camera's tilted up. */
function screenAxes() {
  const exterior = colonyCameras.exterior;
  const d = [
    exterior.position[0] - exterior.target[0],
    exterior.position[1] - exterior.target[1],
    exterior.position[2] - exterior.target[2],
  ];
  const length = Math.hypot(...d);
  const view = d.map((n) => n / length) as Point3;
  const up: Point3 = [-view[1] * view[0], 1 - view[1] * view[1], -view[1] * view[2]];
  const upLength = Math.hypot(...up);
  return {
    right: [ux, 0, uz] as Point3,
    up: up.map((n) => n / upLength) as Point3,
    view,
  };
}
const dot = (a: Point3, b: Point3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export interface WorldFit extends ColonyCamera {
  /** Pixels to shift the frustum so the colony centres in the HUD-safe box (setViewOffset x, y). */
  viewOffset: { x: number; y: number };
}
/**
 * The world camera fits the union of occupied parcel discs (radius 46) plus the hub, with a 10 m
 * margin and the base label height, into the HUD-safe box. Azimuth and elevation are the exterior
 * camera's, so World, exterior and cutaway describe one place.
 */
export function fitColonyView(
  occupiedSlotIds: Iterable<string>,
  viewport: Viewport = { width: 1280, height: 800 },
  labelHeight = 6,
): WorldFit {
  const centres = [...new Set([hubSlot.id, ...occupiedSlotIds])]
    .map((id) => slotsById.get(id))
    .filter((slot): slot is ColonySlot => Boolean(slot))
    .map((slot) => slot.world);
  const axes = screenAxes();
  const ground = contractJson.levels.plateauGround;
  let minX = Number.POSITIVE_INFINITY,
    maxX = Number.NEGATIVE_INFINITY,
    minY = Number.POSITIVE_INFINITY,
    maxY = Number.NEGATIVE_INFINITY;
  const include = (point: Point3) => {
    const x = dot(point, axes.right),
      y = dot(point, axes.up);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  };
  for (const centre of centres) {
    for (let i = 0; i < 24; i++) {
      const angle = (i / 24) * Math.PI * 2;
      include([
        centre[0] + parcelCoastRadius * Math.cos(angle),
        ground,
        centre[1] + parcelCoastRadius * Math.sin(angle),
      ]);
    }
    include([centre[0], baseLabelAnchor[1] + labelHeight, centre[1]]);
  }
  const width = maxX - minX + worldFitMargin * 2;
  const height = maxY - minY + worldFitMargin * 2;
  const safeWidth = Math.max(200, viewport.width - hudSafeInsets.left - hudSafeInsets.right);
  const safeHeight = Math.max(160, viewport.height - hudSafeInsets.top - hudSafeInsets.bottom);
  const pixelsPerMetre = Math.min(safeWidth / width, safeHeight / height);
  const verticalSpan = viewport.height / pixelsPerMetre;
  // The ground point that projects to the centre of the fitted bounds becomes the orbit target.
  const centreX = (minX + maxX) / 2,
    centreY = (minY + maxY) / 2;
  const groundV: Point3 = [vx, 0, vz];
  const along = (centreY - ground * axes.up[1]) / dot(groundV, axes.up);
  const target: Point3 = [centreX * ux + along * vx, ground, centreX * uz + along * vz];
  const exterior = colonyCameras.exterior;
  const offset: Point3 = [
    exterior.position[0] - exterior.target[0],
    exterior.position[1] - exterior.target[1],
    exterior.position[2] - exterior.target[2],
  ];
  const reach = Math.max(1, verticalSpan / exterior.verticalSpan);
  return {
    target,
    position: [target[0] + offset[0] * reach, target[1] + offset[1] * reach, target[2] + offset[2] * reach],
    verticalSpan,
    viewOffset: {
      x: (hudSafeInsets.right - hudSafeInsets.left) / 2,
      y: (hudSafeInsets.bottom - hudSafeInsets.top) / 2,
    },
  };
}
/** Top-down minimap: colony centroid, span 2 x (max occupied slot radius + 46 + 20). */
export function minimapFrame(occupiedSlotIds: Iterable<string>) {
  const centres = [...new Set([hubSlot.id, ...occupiedSlotIds])]
    .map((id) => slotsById.get(id))
    .filter((slot): slot is ColonySlot => Boolean(slot))
    .map((slot) => slot.world);
  const centre: Point2 = [
    centres.reduce((sum, c) => sum + c[0], 0) / Math.max(1, centres.length),
    centres.reduce((sum, c) => sum + c[1], 0) / Math.max(1, centres.length),
  ];
  const radius = Math.max(...centres.map((c) => Math.hypot(c[0], c[1])), 0);
  return { centre, halfSpan: radius + parcelCoastRadius + 20 };
}
