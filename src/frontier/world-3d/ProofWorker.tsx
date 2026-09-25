import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  type AnimationClip,
  type AnimationAction,
  AnimationMixer,
  type BufferGeometry,
  type Group,
  Mesh,
  type MeshBasicMaterial,
  type Object3D,
} from "three";
import type { RuntimeEvent } from "../../domain";
import type { WorkerJourney } from "./scene-journeys";
import { journeyLength, journeyPose } from "./worker-journeys";
import { actorSeed, patrolPose, workActions } from "../scene/worker-behavior";
import {
  type Point3,
  type ProofView,
  type ProofWorker as Worker,
  workerHeight,
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
  journey,
  toolEvent,
}: {
  worker: Worker;
  journey?: WorkerJourney;
  toolEvent?: RuntimeEvent;
  view: ProofView;
  source: Object3D;
  selected: boolean;
  route: Point3[];
  onSelect(): void;
  positions: Map<string, Object3D>;
  clips: AnimationClip[];
}) {
  const body = useMemo(() => {
    const clone = cloneWorker(source);
    // The body itself is taken out of picking; the proxy box below is what a pointer hits.
    //
    // Since the rig landed, every part of a worker is a `SkinnedMesh`, and three's
    // `SkinnedMesh.raycast` tests against `this.boundingSphere` -- computed by CPU-skinning every
    // vertex the first time a ray reaches the mesh, at whatever pose the skeleton happened to hold,
    // and then cached for the life of the mesh. A robot that later reaches further than that first
    // pose stops being hit, and the ray falls through to the floor behind it, which selects the base
    // instead of the agent. It also skins every vertex on the CPU on the frame it is computed.
    //
    // A box is exact enough for a figure you click at this camera distance, costs nothing, and does
    // not care what the skeleton is doing.
    clone.traverse((node) => {
      if (node instanceof Mesh) node.raycast = () => {};
    });
    return clone;
  }, [source]);
  const root = useRef<Group>(null);
  const time = useRef(0);
  const action = workActions[worker.action];
  const mixer = useMemo(() => new AnimationMixer(body), [body]);
  /**
   * One clip at a time: the walk while roaming, and the pose the work action names while working.
   * Parking plays nothing, so the mixer leaves the authored rest pose alone.
   */
  const clipName = clipForWorker(worker.behavior, action.pose);
  const actions = useMemo(
    () => new Map(clips.map((clip) => [clip.name, mixer.clipAction(clip)])),
    [clips, mixer],
  );
  const activeAction = useRef<AnimationAction | null>(null);
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
  const arrivalPatrol = useRef<{
    startedAt: number;
    startPhase: number;
    view: ProofView;
    points: { x: number; y: number }[];
  } | null>(null);
  const stepping = useRef(0);
  const halo = useRef<Mesh<BufferGeometry, MeshBasicMaterial> | null>(null);
  useFrame((_, delta) => {
    if (!root.current) return;
    positions.set(worker.id, root.current);
    const pose =
      journey && worker.moving && !document.hidden
        ? journeyPose(journey.route, (Math.max(0, Date.now() - journey.startedAt) / 1000) * journey.speed)
        : null;
    const travelling = pose && !pose.done;
    if (journey && worker.behavior === "roam" && arrivalPatrol.current?.startedAt !== journey.startedAt) {
      const end = journey.route.at(-1) ?? worker.position;
      arrivalPatrol.current = {
        startedAt: journey.startedAt,
        startPhase:
          time.current +
          Math.max(0, journeyLength(journey.route) / journey.speed - (Date.now() - journey.startedAt) / 1000),
        view,
        points: [{ x: end[0], y: end[2] }, ...patrol],
      };
    }
    const category = toolEvent?.toolCall?.category;
    const toolFresh = toolEvent && Date.now() - Date.parse(toolEvent.at) < 3000;
    const toolClip =
      toolFresh && worker.behavior === "work"
        ? category === "file-read"
          ? "worker_scan"
          : category === "file-edit"
            ? "worker_tool_work"
            : category === "repository-command"
              ? "worker_type"
              : null
        : null;
    const desired = travelling ? "worker_walk" : (toolClip ?? clipName);
    const playing = desired ? (actions.get(desired) ?? null) : null;
    if (playing !== activeAction.current) {
      if (playing) {
        playing.reset().setEffectiveWeight(1).play();
        if (activeAction.current) playing.crossFadeFrom(activeAction.current, 0.18, true);
      } else mixer.stopAllAction();
      activeAction.current = playing;
    }
    if (playing)
      playing.timeScale =
        desired === "worker_walk"
          ? (travelling ? (journey?.speed ?? roamSpeed) : roamSpeed) / (walkCycleSpeed * workerScale(view))
          : 1;
    const step = worker.moving && !document.hidden ? Math.min(delta, 0.1) : 0;
    if (step) {
      time.current += step;
      if (playing) mixer.update(step);
    }
    const phase = time.current;
    if (travelling) {
      root.current.position.set(...pose.position);
      body.rotation.y = pose.facing;
      playing?.setEffectiveWeight(1);
    } else if (worker.behavior === "roam") {
      // Start an arrival's idle loop from its landing point, including after the notice expires.
      const arrival = arrivalPatrol.current?.view === view ? arrivalPatrol.current : null;
      const pose = patrolPose(
        arrival?.points ?? patrol,
        arrival ? Math.max(0, phase - arrival.startPhase) * 1000 : phase * 1000,
        arrival ? 0 : actorSeed(worker.task.id),
        roamSpeed,
      );
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
    if (halo.current) {
      const breath = worker.moving && !document.hidden ? 0.5 + 0.5 * Math.sin(performance.now() / 620) : 0;
      halo.current.scale.setScalar(1 + breath * 0.045);
      halo.current.material.opacity = 0.35 + breath * 0.35;
    }
    if (!travelling)
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
      <primitive object={body} scale={workerScale(view)} />
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Three ray picking mirrors the accessible DOM worker button. */}
      <mesh
        position={[0, workerHeight(view) / 2, 0]}
        onClick={(event: { stopPropagation(): void }) => {
          event.stopPropagation();
          onSelect();
        }}
      >
        {/* The authored worker is 0.93 m across at 1.80 m tall, so the box follows at 0.52 of height. */}
        <boxGeometry args={[workerHeight(view) * 0.52, workerHeight(view), workerHeight(view) * 0.52]} />
        {/* Never drawn, never occludes, still raycast: `visible={false}` would drop it from picking. */}
        <meshBasicMaterial colorWrite={false} depthWrite={false} />
      </mesh>
      {/*
        The ring sits higher than the 4 cm it used to, because a robot's standing socket is the bare
        HQ floor and the floor it visibly stands on is not: the room inlay is 2.5 cm proud of it, the
        reveal strips 2.6 cm and the room's skirting light 3.2 cm. That left the ring clearing the
        dressing by millimetres, and it broke up wherever it crossed a strip. Robots on the court
        never showed it, because out there the paving is the level they stand on.

        The depth bias is the belt to that brace: a selection ring is a decal on whatever it is drawn
        over, so it should never lose a depth comparison to it. Depth testing stays on, so a wall in
        front still hides the ring behind it.

        A selected robot gets a wash, a heavy ring and a wide outer halo that breathes. The breathing
        is a selection affordance and nothing else -- it says "this is the one you picked", never
        that work is happening, and an unselected robot's ring does not move at all.
      */}
      <group position={[0, 0.09, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={factor} renderOrder={1}>
        {selected && (
          <mesh>
            <circleGeometry args={[1.62, 48]} />
            <meshBasicMaterial
              color="#79ccff"
              toneMapped={false}
              transparent
              opacity={0.18}
              depthWrite={false}
              polygonOffset
              polygonOffsetFactor={-4}
              polygonOffsetUnits={-4}
            />
          </mesh>
        )}
        <mesh>
          <ringGeometry args={selected ? [1.5, 1.78, 64] : [1.24, 1.46, 48]} />
          <meshBasicMaterial
            color={selected ? "#9bdcff" : status}
            toneMapped={false}
            depthWrite={false}
            polygonOffset
            polygonOffsetFactor={-4}
            polygonOffsetUnits={-4}
          />
        </mesh>
        {selected && (
          <mesh ref={halo}>
            <ringGeometry args={[1.92, 2.02, 64]} />
            <meshBasicMaterial
              color="#79ccff"
              toneMapped={false}
              transparent
              opacity={0.6}
              depthWrite={false}
              polygonOffset
              polygonOffsetFactor={-4}
              polygonOffsetUnits={-4}
            />
          </mesh>
        )}
      </group>
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
