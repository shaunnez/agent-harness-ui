import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { type AnimationClip, AnimationMixer, type Group, type Object3D } from "three";
import { actorSeed, patrolPose, workActions } from "../world/worker-behavior";
import { type Point3, proofWorkerScale, type ProofWorker as Worker } from "./model";

export function ProofWorker({
  worker,
  source,
  selected,
  route,
  onSelect,
  positions,
  clips,
}: {
  worker: Worker;
  source: Object3D;
  selected: boolean;
  route: Point3[];
  onSelect(): void;
  positions: Map<string, Object3D>;
  clips: AnimationClip[];
}) {
  const body = useMemo(() => source.clone(true), [source]);
  const root = useRef<Group>(null);
  const time = useRef(0);
  const action = workActions[worker.action];
  const mixer = useMemo(() => new AnimationMixer(body), [body]);
  useEffect(() => {
    const clip = clips.find((entry) => entry.name === "worker_tool_work");
    if (clip && worker.behavior === "work") mixer.clipAction(clip).play();
    else mixer.stopAllAction();
    return () => {
      mixer.stopAllAction();
    };
  }, [clips, mixer, worker.behavior]);
  useEffect(
    () => () => {
      positions.delete(worker.task.id);
      mixer.uncacheRoot(body);
    },
    [body, mixer, positions, worker.task.id],
  );
  const patrol = useMemo(() => route.map((p) => ({ x: p[0], y: p[2] })), [route]);
  useFrame((_, delta) => {
    if (!root.current) return;
    positions.set(worker.task.id, root.current);
    if (worker.moving && !document.hidden) {
      time.current += Math.min(delta, 0.1);
      if (worker.behavior === "work") mixer.update(Math.min(delta, 0.1));
    }
    const phase = time.current;
    if (worker.behavior === "roam") {
      const pose = patrolPose(patrol, phase * 1000, actorSeed(worker.task.id), 1.1);
      root.current.position.set(pose.x, worker.position[1], pose.y);
      body.rotation.y = pose.facing > 0 ? 0.9 : -0.9;
    } else root.current.position.set(...worker.position);
    body.rotation.y = worker.behavior === "work" ? Math.sin(phase * 0.7) * 0.04 : body.rotation.y;
  });
  const status =
    worker.tone === "answer"
      ? "#ffbb56"
      : ["repair", "blocked", "failed"].includes(worker.tone)
        ? "#ee7463"
        : "#68bbff";
  return (
    <group ref={root} position={worker.position}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Three ray picking mirrors the accessible DOM worker button. */}
      <primitive
        object={body}
        scale={proofWorkerScale}
        onClick={(event: { stopPropagation(): void }) => {
          event.stopPropagation();
          onSelect();
        }}
      />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
        <ringGeometry args={[selected ? 1.55 : 1.32, selected ? 1.66 : 1.4, 48]} />
        <meshBasicMaterial color={selected ? "#79ccff" : status} toneMapped={false} />
      </mesh>
      {worker.behavior === "work" && worker.moving && (
        <pointLight color={action.color} intensity={2.5} distance={2.5} position={[0, 1.1, 1]} />
      )}
    </group>
  );
}
