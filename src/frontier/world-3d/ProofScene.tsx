import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { Fragment, useEffect, useMemo, useRef } from "react";
import { Color, type DirectionalLight, type HemisphereLight, type Object3D, type PointLight } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  defaultEnvironment,
  LightingClock,
  lightingAt,
  type WorldLighting,
} from "../world/environment-model";
import { basePalettes, legacyVariant } from "./appearance";
import { ColonyGround } from "./ColonyGround";
import { ColonyProps } from "./ColonyProps";
import { ColonyRingRoad } from "./ColonyRingRoad";
import { ColonyRoomLights } from "./ColonyRoomLights";
import { ColonyShuttle } from "./ColonyShuttle";
import { ColonyTerrain } from "./ColonyTerrain";
import { ColonyWater } from "./ColonyWater";
import { baseLabelAnchor, hubSlot, projectKey } from "./colony";
import { colonyModels, proofAssetUrls } from "./colony-assets";
import { disposeGreybox } from "./colony-greybox";
import { configureGltfLoader } from "./gltf-loader";
import { LampPool, lampBudget, type PooledLamp } from "./lamp-pool";
import { hubParcel, locatedProject, occupiedSlots, type ProjectBase, visibleBases } from "./layout";
import {
  type Point3,
  type ProofControls,
  type ProofInput,
  type ProofManifest,
  proofView,
  proofWorkers,
} from "./model";
import { ParcelScatter, type ParcelScatterPlan } from "./ParcelScatter";
import { PerformanceProbe, profiling } from "./PerformanceProbe";
import { ProofBase, type SceneLight } from "./ProofBase";
import { ProofCamera } from "./ProofCamera";
import { ProofLabels } from "./ProofLabels";
import { ProofWorker } from "./ProofWorker";
import { SceneFinish } from "./SceneFinish";
import { lanternLampOffset, scatterLayout } from "./scatter";
import { ShadowCadence } from "./shadow-cadence";
import {
  buildField,
  coastRadius,
  hasRingRoad,
  heightAt,
  ringRoadRadius,
  slopeAt,
  type TerrainField,
} from "./terrain-field";
import { createCoastalWater, createWaterFromField, setWaterSplashes, type WaterSplash } from "./water";
import { batchWorker } from "./worker-batching";

/** The station's authored practical white, and what a lamp is before a project claims it. */
const warmLamp = new Color("#ffc37f");
const lampPalette = new Color();
/**
 * A pooled lamp still has to light the ground, so it only travels part way to the project colour:
 * far enough that a base's own lamps read as its own, not so far that the court goes monochrome.
 */
