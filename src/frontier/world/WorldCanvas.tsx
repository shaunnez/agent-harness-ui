import { ArrowsOut, Crosshair, MapPin, Minus, Plus, Question, WarningCircle } from "@phosphor-icons/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { WorldPreferences } from "../app/preferences";
import { WorldTime } from "../views/WorldTime";
import { type Camera, pointInContainedImage, worldToScreen } from "./camera";
import { lightingAt, worldHour } from "./environment-model";
import { WorldRenderer } from "./renderer";
import type { SceneInput, WorldLabel } from "./scene";

interface Props {
  input: SceneInput;
  preferences: WorldPreferences;
  onSelect(kind: "project" | "task", id: string): void;
  onEnterProject(id: string): void;
  onArtifact(taskId: string, artifactId: string): void;
  rendererRef: React.RefObject<WorldRenderer | null>;
  onWorldSettings(): void;
}
export function WorldCanvas({
  input,
  preferences,
  onSelect,
  onEnterProject,
  onArtifact,
  rendererRef,
  onWorldSettings,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const labelHost = useRef<HTMLElement>(null);
  const latest = useRef({ onSelect, onEnterProject, onArtifact, input });
  latest.current = { onSelect, onEnterProject, onArtifact, input };
  const cameraRef = useRef<Camera>({ x: 0, y: 0, zoom: 1 });
  const [labels, setLabels] = useState<WorldLabel[]>([]);
  const [minimap, setMinimap] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [lighting, setLighting] = useState(() => lightingAt(worldHour(preferences.environment, Date.now())));
  const moveLabels = useCallback((camera: Camera) => {
    cameraRef.current = camera;
    for (const element of labelHost.current?.querySelectorAll<HTMLElement>("[data-world-x]") ?? []) {
      const point = worldToScreen(
        { x: Number(element.dataset.worldX), y: Number(element.dataset.worldY) },
        camera,
      );
      element.style.transform = `translate(${point.x}px, ${point.y}px) translate(-50%, -100%)`;
      element.classList.toggle(
        "compact-label",
        latest.current.input.location.view === "project" && camera.zoom < 0.9,
      );
      element.hidden =
        (element.dataset.labelKind === "task" &&
          latest.current.input.location.view === "world" &&
          camera.zoom < 0.55) ||
        point.x < -100 ||
        point.x > window.innerWidth + 100 ||
        point.y < 30 ||
        point.y > window.innerHeight - 70;
    }
  }, []);
  useEffect(() => {
    if (!host.current) return;
    host.current.dataset.rendererRevision = String(retry);
    let disposed = false;
    const renderer = new WorldRenderer(host.current, {
      select: (kind, id, artifactId) => {
        if (kind === "artifact" && artifactId) latest.current.onArtifact(id, artifactId);
        else if (kind !== "artifact") latest.current.onSelect(kind, id);
      },
      labels: setLabels,
      camera: moveLabels,
      minimap: setMinimap,
      problem: setError,
      lighting: setLighting,
    });
    rendererRef.current = renderer;
    setError(null);
    renderer.update(latest.current.input);
    renderer.initialize().catch((error: unknown) => {
      if (!disposed) setError(error instanceof Error ? error.message : "The world could not start.");
    });
    return () => {
      disposed = true;
      renderer.destroy();
      rendererRef.current = null;
    };
  }, [rendererRef, retry, moveLabels]);
  useEffect(() => {
    rendererRef.current?.update(input);
  }, [input, rendererRef]);
  useLayoutEffect(() => {
    if (labels.length) moveLabels(cameraRef.current);
  }, [labels, moveLabels]);
  return (
    <>
      <div ref={host} className="world-canvas" />
      <WorldTime
        lighting={lighting}
        preferences={preferences}
        moving={input.motion && input.connected}
        onSettings={onWorldSettings}
      />
      <nav
        ref={labelHost}
        className={`world-labels label-size-${preferences.labelSize}`}
        aria-label="World selection"
        hidden={!preferences.labels}
      >
        {labels.map((label) => (
          <button
            type="button"
            key={label.id}
            className={`world-label ${label.kind} tone-${label.attention} ${label.taskId === input.selectedId ? "selected" : ""}`}
            data-world-x={label.x}
            data-world-y={label.y}
            data-label-kind={label.kind}
            onClick={() => onSelect(label.kind, label.taskId ?? label.projectId)}
            onDoubleClick={() => label.kind === "project" && onEnterProject(label.projectId)}
          >
            {label.kind === "project" ? (
              <MapPin size={22} weight="duotone" />
            ) : label.attention === "answer" ? (
              <Question size={20} />
            ) : ["failed", "blocked", "repair"].includes(label.attention) ? (
              <WarningCircle size={20} />
            ) : (
              <Crosshair size={18} />
            )}
            <span>
              <strong>{label.title}</strong>
              <small>{label.detail}</small>
              {label.reason && (
                <small className="label-reason" title={label.reason}>
                  {label.reason}
                </small>
              )}
            </span>
          </button>
        ))}
      </nav>
      {error && (
        <div className="world-error panel" role="alert">
          <h2>World unavailable</h2>
          <p>{error}</p>
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            Retry artwork
          </button>
        </div>
      )}
      <aside className="minimap panel" aria-label="Minimap and camera controls">
        <button
          type="button"
          className="minimap-image"
          aria-label="Move camera using minimap"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const image = event.currentTarget.querySelector("img");
            const point =
              event.detail === 0
                ? { x: 0.5, y: 0.5 }
                : image?.naturalWidth
                  ? pointInContainedImage(
                      { x: event.clientX - rect.left, y: event.clientY - rect.top },
                      rect,
                      { width: image.naturalWidth, height: image.naturalHeight },
                    )
                  : null;
            if (point) rendererRef.current?.minimapClick(point.x, point.y);
          }}
        >
          {minimap && <img src={minimap} alt="Current world map" />}
        </button>
        <div className="camera-controls">
          <button
            type="button"
            aria-label="Fit world"
            title="Fit world"
            onClick={() => rendererRef.current?.reset()}
          >
            <ArrowsOut size={19} />
          </button>
          <button
            type="button"
            aria-label="Follow selected task"
            title="Follow selected task"
            onClick={() => input.selectedId && rendererRef.current?.follow(input.selectedId)}
          >
            <Crosshair size={19} />
          </button>
          <button type="button" aria-label="Zoom out" onClick={() => rendererRef.current?.zoom(0.8)}>
            <Minus size={19} />
          </button>
          <button type="button" aria-label="Zoom in" onClick={() => rendererRef.current?.zoom(1.25)}>
            <Plus size={19} />
          </button>
        </div>
      </aside>
    </>
  );
}
