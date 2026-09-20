import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { BufferAttribute, BufferGeometry, Color, Mesh, MeshStandardMaterial, type Object3D } from "three";
import { colonyContract, type Point2, type Point3 } from "./colony";
import { roomTones } from "./interior";
import type { SceneLight } from "./ProofBase";
import { type RoomId, roomIds } from "./rooms";

/** Contract key for a room's walkable polygon; dispatch's is the marshalling floor. */
const polygonKey = (room: RoomId) => (room === "dispatch" ? "room_dispatch_marshalling" : `room_${room}`);
const floor = colonyContract.levels.hqFloor;
/** How far the strip sits in from the room's edge, and how wide it runs. */
const inset = 0.16;
const width = 0.13;
/** Clear of the floor inlay it is laid on, which tops out at +0.025. */
const lift = 0.032;

function centroid(polygon: Point2[]): Point2 {
  let x = 0;
  let z = 0;
  for (const point of polygon) {
    x += point[0];
    z += point[1];
  }
  return [x / polygon.length, z / polygon.length];
}

/**
 * The lit skirting that runs round the foot of every room wall.
 *
 * The rooms are told apart by the colour of their floor, which works in daylight and goes to almost
 * nothing at night, when the floor is barely lit and its own glow has to stay low enough not to read
 * as a light box. A strip does what a tinted floor cannot: it is the same width and the same
 * brightness whatever the hour, so a room keeps its identity after dark and the plan of the building
 * stays legible from above.
 *
 * Built here rather than in the shell because the shell's producer receipt is hash-bound -- the
 * geometry is a direct read of the same room polygons the floor inlays were slabbed from, so the
 * strip lands exactly on the floor plan and not on an approximation of it.
 */
function buildRoom(room: RoomId, material: MeshStandardMaterial) {
  const movement = colonyContract.movement as unknown as Record<string, { polygon?: number[][] }>;
  const polygon = movement[polygonKey(room)]?.polygon as Point2[] | undefined;
  if (!polygon || polygon.length < 3) return null;
  const middle = centroid(polygon);
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i] as Point2;
    const b = polygon[(i + 1) % polygon.length] as Point2;
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const length = Math.hypot(dx, dz);
    if (length < 1e-6) continue;
    const ux = dx / length;
    const uz = dz / length;
    // Whichever perpendicular points at the middle of the room is the one the strip steps along.
    let nx = -uz;
    let nz = ux;
    if (nx * (middle[0] - a[0]) + nz * (middle[1] - a[1]) < 0) {
      nx = -nx;
      nz = -nz;
    }
    // Overshoot each end by the strip's own width so the corners close without mitring them.
    const ax = a[0] - ux * width;
    const az = a[1] - uz * width;
    const bx = b[0] + ux * width;
    const bz = b[1] + uz * width;
    const base = positions.length / 3;
    for (const [px, pz] of [
      [ax, az],
      [bx, bz],
    ] as const)
      positions.push(
        px + nx * inset,
        floor + lift,
        pz + nz * inset,
        px + nx * (inset + width),
        floor + lift,
        pz + nz * (inset + width),
      );
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  if (indices.length === 0) return null;
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new Mesh(geometry, material);
  mesh.name = `MF_RoomLight_${room}`;
  return mesh;
}

export function ColonyRoomLights({ light, origin }: { light: React.RefObject<SceneLight>; origin: Point3 }) {
  const built = useMemo(() => {
    const meshes: Object3D[] = [];
    const materials: MeshStandardMaterial[] = [];
    for (const room of roomIds) {
      const tone = new Color(roomTones[room]);
      const material = new MeshStandardMaterial({
        name: `practical_room_${room}`,
        // Lifted well above the floor's own tone: this is the lamp, not the surface under it.
        color: tone.clone().multiplyScalar(1.6),
        // Pure tone, no lift toward white. Emissive saturates channel by channel, so a strip driven
        // hard off a colour that already carries white comes back as a white hairline and the room
        // it is meant to identify loses the one thing that identified it.
        emissive: tone.clone(),
        roughness: 0.3,
        metalness: 0,
        toneMapped: false,
      });
      const mesh = buildRoom(room, material);
      if (!mesh) {
        material.dispose();
        continue;
      }
      materials.push(material);
      meshes.push(mesh);
    }
    return { meshes, materials };
  }, []);
  useEffect(
    () => () => {
      for (const mesh of built.meshes)
        mesh.traverse((node) => {
          if (node instanceof Mesh) node.geometry.dispose();
        });
      for (const material of built.materials) material.dispose();
    },
    [built],
  );
  useFrame(() => {
    const dark = light.current.lamps;
    for (const material of built.materials) material.emissiveIntensity = 0.45 + dark * 1.15;
  });
  return (
    <group position={origin}>
      {built.meshes.map((mesh) => (
        <primitive key={mesh.uuid} object={mesh} />
      ))}
    </group>
  );
}
