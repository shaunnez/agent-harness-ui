import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Color, type DirectionalLight, type HemisphereLight, Mesh, type Object3D } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  defaultEnvironment,
  LightingClock,
  lightingAt,
  type WorldLighting,
} from "../world/environment-model";
import { baseVariants } from "./appearance";
import { locatedProject, type ProjectBase, visibleBases } from "./layout";
import { type ProofControls, type ProofInput, type ProofManifest, proofWorkers } from "./model";
import { ProofBase, type SceneLight } from "./ProofBase";
import { ProofCamera } from "./ProofCamera";
import { ProofLabels } from "./ProofLabels";
import { ProofWorker } from "./ProofWorker";
import { SceneFinish } from "./SceneFinish";
import { createCoastalWater } from "./water";

interface Props {
  input: ProofInput;
  manifest: ProofManifest;
  bases: ProjectBase[];
  focusId: string | null;
  labels: React.RefObject<HTMLElement | null>;
  controlsRef: React.RefObject<ProofControls | null>;
  onFocus(id: string): void;
  onSelect(kind: "project" | "task", id: string): void;
  onLighting(lighting: WorldLighting): void;
  onMinimap(image: string): void;
  onReady(): void;
  onProblem(message: string): void;
}
export function ProofScene(props: Props) {
  const { input, manifest, bases, focusId, labels, onSelect, onLighting } = props;
  const sources = [
    manifest.scene,
    manifest.worker,
    ...baseVariants.map((id) => manifest.bases?.[id].src ?? manifest.scene),
  ];
  const [environment, workerGltf, ...baseGltfs] = useLoader(GLTFLoader, sources);
  const { scene } = useThree();
  const workerModel = useMemo(() => {
    if (!workerGltf) throw new Error("The worker export is missing.");
    const clone = workerGltf.scene.clone(true);
    clone.traverse((object) => {
      if (object instanceof Mesh) object.castShadow = object.receiveShadow = true;
    });
    return clone;
  }, [workerGltf]);
  const clock = useRef(new LightingClock());
  const light = useRef<SceneLight>({ lamps: 0, time: 0 });
  const reported = useRef(-1);
  const sun = useRef<DirectionalLight>(null);
  const sky = useRef<HemisphereLight>(null);
  const actors = useRef(new Map<string, Object3D>());
  const roots = useRef(new Map<string, Object3D>());
  const lightTint = useMemo(() => new Color("#ffe9d0"), []);
  const minimapCapture = useRef<(() => void) | null>(null);
  const mapPhase = useRef(-1);
  const layoutKey = bases.map((base) => base.position.join()).join("|");
  // biome-ignore lint/correctness/useExhaustiveDependencies: Water depends on placement, not appearance or runtime refresh.
  const water = useMemo(
    () =>
      createCoastalWater(
        bases.flatMap((base) =>
          manifest.shorelineXZ.map((loop) =>
            loop.map(([x, z]): [number, number] => [x + base.position[0], z + base.position[2]]),
          ),
        ),
      ),
    [manifest, layoutKey],
  );
  const workers = proofWorkers(input, manifest, bases);
  const cutaway = input.location.view !== "world";
  const activeFocus = cutaway ? (locatedProject(input)?.id ?? null) : focusId;
  const latest = useRef({ input, onLighting });
  latest.current = { input, onLighting };
  useEffect(
    () => () => {
      water.material.dispose();
      water.texture.dispose();
    },
    [water],
  );
  const appearanceKey = bases.map((base) => `${base.appearance.variant}:${base.appearance.palette}`).join();
  // biome-ignore lint/correctness/useExhaustiveDependencies: New appearance should refresh the actual scene minimap.
  useEffect(() => {
    minimapCapture.current?.();
  }, [appearanceKey, cutaway]);
  useFrame((_, delta) => {
    const current = latest.current;
    const moving = current.input.motion && current.input.connected && !document.hidden;
    clock.current.configure(current.input.environment ?? defaultEnvironment, moving, Date.now());
    if (moving) light.current.time += Math.min(delta, 0.1);
    const lighting = lightingAt(clock.current.hour(Date.now()));
    light.current.lamps = lighting.lamps;
    water.uniforms.uTime.value = light.current.time;
    water.uniforms.uSea.value.setHex(lighting.sea);
    water.uniforms.uLamps.value = lighting.lamps;
    if (sun.current) {
      sun.current.color.setHex(lighting.land).multiply(lightTint);
      sun.current.intensity = 2.8 - lighting.lamps * 2.4;
    }
    if (sky.current) sky.current.intensity = 0.95 - lighting.lamps * 0.55;
    scene.environmentIntensity = 0.28 - lighting.lamps * 0.18;
    const phase = Math.floor(lighting.hour * 2);
    if (phase !== mapPhase.current) {
      mapPhase.current = phase;
      minimapCapture.current?.();
    }
    if (Math.floor(lighting.hour * 60) !== reported.current) {
      reported.current = Math.floor(lighting.hour * 60);
      current.onLighting(lighting);
    }
  });
  if (!environment) throw new Error("The coastal export is missing.");
  return (
    <>
      <color attach="background" args={["#173e4a"]} />
      <hemisphereLight ref={sky} args={["#c1d9e1", "#4d4840", 1.5]} />
      <directionalLight
        ref={sun}
        position={[-105, 165, 90]}
        intensity={3.4}
        color="#fff1d3"
        castShadow
        shadow-mapSize={[4096, 4096]}
        shadow-camera-left={-180}
        shadow-camera-right={180}
        shadow-camera-top={180}
        shadow-camera-bottom={-180}
        shadow-camera-near={1}
        shadow-camera-far={600}
        shadow-bias={-0.00015}
        shadow-normalBias={0.04}
      />
      {bases.map((base) => {
        const source = baseGltfs[baseVariants.indexOf(base.appearance.variant)]?.scene;
        if (!source) throw new Error(`The ${base.appearance.variant} base export is missing.`);
        return (
          <ProofBase
            key={base.project.id}
            base={base}
            source={source}
            environment={environment.scene}
            cutaway={cutaway && base.project.id === activeFocus}
            light={light}
            roots={roots.current}
            lights={[
              ...(manifest.environmentLightPositions ?? []),
              ...(manifest.bases?.[base.appearance.variant].lightPositions ?? []),
            ]}
            onSelect={() => onSelect("project", base.project.id)}
          />
        );
      })}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} material={water.material}>
        <planeGeometry args={[1200, 1200, 240, 240]} />
      </mesh>
      {workers.map((worker) => (
        <ProofWorker
          key={worker.task.id}
          worker={worker}
          source={workerModel}
          clips={workerGltf?.animations ?? []}
          selected={worker.task.id === input.selectedId}
          route={worker.route}
          positions={actors.current}
          onSelect={() => onSelect("task", worker.task.id)}
        />
      ))}
      <ProofCamera
        {...props}
        focusId={activeFocus}
        cutaway={cutaway}
        actors={actors.current}
        roots={roots.current}
        captureRef={minimapCapture}
        worldHour={() => clock.current.hour(Date.now())}
      />
      <ProofLabels
        labels={labels}
        manifest={manifest}
        bases={visibleBases(bases, input)}
        actors={actors.current}
        roots={roots.current}
      />
      <SceneFinish />
    </>
  );
}
