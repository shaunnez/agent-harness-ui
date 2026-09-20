import { ArrowLeft, Cube, MapPin, Question, WarningCircle } from "@phosphor-icons/react";
import { Canvas, useLoader } from "@react-three/fiber";
import { Component, type ReactNode, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { PCFShadowMap, WebGLRenderer, type WebGLRendererParameters } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { WorldPreferences } from "../app/preferences";
import { splitRecordedDetail } from "../runtime/presentation";
import { WorldTime } from "../views/WorldTime";
import { lightingAt, type WorldLighting } from "../world/environment-model";
import { basePalettes } from "./appearance";
import { BaseAppearancePicker } from "./BaseAppearancePicker";
import { proofAssetUrls } from "./colony-assets";
import { archipelagoBases, locatedProject, projectBases, visibleBases } from "./layout";
import {
  colonyRequested,
  compactWorkerLabels,
  existingWorldUrl,
  type ProofControls,
  type ProofInput,
  type ProofManifest,
  parseProofManifest,
  proofWorkerState,
  visibleWorkerLabels,
  withoutColony,
} from "./model";
import { ProofScene } from "./ProofScene";
import { roomIds, roomNames } from "./rooms";
import { useBaseAppearance } from "./useBaseAppearance";
import "./proof.css";
import { PerformancePanel, profiling } from "./PerformanceProbe";

// Stable construction options keep runtime refreshes from resetting a user-moved camera.
const initialCamera = { position: [56, 49, 70] as [number, number, number], near: 0.1, far: 850, zoom: 15 };
const shadowOptions = { type: PCFShadowMap };
const rendererOptions = { antialias: true, alpha: false, preserveDrawingBuffer: false };

interface Props {
  input: ProofInput;
  selectedProjectId?: string | null;
  preferences: WorldPreferences;
  controlsRef: React.RefObject<ProofControls | null>;
  onSelect(kind: "project" | "task", id: string): void;
  onExterior(): void;
  onEnterProject(id: string): void;
  onWorldSettings(): void;
}
class SceneBoundary extends Component<
  { children: ReactNode; fallback: ReactNode; onError(message: string): void },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  componentDidCatch() {
    this.props.onError(
      "The 3D artwork could not be loaded or rendered. Retry the scene or return to the existing world.",
    );
  }
  render() {
    return this.state.error ? this.props.fallback : this.props.children;
  }
}