function lampColour(palette: string | null | undefined) {
  if (!palette) return undefined;
  return lampPalette.copy(warmLamp).lerp(colourOf(palette), 0.4).getHex();
}
const colourCache = new Map<string, Color>();
function colourOf(hex: string) {
  const existing = colourCache.get(hex);
  if (existing) return existing;
  const colour = new Color(hex);
  colourCache.set(hex, colour);
  return colour;
}

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
  const sources = useMemo(() => proofAssetUrls(manifest), [manifest]);
  const gltfs = useLoader(GLTFLoader, sources, configureGltfLoader);
  const loaded = useMemo(() => new Map(sources.map((url, index) => [url, gltfs[index]])), [sources, gltfs]);
  const workerGltf = loaded.get(manifest.worker);
  const environment = loaded.get(manifest.scene);
  const colony = useMemo(
    () =>
      manifest.version === 3
        ? colonyModels(
            manifest,
            new Map([...loaded].flatMap(([url, gltf]) => (gltf ? [[url, gltf.scene]] : []))),
          )
        : null,
    [manifest, loaded],
  );
  useEffect(
    () => () => {
      for (const model of colony?.owned ?? []) disposeGreybox(model);
    },
    [colony],
  );
  const { scene, gl } = useThree();
  const workerModel = useMemo(() => {
    if (!workerGltf) throw new Error("The worker export is missing.");
    return batchWorker(workerGltf.scene);
  }, [workerGltf]);
  useEffect(() => () => workerModel.dispose(), [workerModel]);
  useEffect(() => {
    const previous = gl.shadowMap.autoUpdate;
    gl.shadowMap.autoUpdate = false;
    return () => {
      gl.shadowMap.autoUpdate = previous;
    };
  }, [gl]);
  const clock = useRef(new LightingClock());
  const light = useRef<SceneLight>({ lamps: 0, time: 0 });
  const reported = useRef(-1);
  const shadowCadence = useRef(new ShadowCadence());
  const lampPool = useRef(new LampPool());
  const lampNodes = useRef<(PointLight | null)[]>([]);
  const sun = useRef<DirectionalLight>(null);
  const sky = useRef<HemisphereLight>(null);
  const actors = useRef(new Map<string, Object3D>());
  const roots = useRef(new Map<string, Object3D>());
  const lightTint = useMemo(() => new Color("#ffe9d0"), []);
  const minimapCapture = useRef<(() => void) | null>(null);
  const mapPhase = useRef(-1);
  const layoutKey = bases.map((base) => base.position.join()).join("|");
  const occupiedKey = occupiedSlots(bases).join();
  // Contract 2.0 land: one analytic height field for every occupied slot plus the landing terrace.
  // biome-ignore lint/correctness/useExhaustiveDependencies: The field depends on the occupied slot set only.
  const field = useMemo<TerrainField | null>(
    () => (colony ? buildField(occupiedSlots(bases)) : null),
    [colony, occupiedKey],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: Water depends on placement, not appearance or runtime refresh.
  const water = useMemo(
    () =>
      field
        ? createWaterFromField(field.bounds, (x, z) => heightAt(field, x, z))
        : createCoastalWater(
            bases.flatMap((base) =>
              manifest.shorelineXZ.map((loop) =>
                loop.map(([x, z]): [number, number] => [x + base.position[0], z + base.position[2]]),
              ),
            ),
          ),
    [manifest, layoutKey, field],
  );
  const workers = proofWorkers(input, manifest, bases);
  const cutaway = input.location.view !== "world";
  const activeFocus = cutaway ? (locatedProject(input)?.id ?? null) : focusId;
  const view = proofView(input, focusId);
  const latest = useRef({ input, onLighting });
  latest.current = { input, onLighting };
  useEffect(
    () => () => {
      water.material.dispose();
      water.texture.dispose();
    },
    [water],
  );
  // The sea foams where each parcel's waterfall lands.
  useEffect(() => {
    const splashes: WaterSplash[] = (field?.profiles ?? []).flatMap((profile) =>
      profile.water
        ? [
            [
              profile.centre[0] + profile.water.fall.base[0],
              profile.centre[1] + profile.water.fall.base[1],
              2.6,
              1,
            ] as WaterSplash,
          ]
        : [],
    );
    setWaterSplashes(water, splashes);
  }, [water, field]);
  const appearanceKey = bases.map((base) => `${base.appearance.variant}:${base.appearance.palette}`).join();
  // Seeded scatter per parcel: trees, boulders, lantern posts and parked vehicles from the shared kit.
  const scatterKey = bases.map((base) => `${projectKey(base.project)}@${base.position.join()}`).join("|");
  // biome-ignore lint/correctness/useExhaustiveDependencies: Scatter follows the parcel set, not appearance or runtime refresh.
  const scatterPlans = useMemo<ParcelScatterPlan[]>(() => {
    if (!field) return [];
    const plan = (
      slotId: string,
      origin: Point3,
      key: string,
      palette: string | null,
    ): ParcelScatterPlan[] => {
      const profile = field.profiles.find((entry) => entry.id === slotId);
      if (!profile) return [];
      const groundAt = (x: number, z: number) => heightAt(field, origin[0] + x, origin[2] + z);
      return [
        {
          origin,
          groundAt,
          palette,
          placements: scatterLayout(key, {
            hub: profile.hub,
            flatRadius: profile.flatRadius,
            coast: (angleDeg) => coastRadius(profile, angleDeg),
            ground: (x, z) => ({
              height: groundAt(x, z),
              slope: slopeAt(field, origin[0] + x, origin[2] + z),
            }),
            builtEdgeAngles: profile.built.map((edge) => edge.worldAngleDeg),
            ringRadius: hasRingRoad(profile) ? (angleDeg) => ringRoadRadius(profile, angleDeg) : null,
            water: profile.water
              ? {
                  fallAngleDeg: profile.water.fall.angleDeg,
                  pools: profile.water.pools,
                  path: profile.water.path,
                  halfWidth: profile.water.halfWidth,
                }
              : null,
            shelf: profile.shelf,
          }),
        },
      ];
    };
    return [
      // The landing terrace belongs to no project, so its kit keeps the authored colour.
      ...plan(hubSlot.id, hubParcel.position, hubSlot.id, null),
      ...bases.flatMap((base) =>
        base.slot
          ? plan(
              base.slot,
              base.position,
              projectKey(base.project),
              basePalettes[base.appearance.palette].light,
            )
          : [],
      ),
    ];
  }, [field, scatterKey, appearanceKey]);
  const lampSlots = useMemo(() => Array.from({ length: lampBudget }, (_, slot) => `lamp:${slot}`), []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Lamp placement follows layout and variant, not identity.
  const lampsWorld = useMemo<PooledLamp[]>(
    () => [
      ...scatterPlans.flatMap((plan, planIndex) =>
        plan.placements
          .filter((placement) => placement.kind === "lantern")
          .map((placement, index) => ({
            key: `lantern:${planIndex}:${index}`,
            color: lampColour(plan.palette),
            position: [
              plan.origin[0] + placement.x + lanternLampOffset[0],
              plan.origin[1] + 4 + lanternLampOffset[1],
              plan.origin[2] + placement.z + lanternLampOffset[2],
            ] as Point3,
          })),
      ),
      ...bases.flatMap((base) =>
        [
          ...(manifest.version === 3 ? [] : (manifest.environmentLightPositions ?? [])),
          ...(manifest.version === 3
            ? (manifest.colony?.hqLightPositions ?? [])
            : (manifest.bases?.[legacyVariant(base.appearance.variant)].lightPositions ?? [])),
        ].map((position, index) => ({
          key: `${base.project.id}:${index}`,
          color: lampColour(basePalettes[base.appearance.palette].light),
          position: [
            position[0] + base.position[0],
            position[1] + base.position[1],
            position[2] + base.position[2],
          ] as Point3,
        })),
      ),
    ],
    [manifest, layoutKey, appearanceKey, scatterPlans],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: New appearance should refresh the actual scene minimap.
  useEffect(() => {
    minimapCapture.current?.();
  }, [appearanceKey, cutaway]);
  useFrame((state, delta) => {
    // Small worker shadows can lag; motion stays full-rate.
    if (shadowCadence.current.expired(performance.now())) gl.shadowMap.needsUpdate = true;
    const current = latest.current;
    const moving = current.input.motion && current.input.connected && !document.hidden;
    clock.current.configure(current.input.environment ?? defaultEnvironment, moving, Date.now());
    if (moving) light.current.time += Math.min(delta, 0.1);
    const lighting = lightingAt(clock.current.hour(Date.now()));
    light.current.lamps = lighting.lamps;
    light.current.sea = lighting.sea;
    water.uniforms.uTime.value = light.current.time;
    water.uniforms.uSea.value.setHex(lighting.sea);
    water.uniforms.uLamps.value = lighting.lamps;
    if (sun.current) {
      sun.current.color.setHex(lighting.land).multiply(lightTint);
      sun.current.intensity = 2.8 - lighting.lamps * 2.4;
    }
    if (sky.current) sky.current.intensity = 0.95 - lighting.lamps * 0.55;
    scene.environmentIntensity = 0.28 - lighting.lamps * 0.18;
    // Only the lamps nearest the viewer are given a real light; the rest keep their emissive lenses.
    const lit = lighting.lamps > 0.01;
    if (lit) lampPool.current.update(lampsWorld, state.camera.position, Math.min(delta, 0.1));
    lampPool.current.slots.forEach((slot, index) => {
      const node = lampNodes.current[index];
      if (!node) return;
      node.visible = lit;
      node.position.set(...slot.position);
      node.intensity = (0.1 + lighting.lamps * 16) * slot.level;
      node.color.setHex(slot.color ?? 0xffc37f);
    });
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
  const islandTile = colony ? undefined : environment?.scene;
  if (!colony && !islandTile) throw new Error("The coastal export is missing.");
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
        const source =
          colony?.bases[base.appearance.variant] ??
          loaded.get(manifest.bases?.[legacyVariant(base.appearance.variant)].src ?? manifest.scene)?.scene;
        if (!source) throw new Error(`The ${base.appearance.variant} base export is missing.`);
        return (
          <Fragment key={base.project.id}>
            <ProofBase
              base={base}
              source={source}
              environment={islandTile}
              cutaway={cutaway && base.project.id === activeFocus}
              light={light}
              roots={roots.current}
              onSelect={() => onSelect("project", base.project.id)}
            />
            {/* Every HQ is the same shell, so every HQ carries the same room props. */}
            {colony?.props && <ColonyProps model={colony.props} origin={base.position} light={light} />}
            {/* Only the opened base: with its roof on, a room's skirting is six draw calls of
                geometry nobody can see. */}
            {colony && cutaway && base.project.id === activeFocus && (
              <ColonyRoomLights light={light} origin={base.position} />
            )}
          </Fragment>
        );
      })}
      {colony && field && <ColonyTerrain field={field} textures={manifest.colony?.terrainTextures} />}
      {colony && field && <ColonyWater field={field} light={light} />}
      {colony && <ColonyGround bases={bases} span={colony.span} end={colony.end} />}
      {colony && field && <ColonyRingRoad bases={bases} field={field} span={colony.span} />}
      {colony?.kit && <ParcelScatter kit={colony.kit} plans={scatterPlans} />}
      {colony?.shuttle && <ColonyShuttle model={colony.shuttle} origin={hubParcel.position} />}
      {lampSlots.map((slot, index) => (
        <pointLight
          key={slot}
          color="#ffc37f"
          intensity={0}
          distance={5}
          decay={2}
          visible={false}
          ref={(node) => {
            lampNodes.current[index] = node;
          }}
        />
      ))}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} material={water.material}>
        <planeGeometry args={[1200, 1200, 240, 240]} />
      </mesh>
      {workers.map((worker) => (
        <ProofWorker
          key={worker.id}
          worker={worker}
          view={view}
          source={workerModel.scene}
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
        sceneKey={`${appearanceKey}:${layoutKey}:${cutaway}:${activeFocus}`}
        labels={labels}
        bases={visibleBases(bases, input)}
        baseLabel={colony ? baseLabelAnchor : (manifest.sockets.base_label ?? [0, 16, -2])}
        robotView={view}
        hudKey={`${input.selectedId}:${input.location.taskId}:${input.location.view}`}
        actors={actors.current}
        roots={roots.current}
      />
      <SceneFinish />
      {profiling && <PerformanceProbe />}
    </>
  );
}
