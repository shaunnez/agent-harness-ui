import { colonyContract, type Point3 } from "./colony.ts";
import type { StandingObstacle } from "./room-clearance.ts";

/**
 * Where the three scanned hero props stand inside the HQ.
 *
 * The floor plan already specified each of these pieces and reserved its floor: planning carries a
 * "plan holo-table 3.0x2.0 at radial 9 on the 150 deg midline", testing a "diagnostic bench at
 * radial 9", and dispatch a "crate stack pad". The scans are those pieces, so the placement is read
 * off the plan rather than invented -- room midline, contract radial, contract cargo pad.
 *
 * This is a plain module for the same reason `shuttle-placement.ts` is: the pure room and scatter
 * rules are imported directly by the node test runner, which cannot load a `.tsx` file.
 */
export interface PropPlacement {
  /** Root name in `props-kit.glb`. */
  node: string;
  /** Parcel-local position; y is the HQ floor. */
  position: Point3;
  /** Compass bearing the prop faces, in the same convention as a room socket's `facingDeg`. */
  facingDeg: number;
  /** Half-width of the footprint, from the producer receipt, used to keep robots out of it. */
  footprintRadius: number;
  /** Authored height in metres, so a caller can hang a light or a label off the top. */
  height: number;
}

const floor = colonyContract.hq.rooms.planning.sockets[0]?.y ?? 4.3;
/**
 * The radial the plan puts free-standing room equipment on. Robot standing sockets sit on the inner
 * row either side of it and face it, so a prop centred here is what the room is arranged around.
 */
const equipmentRadial = 9;
const onRadial = (degrees: number, radius: number): Point3 => [
  radius * Math.cos((degrees * Math.PI) / 180),
  floor,
  radius * Math.sin((degrees * Math.PI) / 180),
];
const crateStack = colonyContract.hq.rooms.dispatch.cargoPads.find((pad) => pad.id === "cargo_crates");

/** Footprints and heights are the producer receipt's (`props-metadata.json`), not guesses. */
export const propPlacements: PropPlacement[] = [
  {
    node: "MF_Prop_PlanningTable",
    position: onRadial(150, equipmentRadial),
    // Inward, so the face a robot reads is the face turned towards the hub door it enters by.
    facingDeg: 330,
    footprintRadius: 1.53,
    height: 1.05,
  },
  {
    node: "MF_Prop_TestRig",
    position: onRadial(30, equipmentRadial),
    facingDeg: 210,
    footprintRadius: 1.75,
    height: 1.7,
  },
  {
    node: "MF_Prop_CargoBattery",
    position: [crateStack?.xz[0] ?? -4, floor, crateStack?.xz[1] ?? 17],
    // Square to the bay doors: a battery on a marked pad is stacked, not parked at an angle.
    facingDeg: 90,
    footprintRadius: 0.78,
    height: 1.06,
  },
];

/**
 * Prop footprints as standing obstacles, so `allocateSockets` never stands a robot inside one. The
 * boxes are axis-aligned around the footprint radius rather than the rotated silhouette: a little
 * conservative, which is the right direction for a clearance test.
 */
export const propObstacles: StandingObstacle[] = propPlacements.map((prop) => ({
  name: prop.node,
  min: [prop.position[0] - prop.footprintRadius, prop.position[1], prop.position[2] - prop.footprintRadius],
  max: [
    prop.position[0] + prop.footprintRadius,
    prop.position[1] + prop.height,
    prop.position[2] + prop.footprintRadius,
  ],
}));
