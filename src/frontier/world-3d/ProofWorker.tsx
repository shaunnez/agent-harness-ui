import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { type AnimationClip, AnimationMixer, type Group, type Object3D } from "three";
import { actorSeed, patrolPose, workActions } from "../world/worker-behavior";
import {
  type Point3,
  type ProofView,
  type ProofWorker as Worker,
  workerScale,
  workerViewScale,
} from "./model";
import { cloneWorker, disposeWorker } from "./worker-batching";
import { applyGait, buildGait, gaitBob, gaitStrideCycle, restGait } from "./worker-gait";

/** Matches the patrol speed below, so the stride covers the ground the worker actually crosses. */
const roamSpeed = 1.1;

export function ProofWorker({
  worker,
  view,
  source,
  selected,
  route,
  onSelect,
  positions,
  clips,
}: {
  worker: Worker;
  view: ProofView;
  source: Object3D;
  selected: boolean;
  route: Point3[];
  onSelect(): void;
  positions: Map<string, Object3D>;
  clips: AnimationClip[];
}) {
  const body = useMemo(() => cloneWorker(source), [source]);
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
      positions.delete(worker.id);
      mixer.uncacheRoot(body);
      disposeWorker(body);
    },
    [body, mixer, positions, worker.id],
  );
  const patrol = useMemo(() => route.map((p) => ({ x: p[0], y: p[2] })), [route]);
  const gait = useMemo(() => buildGait(body), [body]);
  const walked = useRef(0);
  const stepping = useRef(0);
  useFrame((_, delta) => {
    if (!root.current) return;
    positions.set(worker.id, root.current);
    const step = worker.moving && !document.hidden ? Math.min(delta, 0.1) : 0;
    if (step) {
      time.current += step;
      if (worker.behavior === "work") mixer.update(step);
    }
    const phase = time.current;
    if (worker.behavior === "roam") {
      const pose = patrolPose(patrol, phase * 1000, actorSeed(worker.task.id), roamSpeed);
      root.current.position.set(pose.x, worker.position[1], pose.y);
      body.rotation.y = pose.facing > 0 ? 0.9 : -0.9;
      if (pose.walking) walked.current += step * roamSpeed;
      // Ease the cycle in and out so a worker settles rather than snapping at a patrol waypoint.
      if (step) stepping.current += ((pose.walking ? 1 : 0) - stepping.current) * Math.min(1, step * 8);
      if (gait) {
        const cycle = (walked.current / gaitStrideCycle) * Math.PI * 2;
        applyGait(gait, cycle, stepping.current);
        body.position.y = gaitBob(cycle, stepping.current);
      }
    } else {
      root.current.position.set(...worker.position);
      if (gait && stepping.current !== 0) {
        stepping.current = 0;
        restGait(gait);
        body.position.y = 0;
      }
    }
    body.rotation.y =
      worker.behavior === "work"
        ? worker.facing + Math.sin(phase * 0.7) * 0.04
        : worker.behavior === "park"
          ? worker.facing
          : body.rotation.y;
  });
  const status =
    worker.tone === "answer"
      ? "#ffbb56"
      : ["repair", "blocked", "failed"].includes(worker.tone)
        ? "#ee7463"
        : "#68bbff";
  // Ring, work light and picking scale with the body; the group origin stays at the true standing point.
  const factor = workerViewScale[view];
  return (
    <group ref={root} position={worker.position}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Three ray picking mirrors the accessible DOM worker button. */}
      <primitive
        object={body}
        scale={workerScale(view)}
        onClick={(event: { stopPropagation(): void }) => {
          event.stopPropagation();
          onSelect();
        }}
      />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]} scale={factor}>
        <ringGeometry args={[selected ? 1.55 : 1.32, selected ? 1.66 : 1.4, 48]} />
        <meshBasicMaterial color={selected ? "#79ccff" : status} toneMapped={false} />
      </mesh>
      {worker.behavior === "work" && worker.moving && (
        <pointLight
          color={action.color}
          intensity={2.5 * factor}
          distance={2.5 * factor}
          position={[0, 1.1 * factor, 1 * factor]}
        />
      )}
    </group>
  );
}
