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
import { clipForWorker, walkCycleSpeed } from "./worker-clips";

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
  /**
   * One clip at a time: the walk while roaming, and the pose the work action names while working.
   * Parking plays nothing, so the mixer leaves the authored rest pose alone.
   */
  const clipName = clipForWorker(worker.behavior, action.pose);
  const playing = useMemo(() => {
    const clip = clipName ? clips.find((entry) => entry.name === clipName) : undefined;
    return clip ? mixer.clipAction(clip) : null;
  }, [clipName, clips, mixer]);
  useEffect(() => {
    if (!playing) {
      mixer.stopAllAction();
      return;
    }
    playing.reset();
    // The walk is authored at one cycle per 0.8 s; hold it to the ground speed or the feet skate.
    playing.timeScale = clipName === "worker_walk" ? roamSpeed / walkCycleSpeed : 1;
    playing.play();
    return () => {
      playing.stop();
    };
  }, [playing, clipName, mixer]);
  useEffect(
    () => () => {
      positions.delete(worker.id);
      // No `mixer.uncacheRoot(body)` here. The mixer is built from this clone and dies with it, so
      // the cache has no one to outlive. Clearing it is what broke the rig under StrictMode: the
      // remount reuses the `useMemo` body and action, but their `_cacheIndex` now points into a
      // binding array the uncache emptied, and the next `play()` throws in `_lendBinding`.
      disposeWorker(body);
    },
    [body, positions, worker.id],
  );
  const patrol = useMemo(() => route.map((p) => ({ x: p[0], y: p[2] })), [route]);
  const stepping = useRef(0);
  useFrame((_, delta) => {
    if (!root.current) return;
    positions.set(worker.id, root.current);
    const step = worker.moving && !document.hidden ? Math.min(delta, 0.1) : 0;
    if (step) {
      time.current += step;
      if (playing) mixer.update(step);
    }
    const phase = time.current;
    if (worker.behavior === "roam") {
      const pose = patrolPose(patrol, phase * 1000, actorSeed(worker.task.id), roamSpeed);
      root.current.position.set(pose.x, worker.position[1], pose.y);
      body.rotation.y = pose.facing > 0 ? 0.9 : -0.9;
      // Ease the cycle in and out so a worker settles rather than snapping at a patrol waypoint.
      if (step) stepping.current += ((pose.walking ? 1 : 0) - stepping.current) * Math.min(1, step * 8);
      // Under full weight the mixer blends the clip back towards the authored rest pose.
      if (playing) playing.setEffectiveWeight(stepping.current);
    } else {
      root.current.position.set(...worker.position);
      stepping.current = 0;
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