export function ProofWorld(props: Props) {
  const { input, preferences, onSelect, onEnterProject, onExterior, onWorldSettings } = props;
  const [manifest, setManifest] = useState<ProofManifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [lighting, setLighting] = useState<WorldLighting>(() => lightingAt(preferences.environment.hour));
  const [minimap, setMinimap] = useState<string | null>(null);
  const labels = useRef<HTMLElement>(null);
  const [ready, setReady] = useState(false);
  const markReady = useCallback(() => setReady(true), []);
  const [focusId, setFocusId] = useState<string | null>(null);
  useEffect(() => {
    // A world-only detail camera must not survive a trip into another project's headquarters or Watch.
    if (input.location.view !== "world") setFocusId(null);
  }, [input.location.view]);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [appearanceProjectId, setAppearanceProjectId] = useState<string | null>(null);
  const { appearances, choose, storageProblem } = useBaseAppearance(input.projects);
  // Without ?colony=1 the world keeps main's archipelago: one island tile per project, no lattice.
  const colony = colonyRequested(window.location.search);
  const bases = colony
    ? projectBases(input.projects, appearances, true)
    : archipelagoBases(input.projects, appearances);
  const contextId =
    input.location.view === "world"
      ? (props.selectedProjectId ?? focusId ?? locatedProject(input)?.id)
      : locatedProject(input)?.id;
  const project = bases.find((base) => base.project.id === contextId)?.project ?? bases[0]?.project;
  const { workers: allWorkers, problem: allocationProblem } = proofWorkerState(input, manifest, bases);
  const sceneProblem = error ?? allocationProblem;
  const workers = visibleWorkerLabels(allWorkers, input, focusId);
  const compact = compactWorkerLabels(workers, input, focusId);
  const frameWorld = () => {
    if (!focusId && input.location.view === "world") props.controlsRef.current?.frame();
    setFocusId(null);
    onExterior();
  };
  const existing = existingWorldUrl(window.location.search);
  const problem = useCallback((message: string) => {
    setReady(false);
    setError(message);
  }, []);
  const createRenderer = useCallback(
    (options: WebGLRendererParameters) => {
      try {
        return new WebGLRenderer({ ...options, ...rendererOptions });
      } catch (cause) {
        problem("WebGL could not start. Retry the scene or return to the existing world.");
        throw cause;
      }
    },
    [problem],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: Explicit retry remounts the export request.
  useEffect(() => {
    const controller = new AbortController();
    setManifest(null);
    setError(null);
    setReady(false);
    const timer = setTimeout(() => {
      setError("The 3D scene request timed out. Retry the artwork or return to the existing world.");
      controller.abort();
    }, 20_000);
    fetch("/assets/3d-proof/manifest.json", { signal: controller.signal, cache: "no-cache" })
      .then((response) => {
        if (!response.ok) throw new Error("The 3D scene assets could not be loaded.");
        return response.json();
      })
      .then((value: unknown) => {
        const parsed = colony ? parseProofManifest(value) : withoutColony(parseProofManifest(value));
        if (new URLSearchParams(window.location.search).get("proofAssetFailure") === "1") {
          if (parsed.colony) parsed.colony.shell = "/assets/3d-proof/missing-scene.glb";
          else parsed.scene = "/assets/3d-proof/missing-scene.glb";
        }
        if (!controller.signal.aborted) setManifest(parsed);
      })
      .catch((problem: unknown) => {
        if (!controller.signal.aborted)
          setError(problem instanceof Error ? problem.message : "The 3D scene could not load.");
      })
      .finally(() => clearTimeout(timer));
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [retry]);
  useEffect(() => {
    if (!manifest || ready || error) return;
    const timer = setTimeout(
      () =>
        problem("The 3D artwork did not finish loading. Retry the scene or return to the existing world."),
      30_000,
    );
    return () => clearTimeout(timer);
  }, [manifest, ready, error, problem]);
  const unavailable = (
    <section className="world-error panel proof-error" role="alert">
      <h2>3D scene unavailable</h2>
      <p>{sceneProblem ?? "This browser could not render the scene or load its artwork."}</p>
      <button
        type="button"
        onClick={() => {
          if (manifest) useLoader.clear(GLTFLoader, proofAssetUrls(manifest));
          setRetry((value) => value + 1);
        }}
      >
        Retry 3D scene
      </button>
      <a href={existing}>Return to existing world</a>
    </section>
  );
  return (
    <>
      {profiling && <PerformancePanel ready={ready} />}
      <div className="world-canvas proof-canvas" data-renderer="three" data-ready={ready}>
        {sceneProblem ? (
          unavailable
        ) : manifest ? (
          <SceneBoundary key={retry} fallback={unavailable} onError={problem}>
            <Canvas
              orthographic
              shadows={shadowOptions}
              dpr={[1, 1.5]}
              camera={initialCamera}
              gl={createRenderer}
              aria-label="Project bases in the 3D coastal world. Select workers with the world labels or click their models."
              fallback={<span>3D canvas requires WebGL.</span>}
            >
              <Suspense fallback={null}>
                <ProofScene
                  {...props}
                  manifest={manifest}
                  bases={bases}
                  focusId={focusId}
                  onFocus={setFocusId}
                  labels={labels}
                  onLighting={setLighting}
                  onMinimap={setMinimap}
                  onReady={markReady}
                  onProblem={problem}
                />
              </Suspense>
            </Canvas>
          </SceneBoundary>
        ) : null}
      </div>
      {!ready && !sceneProblem && (
        <p className="proof-loading panel" role="status">
          Loading project bases…
        </p>
      )}
      <WorldTime
        lighting={lighting}
        preferences={preferences}
        moving={input.motion && input.connected}
        onSettings={onWorldSettings}
      />
      <nav className="proof-navigation panel" aria-label="3D proof views">
        <span>
          <Cube size={17} /> 3D preview
        </span>
        <button type="button" aria-pressed={input.location.view === "world" && !focusId} onClick={frameWorld}>
          World
        </button>
        <button
          type="button"
          aria-pressed={input.location.view === "world" && Boolean(focusId)}
          onClick={() => {
            if (project) {
              setFocusId(project.id);
              onExterior();
            }
          }}
        >
          Exterior
        </button>
        <button
          type="button"
          aria-pressed={input.location.view !== "world"}
          onClick={() => project && onEnterProject(project.id)}
        >
          Cutaway
        </button>
        <button
          type="button"
          aria-expanded={appearanceOpen}
          onClick={() => {
            setAppearanceProjectId(project?.id ?? null);
            setAppearanceOpen((value) => !value);
          }}
        >
          Appearance
        </button>
        <a href={existing} title="Return to the existing 2D world">
          <ArrowLeft size={15} /> 2D world
        </a>
        {new URLSearchParams(window.location.search).get("qa") === "1" && ready && (
          <button type="button" onClick={() => props.controlsRef.current?.simulateContextLoss()}>
            Simulate graphics loss (QA)
          </button>
        )}
      </nav>
      <nav
        ref={labels}
        className={`world-labels proof-labels ${input.location.view === "world" ? "exterior" : ""} label-size-${preferences.labelSize}`}
        aria-label="3D world selection"
        hidden={!preferences.labels || !ready}
      >
        {(input.location.view === "world" ? visibleBases(bases, input) : []).map((base) => (
          <button
            type="button"
            key={base.project.id}
            className="world-label project"
            data-proof-id={`base:${base.project.id}`}
            style={{ borderColor: basePalettes[base.appearance.palette].color }}
            onClick={() => onSelect("project", base.project.id)}
            onDoubleClick={() => onEnterProject(base.project.id)}
          >
            <MapPin size={20} color={basePalettes[base.appearance.palette].color} />
            <span>
              <strong>
                {base.project.name}
                {base.project.archivedAt ? " · Dormant" : ""}
              </strong>
            </span>
          </button>
        ))}
        {manifest?.version === 3 &&
          input.location.view !== "world" &&
          roomIds.map((room) => (
            <span key={room} className="proof-room-label" data-proof-id={`room:${room}`}>
              {roomNames[room]}
              {allWorkers.filter((worker) => worker.room === room && worker.overflow).length > 0
                ? ` +${allWorkers.filter((worker) => worker.room === room && worker.overflow).length}`
                : ""}
            </span>
          ))}
        {workers.map((worker) => (
          <button
            type="button"
            key={worker.task.id}
            data-proof-id={worker.task.id}
            data-behavior={worker.behavior}
            data-moving={worker.moving}
            data-compact={compact.has(worker.task.id)}
            className={`world-label task tone-${worker.tone} ${worker.task.id === input.selectedId ? "selected" : ""}`}
            aria-label={`${worker.title} · ${worker.detail}${worker.task.attention?.reason ? ` · ${splitRecordedDetail(worker.task.attention.reason).headline}` : ""}`}
            title={compact.has(worker.task.id) ? `${worker.title} · ${worker.detail}` : undefined}
            onClick={() => onSelect("task", worker.task.id)}
          >
            {worker.tone === "answer" ? (
              <Question size={18} />
            ) : ["repair", "failed", "blocked"].includes(worker.tone) ? (
              <WarningCircle size={18} />
            ) : (
              <span className="proof-status-dot" />
            )}
            {!compact.has(worker.task.id) && (
              <span>
                <strong>{worker.title}</strong>
                <small>{worker.detail}</small>
              </span>
            )}
          </button>
        ))}
      </nav>
      {appearanceOpen && project && (
        <BaseAppearancePicker
          bases={bases}
          projectId={appearanceProjectId ?? project.id}
          manifest={manifest}
          storageProblem={storageProblem}
          onClose={() => setAppearanceOpen(false)}
          onProject={(id) => {
            setAppearanceProjectId(id);
            setFocusId(id);
            onExterior();
            onSelect("project", id);
          }}
          onChoose={(base, appearance) => choose(base.project, appearance)}
        />
      )}
      {minimap && ready && (
        <aside className="minimap panel proof-minimap" aria-label="Project bases map">
          <button
            className="minimap-image"
            type="button"
            aria-label="Frame all project bases"
            onClick={frameWorld}
          >
            <img src={minimap} alt="Current project bases across the coast" />
          </button>
        </aside>
      )}
    </>
  );
}
