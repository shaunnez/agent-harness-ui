import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Mesh, MeshBasicMaterial } from "three";
import type { WorldFeedback } from "../runtime/world-feedback";
import type { Point3 } from "./model";

export function WorldEventSignal({
  effect,
  position,
  motion,
  size = 2.4,
}: {
  effect: WorldFeedback;
  position: Point3;
  motion: boolean;
  size?: number;
}) {
  const ring = useRef<Mesh>(null);
  const material = useRef<MeshBasicMaterial>(null);
  useFrame(() => {
    const age = Math.max(0, Date.now() - effect.receivedAt);
    const phase = motion && !document.hidden ? (age % 1800) / 1800 : 0;
    if (ring.current) ring.current.scale.setScalar(1 + phase * 0.35);
    if (material.current) material.current.opacity = (1 - phase * 0.65) * 0.65;
  });
  const color =
    effect.kind === "attention" || effect.kind === "repair-started"
      ? "#ffc67c"
      : effect.kind === "task-completed"
        ? "#8ce3b7"
        : "#90d8ff";
  return (
    <group position={position}>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.12, 0]} raycast={() => {}}>
        <ringGeometry args={[size, size + 0.24, 48]} />
        <meshBasicMaterial
          ref={material}
          color={color}
          transparent
          opacity={0.6}
          depthWrite={false}
          toneMapped={false}
          polygonOffset
          polygonOffsetFactor={-4}
        />
      </mesh>
    </group>
  );
}
