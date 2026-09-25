import { colonyContract, type Point3 } from "./colony.ts";
import type { StandingObstacle } from "./room-clearance.ts";

/**
 * Where the scanned hero props stand inside the HQ.
 *
 * Every one of these is a piece the floor plan already specified and the greybox stood in for, so
 * the placement is read off the plan rather than invented. Planning carries a "plan holo-table
 * 3.0x2.0 at radial 9 on the 150 deg midline", testing a "diagnostic bench at radial 9", review a
 * "circular review dais radius 1.6 at radial 9", dispatch a "crate stack pad", briefing a "Q&A
 * console on the front wall", and four rooms carry "wall consoles behind the wall row" -- which the
 * retained producer puts at radial 15 in fours, on a 3.4 m pitch, and this module repeats exactly.
 *
 * This is a plain module for the same reason `shuttle-placement.ts` is: the pure room and scatter
 * rules are imported directly by the node test runner, which cannot load a `.tsx` file.
 */
export interface PropPlacement {
  /** Unique per standing position: one node stands in twenty places, so the node is not the key. */
  id: string;
  /** Root name in `props-kit.glb`. */
  node: string;
  /** Parcel-local position; y is the HQ floor. */
  position: Point3;
  /** Compass bearing the prop faces, in the same convention as a room socket's `facingDeg`. */
  facingDeg: number;
  /** Authored plan size in metres, from the producer receipt: width across, then depth. */
  footprint: [number, number];
  /** Authored height in metres, so a caller can hang a light or a label off the top. */
  height: number;
}

const floor = colonyContract.hq.rooms.planning.sockets[0]?.y ?? 4.3;
/**
 * The radial the plan puts free-standing room equipment on. Robot standing sockets sit on the inner
 * row either side of it and face it, so a prop centred here is what the room is arranged around.
 */
const equipmentRadial = 9;
/** The radial the retained producer puts the wall row on, clear of the socket rows behind it. */
const wallRadial = 15;
const onRadial = (degrees: number, radius: number): Point3 => [
  radius * Math.cos((degrees * Math.PI) / 180),
  floor,
  radius * Math.sin((degrees * Math.PI) / 180),
];
const crateStack = colonyContract.hq.rooms.dispatch.cargoPads.find((pad) => pad.id === "cargo_crates");

/**
 * The wall row: four consoles on each sector midline that has one, at the producer's own 3.4 m
 * pitch, facing out of the wall into the room. Implementation spans two sectors and gets both.
 */
const wallRow = (): PropPlacement[] => {
  const out: PropPlacement[] = [];
  for (const bearing of [150, 210, 270, 330, 30])
    for (const along of [-5.1, -1.7, 1.7, 5.1]) {
      const radians = (bearing * Math.PI) / 180;
      const tangent = radians + Math.PI / 2;
      out.push({
        id: `MF_Prop_WallConsole_${bearing}_${along}`,
        node: "MF_Prop_WallConsole",
        position: [
          wallRadial * Math.cos(radians) + along * Math.cos(tangent),
          floor,
          wallRadial * Math.sin(radians) + along * Math.sin(tangent),
        ],
        // Out of the wall, into the room: the bearing the wall faces is the opposite of its radial.
        facingDeg: bearing + 180,
        footprint: [1.811, 0.701],
        height: 2.75,
      });
    }
  return out;
};

/** Footprints and heights are the producer receipt's (`props-metadata.json`), not guesses. */
export const propPlacements: PropPlacement[] = [
  {
    id: "MF_Prop_PlanningTable",
    node: "MF_Prop_PlanningTable",
    position: onRadial(150, equipmentRadial),
    // Inward, so the face a robot reads is the face turned towards the hub door it enters by.
    facingDeg: 330,
    footprint: [3.163, 3.17],
    height: 1.05,
  },
  {
    id: "MF_Prop_TestRig",
    node: "MF_Prop_TestRig",
    position: onRadial(30, equipmentRadial),
    facingDeg: 210,
    footprint: [3.554, 3.248],
    height: 1.7,
  },
  {
    // The dais the plan always described. The greybox cylinder it replaces was built at radial 10.7
    // while the contract, and `room-clearance.ts`'s 2.2 m reservation, both say radial 9; the scan
    // goes where the plan says, which closes a drift the greybox had carried since 1.0.1.
    id: "MF_Prop_ReviewStation",
    node: "MF_Prop_ReviewStation",
    position: onRadial(330, equipmentRadial),
    facingDeg: 150,
    footprint: [3.204, 3.204],
    height: 1.36,
  },
  {
    id: "MF_Prop_IntakeDesk",
    node: "MF_Prop_IntakeDesk",
    // Keep the court doorway at (-6, 15.588) clear for recorded arrivals and handoffs.
    position: [-4.8, floor, 10.8],
    facingDeg: 270,
    footprint: [2.648, 0.699],
    height: 2.4,
  },
  {
    id: "MF_Prop_CargoBattery",
    node: "MF_Prop_CargoBattery",
    position: [crateStack?.xz[0] ?? -4, floor, crateStack?.xz[1] ?? 17],
    // Square to the bay doors: a battery on a marked pad is stacked, not parked at an angle.
    facingDeg: 90,
    footprint: [1.573, 1.086],
    height: 1.06,
  },
  ...wallRow(),
  // Three two-metre cells fill the contract's radial 8–14 fabrication bench reservation.
  ...[9, 11, 13].map(
    (radius): PropPlacement => ({
      id: `MF_Prop_FabCell_${radius}`,
      node: "MF_Prop_FabCell",
      position: onRadial(240, radius),
      facingDeg: 330,
      footprint: [1.987, 1.239],
      height: 1.73,
    }),
  ),
  {
    id: "MF_Prop_ServiceCart",
    node: "MF_Prop_ServiceCart",
    position: [4, floor, 20.2],
    facingDeg: 90,
    footprint: [2.243, 1.388],
    height: 1.06,
  },
];

/**
 * Prop footprints as standing obstacles, so `allocateSockets` never stands a robot inside one.
 *
 * The box is axis-aligned around the prop's *rotated* plan size rather than around its largest
 * dimension. A square drawn on the longest side is fine for a holo-table and far too greedy for a
 * wall console, which is 1.83 m across and 0.72 m deep: squaring it off would reserve a metre of
 * floor behind the wall row that nothing stands on, and push robots out of sockets that are clear.
 */
export const propObstacles: StandingObstacle[] = propPlacements.map((prop) => {
  const yaw = ((90 - prop.facingDeg) * Math.PI) / 180;
  const [width, depth] = prop.footprint;
  const halfX = (Math.abs(Math.cos(yaw)) * width + Math.abs(Math.sin(yaw)) * depth) / 2;
  const halfZ = (Math.abs(Math.sin(yaw)) * width + Math.abs(Math.cos(yaw)) * depth) / 2;
  return {
    name: prop.id,
    min: [prop.position[0] - halfX, prop.position[1], prop.position[2] - halfZ],
    max: [prop.position[0] + halfX, prop.position[1] + prop.height, prop.position[2] + halfZ],
  };
});
