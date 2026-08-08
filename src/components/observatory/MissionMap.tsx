import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { MissionMapLabels } from "./MissionMapLabels";
import {
  createCandidate,
  createGate,
  createSatellite,
  createStateOrb,
  createTube,
  seededRandom,
  stateColor,
} from "./missionVisuals";
import type { ObservatoryModel, ObservatorySelection } from "./model";

const STAGE_WORLD: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3] = [
  new THREE.Vector3(-5.1, 0.04, -1.5),
  new THREE.Vector3(-4.25, 0.04, -2.85),
  new THREE.Vector3(-2.75, 0.04, -3.8),
  new THREE.Vector3(-1.05, 0.04, -4.2),
  new THREE.Vector3(0.65, 0.04, -3.7),
];
const CANDIDATE_WORLD = new THREE.Vector3(-0.35, 0.16, 4.75);

export function MissionMap({
  model,
  taskId,
  selection,
  reducedMotion,
  paused,
  cameraMode,
  onSelect,
}: {
  model: ObservatoryModel;
  taskId: string;
  selection: ObservatorySelection;
  reducedMotion: boolean;
  paused: boolean;
  cameraMode: "top" | "orbit";
  onSelect: (selection: ObservatorySelection) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const selectRef = useRef(onSelect);
  const selectionRef = useRef(selection);
  selectRef.current = onSelect;
  selectionRef.current = selection;

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = canvas?.parentElement;
    if (!canvas || !container) return;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.setClearColor(0x030504, 1);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x030504, 0.027);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.copy(
      cameraMode === "top" ? new THREE.Vector3(0, 15.2, 1.9) : new THREE.Vector3(0.6, 8.2, 11.8),
    );

    const controls = new OrbitControls(camera, canvas);
    controls.target.set(0, 0, 0.3);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = 7;
    controls.maxDistance = 23;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.enabled = cameraMode === "orbit";
    controls.update();

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.62, 0.58, 0.48);
    composer.addPass(bloom);

    scene.add(new THREE.HemisphereLight(0xaabbb3, 0x120d07, 0.46));
    const amberLight = new THREE.PointLight(0xffb83f, 20, 30, 1.55);
    amberLight.position.set(-1.6, 5.2, 0.5);
    scene.add(amberLight);
    const blueLight = new THREE.PointLight(0x5aa2ff, 16, 28, 1.7);
    blueLight.position.set(2.8, 3.4, 4.4);
    scene.add(blueLight);

    const disposables: Array<{ dispose: () => void }> = [];
    const register = <T extends { dispose: () => void }>(value: T) => {
      disposables.push(value);
      return value;
    };
    const clickable: THREE.Object3D[] = [];
    const moving: THREE.Object3D[] = [];
    const pulses: THREE.Object3D[] = [];
    const markClickable = (object: THREE.Object3D, next: ObservatorySelection) => {
      object.userData.selection = next;
      clickable.push(object);
      return object;
    };

    const orbitMaterial = register(
      new THREE.MeshBasicMaterial({ color: 0x5b5548, transparent: true, opacity: 0.28 }),
    );
    [1.45, 2.2, 3.1, 4.15, 5.35, 6.65, 7.9].forEach((radius, index) => {
      const orbit = new THREE.Mesh(
        register(new THREE.TorusGeometry(radius, index % 2 ? 0.009 : 0.014, 6, 180)),
        orbitMaterial,
      );
      orbit.rotation.x = Math.PI / 2;
      orbit.position.y = -0.09;
      scene.add(orbit);
    });

    const random = seededRandom(1703);
    const starGeometry = register(new THREE.BufferGeometry());
    const starCount = 1_250;
    const stars = new Float32Array(starCount * 3);
    for (let index = 0; index < starCount; index += 1) {
      const radius = 1.8 + random() * 14.2;
      const angle = random() * Math.PI * 2;
      stars[index * 3] = Math.cos(angle) * radius;
      stars[index * 3 + 1] = (random() - 0.5) * 2.3;
      stars[index * 3 + 2] = Math.sin(angle) * radius;
    }
    starGeometry.setAttribute("position", new THREE.BufferAttribute(stars, 3));
    scene.add(
      new THREE.Points(
        starGeometry,
        register(
          new THREE.PointsMaterial({
            color: 0xe8cf91,
            size: 0.026,
            sizeAttenuation: true,
            transparent: true,
            opacity: 0.68,
          }),
        ),
      ),
    );

    const coreGroup = new THREE.Group();
    coreGroup.add(
      new THREE.Mesh(
        register(new THREE.OctahedronGeometry(0.66, 2)),
        register(
          new THREE.MeshPhysicalMaterial({
            color: 0xb07d28,
            emissive: 0x8b4f07,
            emissiveIntensity: 1.75,
            metalness: 0.78,
            roughness: 0.17,
            clearcoat: 0.9,
          }),
        ),
      ),
    );
    coreGroup.add(
      new THREE.Mesh(
        register(new THREE.OctahedronGeometry(0.94, 1)),
        register(
          new THREE.MeshBasicMaterial({
            color: 0xffd784,
            wireframe: true,
            transparent: true,
            opacity: 0.76,
          }),
        ),
      ),
    );
    [1.12, 1.42].forEach((radius, index) => {
      const halo = new THREE.Mesh(
        register(new THREE.TorusGeometry(radius, index ? 0.012 : 0.027, 10, 96)),
        register(new THREE.MeshBasicMaterial({ color: 0xe9a72f, transparent: true, opacity: 0.62 })),
      );
      halo.rotation.x = Math.PI / 2;
      halo.rotation.y = index * 0.58;
      coreGroup.add(halo);
    });
    markClickable(coreGroup, { kind: "stage", id: model.stages[0]?.id ?? "triage" });
    moving.push(coreGroup);
    scene.add(coreGroup);

    const investigation = createTube(register, STAGE_WORLD, 0x69cf99, 0.025, 0.92);
    scene.add(investigation.tube);
    model.stages.slice(0, 5).forEach((stage, index) => {
      const marker = createStateOrb(register, stage.state, 0.165, false);
      marker.position.copy(STAGE_WORLD[index] ?? STAGE_WORLD[0]);
      markClickable(marker, { kind: "stage", id: stage.id });
      pulses.push(marker);
      scene.add(marker);
    });

    const packageWorld: THREE.Vector3[] = [];
    model.packages.forEach((item, index) => {
      const count = Math.max(model.packages.length, 1);
      const yOffset = (index - (count - 1) / 2) * 1.55;
      const position = new THREE.Vector3(3.05 + (index % 2) * 0.8, 0.14, -1.65 + yOffset);
      packageWorld.push(position);
      const satellite = createSatellite(register, item.state, false);
      satellite.position.copy(position);
      markClickable(satellite, { kind: "package", id: item.id });
      moving.push(satellite);
      pulses.push(satellite);
      scene.add(satellite);

      const inbound = createTube(
        register,
        [STAGE_WORLD[4], new THREE.Vector3(1.55, 0.04, -2.7 + yOffset * 0.4), position],
        stateColor(item.state),
        item.state === "active" ? 0.032 : 0.018,
        item.state === "stale" ? 0.38 : 0.82,
      );
      scene.add(inbound.tube);
      const outbound = createTube(
        register,
        [position, new THREE.Vector3(3.2, 0.06, 2.6 + yOffset * 0.22), CANDIDATE_WORLD],
        stateColor(item.state),
        item.state === "active" ? 0.032 : 0.018,
        0.78,
      );
      scene.add(outbound.tube);
    });

    if (model.candidate) {
      const candidate = createCandidate(register, model.candidate.state, false);
      candidate.position.copy(CANDIDATE_WORLD);
      markClickable(candidate, { kind: "candidate", id: model.candidate.id });
      moving.push(candidate);
      pulses.push(candidate);
      scene.add(candidate);

      if (model.candidate.priorRevision) {
        const ghost = createCandidate(register, "stale", false);
        ghost.position.set(-4.9, 0.05, 5.4);
        ghost.scale.setScalar(0.56);
        ghost.traverse((child) => {
          if (child instanceof THREE.Mesh && child.material instanceof THREE.Material) {
            child.material.transparent = true;
            child.material.opacity = 0.22;
          }
        });
        scene.add(ghost);
      }
    }

    const gateWorld = model.stages.slice(6).map((stage, index) => {
      const position = new THREE.Vector3(1.95 + index * 1.72, 0.14, 5.15 + index * 0.08);
      const gate = createGate(register, stage.state, false);
      gate.position.copy(position);
      markClickable(gate, { kind: "stage", id: stage.id });
      moving.push(gate);
      pulses.push(gate);
      scene.add(gate);
      return position;
    });
    if (model.candidate && gateWorld.length) {
      const gatePath = createTube(
        register,
        [CANDIDATE_WORLD, ...gateWorld],
        stateColor(model.candidate.state),
        0.027,
        0.7,
      );
      scene.add(gatePath.tube);
    }

    const travelPoints = [
      ...STAGE_WORLD,
      packageWorld[0] ?? new THREE.Vector3(2.7, 0.1, -1),
      CANDIDATE_WORLD,
      ...gateWorld,
    ];
    const travel = new THREE.CatmullRomCurve3(travelPoints, false, "centripetal", 0.25);
    const artifactGeometry = register(new THREE.BoxGeometry(0.13, 0.13, 0.13));
    const artifactMaterial = register(
      new THREE.MeshPhysicalMaterial({
        color: 0xffd273,
        emissive: 0xca7a0c,
        emissiveIntensity: 2.3,
        metalness: 0.55,
        roughness: 0.2,
      }),
    );
    const artifacts = Array.from({ length: 11 }, (_, index) => {
      const artifact = new THREE.Mesh(artifactGeometry, artifactMaterial);
      artifact.userData.offset = index / 11;
      scene.add(artifact);
      return artifact;
    });

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const resolveHit = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
      pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      let object: THREE.Object3D | null = raycaster.intersectObjects(clickable, true)[0]?.object ?? null;
      while (object && !object.userData.selection) object = object.parent;
      return object?.userData.selection as ObservatorySelection | undefined;
    };
    const handlePointerUp = (event: PointerEvent) => {
      const next = resolveHit(event);
      if (next) selectRef.current(next);
    };
    const handlePointerMove = (event: PointerEvent) => {
      canvas.style.cursor = resolveHit(event) ? "pointer" : cameraMode === "orbit" ? "grab" : "default";
    };
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointermove", handlePointerMove);

    const resize = () => {
      const { width, height } = container.getBoundingClientRect();
      const safeWidth = Math.max(1, width);
      const safeHeight = Math.max(1, height);
      renderer.setSize(safeWidth, safeHeight, false);
      composer.setSize(safeWidth, safeHeight);
      camera.aspect = safeWidth / safeHeight;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    const timer = new THREE.Timer();
    timer.connect(document);
    let frame = 0;
    const animate = (timestamp: number) => {
      frame = window.requestAnimationFrame(animate);
      timer.update(timestamp);
      const elapsed = timer.getElapsed();
      if (!paused && !reducedMotion) {
        coreGroup.rotation.y = elapsed * 0.18;
        moving.forEach((object, index) => {
          if (object !== coreGroup) object.rotation.y += 0.0022 + index * 0.00012;
        });
        pulses.forEach((object, index) => {
          const selectedObject = object.userData.selection;
          const base = selectedObject ? 1 : 1;
          object.position.y = 0.12 + Math.sin(elapsed * 1.6 + index) * 0.035 * base;
        });
        artifacts.forEach((artifact) => {
          const progress = (elapsed * 0.043 + Number(artifact.userData.offset)) % 1;
          if (!Number.isFinite(progress)) return;
          artifact.position.copy(travel.getPoint(THREE.MathUtils.clamp(progress, 0, 0.999_999)));
          artifact.position.y += 0.24;
          artifact.rotation.x = elapsed * 1.4;
          artifact.rotation.y = elapsed * 1.9;
        });
      } else {
        artifacts.forEach((artifact) => {
          const progress = Number(artifact.userData.offset);
          if (!Number.isFinite(progress)) return;
          artifact.position.copy(travel.getPoint(THREE.MathUtils.clamp(progress, 0, 0.999_999)));
          artifact.position.y += 0.24;
        });
      }
      controls.update();
      clickable.forEach((object) => {
        const target = sameSelection(object.userData.selection, selectionRef.current) ? 1.12 : 1;
        object.scale.lerp(new THREE.Vector3(target, target, target), reducedMotion ? 1 : 0.12);
      });
      composer.render();
    };
    animate(performance.now());

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointermove", handlePointerMove);
      controls.dispose();
      timer.dispose();
      bloom.dispose();
      composer.dispose();
      renderer.dispose();
      disposables.forEach((item) => {
        item.dispose();
      });
      scene.clear();
    };
  }, [cameraMode, model, paused, reducedMotion]);

  return (
    <section className="mission-map" data-testid="mission-map">
      <canvas ref={canvasRef} aria-label="Interactive three-dimensional workflow mission map" />
      <MissionMapLabels model={model} taskId={taskId} selection={selection} onSelect={onSelect} />
    </section>
  );
}

function sameSelection(left: unknown, right: ObservatorySelection) {
  if (!left || typeof left !== "object" || !("kind" in left) || !("id" in left)) return false;
  return left.kind === right.kind && left.id === right.id;
}
