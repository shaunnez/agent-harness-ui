import * as THREE from "three";
import type { ObservatoryState } from "./model";

export type DisposableRegister = <T extends { dispose: () => void }>(value: T) => T;

const STATE_HEX: Record<ObservatoryState, number> = {
  complete: 0x69cf99,
  active: 0x5aa2ff,
  waiting: 0xd6a13a,
  blocked: 0xef6464,
  stale: 0x77766f,
};

export function stateColor(state: ObservatoryState) {
  return STATE_HEX[state];
}

export function createStateOrb(
  register: DisposableRegister,
  state: ObservatoryState,
  radius: number,
  selected: boolean,
) {
  const color = stateColor(state);
  const group = new THREE.Group();
  const core = new THREE.Mesh(
    register(new THREE.SphereGeometry(radius, 32, 24)),
    register(
      new THREE.MeshPhysicalMaterial({
        color,
        emissive: color,
        emissiveIntensity: state === "active" ? 2.2 : 1.15,
        metalness: 0.66,
        roughness: 0.18,
        clearcoat: 0.85,
        clearcoatRoughness: 0.16,
      }),
    ),
  );
  group.add(core);
  const halo = new THREE.Mesh(
    register(new THREE.TorusGeometry(radius * 1.75, selected ? 0.035 : 0.018, 12, 64)),
    register(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: selected ? 0.95 : 0.52 })),
  );
  halo.rotation.x = Math.PI / 2;
  group.add(halo);
  if (selected) group.scale.setScalar(1.2);
  return group;
}

export function createSatellite(register: DisposableRegister, state: ObservatoryState, selected: boolean) {
  const color = stateColor(state);
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    register(new THREE.IcosahedronGeometry(0.33, 2)),
    register(
      new THREE.MeshPhysicalMaterial({
        color: 0x17222a,
        emissive: color,
        emissiveIntensity: state === "active" ? 1.55 : 0.7,
        metalness: 0.9,
        roughness: 0.17,
        clearcoat: 0.8,
      }),
    ),
  );
  group.add(body);
  const wire = new THREE.Mesh(
    register(new THREE.IcosahedronGeometry(0.47, 1)),
    register(new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.72 })),
  );
  group.add(wire);
  [0.54, 0.68].forEach((radius, index) => {
    const ring = new THREE.Mesh(
      register(new THREE.TorusGeometry(radius, index ? 0.012 : 0.022, 10, 72)),
      register(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: index ? 0.32 : 0.78 })),
    );
    ring.rotation.x = Math.PI / 2 + index * 0.36;
    ring.rotation.y = index * 0.42;
    group.add(ring);
  });
  if (selected) group.scale.setScalar(1.16);
  return group;
}

export function createCandidate(register: DisposableRegister, state: ObservatoryState, selected: boolean) {
  const color = stateColor(state);
  const group = new THREE.Group();
  group.add(
    new THREE.Mesh(
      register(new THREE.IcosahedronGeometry(0.68, 2)),
      register(
        new THREE.MeshPhysicalMaterial({
          color: 0x233e5d,
          emissive: color,
          emissiveIntensity: 1.35,
          metalness: 0.88,
          roughness: 0.14,
          clearcoat: 0.95,
        }),
      ),
    ),
  );
  group.add(
    new THREE.Mesh(
      register(new THREE.IcosahedronGeometry(0.88, 1)),
      register(
        new THREE.MeshBasicMaterial({ color: 0x9fc9ff, wireframe: true, transparent: true, opacity: 0.72 }),
      ),
    ),
  );
  [1.04, 1.22].forEach((radius, index) => {
    const ring = new THREE.Mesh(
      register(new THREE.TorusGeometry(radius, index ? 0.018 : 0.035, 12, 96)),
      register(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: index ? 0.3 : 0.78 })),
    );
    ring.rotation.x = Math.PI / 2;
    ring.rotation.y = index * 0.48;
    group.add(ring);
  });
  if (selected) group.scale.setScalar(1.12);
  return group;
}

export function createGate(register: DisposableRegister, state: ObservatoryState, selected: boolean) {
  const color = stateColor(state);
  const group = new THREE.Group();
  [0.55, 0.69, 0.82].forEach((radius, index) => {
    const ring = new THREE.Mesh(
      register(new THREE.TorusGeometry(radius, index === 1 ? 0.035 : 0.016, 12, 80)),
      register(
        new THREE.MeshStandardMaterial({
          color: index === 1 ? color : 0x777268,
          emissive: color,
          emissiveIntensity: index === 1 ? 0.95 : 0.24,
          metalness: 0.9,
          roughness: 0.24,
          transparent: index !== 1,
          opacity: index === 1 ? 1 : 0.58,
        }),
      ),
    );
    ring.rotation.y = Math.PI / 2;
    group.add(ring);
  });
  const hub = new THREE.Mesh(
    register(new THREE.CylinderGeometry(0.1, 0.1, 0.18, 16)),
    register(new THREE.MeshStandardMaterial({ color: 0x625d54, metalness: 0.9, roughness: 0.25 })),
  );
  hub.rotation.z = Math.PI / 2;
  group.add(hub);
  if (selected) group.scale.setScalar(1.15);
  return group;
}

export function createTube(
  register: DisposableRegister,
  points: THREE.Vector3[],
  color: number,
  radius = 0.022,
  opacity = 0.78,
) {
  const curve = new THREE.CatmullRomCurve3(points, false, "centripetal", 0.35);
  const tube = new THREE.Mesh(
    register(new THREE.TubeGeometry(curve, 96, radius, 8, false)),
    register(new THREE.MeshBasicMaterial({ color, transparent: true, opacity })),
  );
  return { curve, tube };
}

export function seededRandom(seed: number) {
  let value = seed % 2147483647;
  if (value <= 0) value += 2147483646;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}
