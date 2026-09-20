import { Canvas, useLoader, useThree } from "@react-three/fiber";
import {
  Component,
  type ReactNode,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Group, OrthographicCamera, PCFShadowMap } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { RuntimeProject } from "../../domain";
import { type BaseAppearance, baseNames, basePalettes } from "./appearance";
import { colonyCameras } from "./colony";
import { configureGltfLoader } from "./gltf-loader";
import type { ProjectBase } from "./layout";
import { type ProofManifest, parseProofManifest } from "./model";
import { ProofBase, type SceneLight } from "./ProofBase";

let previewManifest: Promise<ProofManifest | null> | null = null;

function loadPreviewManifest() {
  previewManifest ??= fetch("/assets/3d-proof/manifest.json")
    .then((response) => {
      if (!response.ok) throw new Error("The headquarters model could not be loaded.");
      return response.json();
    })
    .then((value: unknown) => parseProofManifest(value))
    .catch(() => null);
  return previewManifest;
}

export function usePreviewManifest() {
  const [manifest, setManifest] = useState<ProofManifest | null>(null);
  useEffect(() => {
    let active = true;
    void loadPreviewManifest().then((next) => {
      if (active) setManifest(next);
    });
    return () => {
      active = false;
    };
  }, []);
  return manifest;
}

class PreviewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <span className="base-model-unavailable">3D preview unavailable</span>
    ) : (
      this.props.children
    );
  }
}

function PreviewCamera() {
  const { camera, invalidate, size } = useThree();
  useLayoutEffect(() => {
    const view = colonyCameras.exterior;
    camera.position.set(...view.position);
    camera.lookAt(...view.target);
    if (camera instanceof OrthographicCamera) {
      camera.zoom = size.height / (view.verticalSpan * 0.84);
      camera.updateProjectionMatrix();
    }
    invalidate();
  }, [camera, invalidate, size.height]);
  return null;
}

const previewProject: RuntimeProject = {
  id: "appearance-preview",
  name: "Appearance preview",
  repositoryPath: "/appearance-preview",
  createdAt: null,
};

function PreviewModel({ manifest, appearance }: { manifest: ProofManifest; appearance: BaseAppearance }) {
  const invalidate = useThree((state) => state.invalidate);
  const shell = manifest.colony?.shell;
  const crown = manifest.colony?.crowns?.[appearance.variant] ?? manifest.colony?.crowns?.command;
  if (!shell || !crown) throw new Error("The selected headquarters model is unavailable.");
  const sources = useMemo(() => [shell, crown], [shell, crown]);
  const gltfs = useLoader(GLTFLoader, sources, configureGltfLoader);
  const source = useMemo(() => {
    const group = new Group();
    for (const gltf of gltfs) group.add(gltf.scene.clone(true));
    return group;
  }, [gltfs]);
  const base = useMemo(
    () =>
      ({
        project: previewProject,
        position: [0, 0, 0],
        appearance: { ...appearance, slot: "P1" },
        slot: "P1",
      }) satisfies ProjectBase,
    [appearance],
  );
  const light = useRef<SceneLight>({ lamps: 0.16, time: 12 });
  const roots = useMemo(() => new Map(), []);
  useEffect(() => {
    invalidate();
    const frame = requestAnimationFrame(() => invalidate());
    return () => cancelAnimationFrame(frame);
  }, [invalidate]);
  return (
    <>
      <color attach="background" args={["#102d39"]} />
      <hemisphereLight args={["#d9edf2", "#49463e", 1.8]} />
      <directionalLight position={[-52, 80, 48]} intensity={3.1} color="#fff1d3" />
      <ProofBase
        base={base}
        source={source}
        cutaway={false}
        light={light}
        roots={roots}
        onSelect={() => {}}
      />
      <PreviewCamera />
    </>
  );
}

export function BaseModelPreview({ appearance, alt }: { appearance: BaseAppearance; alt: string }) {
  const manifest = usePreviewManifest();
  const palette = basePalettes[appearance.palette];
  return (
    <div className="base-model-preview" data-variant={appearance.variant} data-palette={appearance.palette}>
      {manifest ? (
        <PreviewBoundary>
          <Canvas
            orthographic
            frameloop="demand"
            shadows={{ type: PCFShadowMap }}
            dpr={[1, 1.5]}
            camera={{ position: [56, 49, 70], near: 0.1, far: 300, zoom: 5 }}
            aria-label={alt}
          >
            <Suspense fallback={null}>
              <PreviewModel
                key={`${appearance.variant}:${appearance.palette}`}
                manifest={manifest}
                appearance={appearance}
              />
            </Suspense>
          </Canvas>
        </PreviewBoundary>
      ) : (
        <span className="base-model-loading" role="status">
          Loading 3D model…
        </span>
      )}
      <div className="base-model-labels" aria-hidden="true">
        <span>{baseNames[appearance.variant]}</span>
        <span>
          <i style={{ background: palette.color }} /> {palette.label}
        </span>
      </div>
    </div>
  );
}
