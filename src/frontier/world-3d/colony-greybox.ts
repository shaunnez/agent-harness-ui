import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, RingGeometry } from "three";
import { colonyContract, colonyEdges } from "./colony.ts";
import type { BaseVariant } from "./appearance.ts";

const material = (name: string, color: string) => {
  const result = new MeshStandardMaterial({ color, roughness: 0.85 });
  result.name = name;
  return result;
};
const stone = material("greybox_stone", "#7d918a"),
  floor = material("greybox_floor", "#b1b6ae"),
  road = material("greybox_road", "#667783"),
  trim = material("identity_trim", "#dddddd");
function box(
  parent: Group,
  name: string,
  position: [number, number, number],
  size: [number, number, number],
  surface = stone,
  rotation = 0,
) {
  const mesh = new Mesh(new BoxGeometry(...size), surface);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.rotation.y = rotation;
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
function group(parent: Group, name: string) {
  const child = new Group();
  child.name = name;
  parent.add(child);
  return child;
}
export function greyboxParcel(hub = false) {
  const root = new Group();
  const terrain = group(root, "MF_Terrain");
  const core = new Mesh(new CylinderGeometry(34, 43, 7, 72), stone);
  core.position.y = 0.5;
  core.receiveShadow = true;
  terrain.add(core);
  const ring = new Mesh(new RingGeometry(27.5, 32.5, 72), road);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 4.015;
  root.add(ring);
  ring.name = "MF_Road_Ring";
  for (const edge of colonyEdges) {
    const a = (edge.worldAngleDeg * Math.PI) / 180;
    const pad = group(root, `MF_Pad_${edge.id}`);
    box(pad, "pad", [36.5 * Math.cos(a), 4.1, 36.5 * Math.sin(a)], [8, 0.3, 6], road, -a);
    const spur = group(root, `MF_Road_Spur_${edge.id}`);
    box(spur, "spur", [32.1 * Math.cos(a), 4.015, 32.1 * Math.sin(a)], [1, 0.03, 5], road, -a);
  }
  group(root, "MF_Planting");
  group(root, "MF_Practicals");
  if (hub) box(root, "empty_landing_pad", [0, 4.12, 0], [26, 0.25, 26], floor);
  return root;
}
export function greyboxCrown(variant: BaseVariant = "command") {
  const root = new Group();
  root.name = "MF_Roof";
  const roof = new Mesh(new CylinderGeometry(18, 18, 0.6, 6), trim);
  roof.rotation.y = Math.PI / 6;
  roof.position.y = 9.35;
  root.add(roof);
  const crown = new Mesh(
    new CylinderGeometry(
      variant === "relay" ? 3 : 6,
      6,
      variant === "relay" ? 8 : 3,
      variant === "foundry" ? 6 : 24,
    ),
    trim,
  );
  crown.position.y = variant === "relay" ? 13.5 : 11.2;
  root.add(crown);
  return root;
}
export function greyboxShell() {
  const root = new Group();
  const fixed = group(root, "MF_BaseFixed"),
    cut = group(root, "MF_ShellCutaway");
  const slab = new Mesh(new CylinderGeometry(18, 18, 0.3, 6), floor);
  slab.rotation.y = Math.PI / 6;
  slab.position.y = 4.15;
  fixed.add(slab);
  const interior = group(root, "MF_Interior");
  for (const [id, room] of Object.entries(colonyContract.hq.rooms)) {
    const area = group(interior, `MF_Interior_${id}`);
    const s = room.sockets[0];
    if (s) box(area, `console_${id}`, [s.xz[0] ?? 0, 4.65, (s.xz[1] ?? 0) + 0.9], [1.6, 0.7, 0.6], road);
  }
  for (const degrees of [30, 90, 150, 210, 270, 330]) {
    const a = (degrees * Math.PI) / 180;
    box(
      [30, 90].includes(degrees) ? cut : fixed,
      `outer_${degrees}`,
      [15.588 * Math.cos(a), 6.7, 15.588 * Math.sin(a)],
      [18, 4.8, 0.6],
      stone,
      Math.PI / 2 - a,
    );
  }
  for (const degrees of [0, 60, 120, 180, 300]) {
    const a = (degrees * Math.PI) / 180;
    box(fixed, `partition_${degrees}`, [12 * Math.cos(a), 4.9, 12 * Math.sin(a)], [12, 1.2, 0.3], stone, -a);
  }
  for (const x of [-2.15, 2.15]) box(fixed, "corridor", [x, 4.9, 10.1], [0.3, 1.2, 9.4]);
  const hub = new Mesh(new CylinderGeometry(1.5, 1.5, 0.9, 24), road);
  hub.position.y = 4.75;
  interior.add(hub);
  const court = group(root, "MF_Court");
  box(court, "paving", [0, 4.1, 21.55], [36, 0.3, 11.9], floor);
  box(fixed, "bay_floor", [0, 4.15, 18.6], [10.8, 0.3, 6], floor);
  box(cut, "bay_roof", [0, 8.15, 18.6], [10.8, 0.3, 6], stone);
  group(root, "MF_Props");
  group(root, "MF_Practicals");
  group(root, "MF_Sockets");
  return root;
}
export function greyboxBridge() {
  const root = new Group();
  root.name = "MF_Bridge";
  box(root, "deck", [13.5, 3.9, 0], [27, 0.7, 4], road);
  for (const z of [-1.9, 1.9]) box(root, "rail", [13.5, 5.2, z], [27, 0.15, 0.12], floor);
  return root;
}
export function greyboxBridgeEnd() {
  const root = new Group();
  root.name = "MF_Bridge_End";
  box(root, "abutment", [0, 3.5, 0], [8, 1.5, 6], road);
  return root;
}
/** Greyboxes own geometry; downloaded GLB geometry remains loader-owned and shared. */
export function disposeGreybox(root: Group) {
  root.traverse((object) => {
    if (object instanceof Mesh) object.geometry.dispose();
  });
}
