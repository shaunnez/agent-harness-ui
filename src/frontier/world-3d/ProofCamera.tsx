import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { type Object3D, OrthographicCamera, PCFShadowMap, Vector3 } from "three";
import { MapControls } from "three/addons/controls/MapControls.js";
import { captureScene } from "./capture";
import { minimapFrame } from "./colony";
import { cutawayGroups } from "./cutaway";
import { occupiedSlots, type ProjectBase, viewCamera } from "./layout";
import type { ProofControls, ProofInput } from "./model";

export function ProofCamera({
  input,
  bases,
  focusId,
  cutaway,
  roots,
  actors,
  controlsRef,
  onFocus,
  onReady,
  onProblem,
  onMinimap,
  captureRef,
  worldHour,
}: {
  input: ProofInput;
  bases: ProjectBase[];
  focusId: string | null;
  cutaway: boolean;
  roots: Map<string, Object3D>;
  actors: Map<string, Object3D>;
  controlsRef: React.RefObject<ProofControls | null>;
  captureRef: React.RefObject<(() => void) | null>;
  onFocus(id: string): void;
  onReady(): void;
  onProblem(message: string): void;
  onMinimap(image: string): void;
  worldHour(): number;
}) {
  const { camera, gl, size, scene } = useThree();
  const controls = useMemo(() => new MapControls(camera), [camera]);
  const latest = useRef({ bases, focusId, cutaway, onFocus, worldHour });
  latest.current = { bases, focusId, cutaway, onFocus, worldHour };
  const followed = useRef("");
  useFrame(() => {
    const key =
      input.location.view === "agent"
        ? `${input.location.taskId}:${input.location.runId}:${input.watchedStage}`
        : "";
    if (!key) {
      followed.current = "";
      return;
    }
    if (followed.current === key) return;
    const actor = actors.get(input.location.taskId ?? "");
    if (!actor) return;
    const delta = actor.getWorldPosition(new Vector3()).sub(controls.target);
    camera.position.add(delta);
    controls.target.add(delta);
    controls.update();
    followed.current = key;
  });
  const layoutKey = bases.map((base) => `${base.project.id}:${base.position.join()}`).join("|");
  // Palette/asset changes and runtime polling must preserve a user-moved camera.
  // biome-ignore lint/correctness/useExhaustiveDependencies: layoutKey captures only spatial layout, independently of appearance.
  useLayoutEffect(() => {
    const view = viewCamera(latest.current.bases, focusId, cutaway, size);
    camera.position.set(...view.position);
    controls.target.set(...view.target);
    if (camera instanceof OrthographicCamera) {
      camera.zoom =
        size.height / (view.verticalSpan * (size.height <= 800 && focusId && !cutaway ? 1.16 : 1));
      // The world fit already centres the colony in the HUD-safe box; focused views keep the
      // existing offsets that clear the Watch panel and the dock.
      camera.setViewOffset(
        size.width,
        size.height,
        view.viewOffset?.x ?? 65,
        view.viewOffset?.y ?? (size.height <= 800 ? (focusId && !cutaway ? 15 : -10) : 60),
        size.width,
        size.height,
      );
      camera.far = Math.max(850, camera.position.distanceTo(controls.target) + view.verticalSpan * 2);
      camera.updateProjectionMatrix();
    }
    controls.enableRotate = false;
    controls.screenSpacePanning = true;
    controls.enableDamping = false;
    controls.minZoom =
      size.height / (focusId ? view.verticalSpan * 1.4 : Math.max(200, view.verticalSpan * 1.4));
    controls.maxZoom = size.height / 25;
    controls.update();
    captureRef.current?.();
  }, [layoutKey, focusId, cutaway, camera, controls, size.width, size.height, captureRef]);
  useEffect(() => {
    controls.connect(gl.domElement);
    gl.shadowMap.type = PCFShadowMap;
    gl.toneMappingExposure = 1.12;
    onReady();
    return () => controls.dispose();
  }, [controls, gl, onReady]);
  useEffect(() => {
    controls.panSpeed = input.cameraSensitivity ?? 1;
    controls.zoomSpeed = input.cameraSensitivity ?? 1;
  }, [controls, input.cameraSensitivity]);
  useEffect(() => {
    const lost = (event: Event) => {
      event.preventDefault();
      onProblem("The 3D graphics connection was lost. Retry the scene or return to the existing world.");
    };
    gl.domElement.addEventListener("webglcontextlost", lost);
    return () => gl.domElement.removeEventListener("webglcontextlost", lost);
  }, [gl, onProblem]);
  useEffect(() => {
    let scheduled = 0;
    const capture = () => {
      cancelAnimationFrame(scheduled);
      scheduled = requestAnimationFrame(() => {
        // A focused base keeps its own map; the colony map is top-down on the colony centroid with
        // span 2 x (max occupied slot radius + 46 + 20) per the contract.
        const { focusId: focused } = latest.current;
        const fromView = Boolean(focused);
        const frame = fromView
          ? (() => {
              const view = viewCamera(latest.current.bases, focused, false);
              return { centre: [view.target[0], view.target[2]], halfSpan: view.verticalSpan * 0.8 };
            })()
          : minimapFrame(occupiedSlots(latest.current.bases));
        const half = frame.halfSpan;
        const mapCamera = new OrthographicCamera(-half, half, half, -half, 0.1, 900);
        mapCamera.position.set(frame.centre[0] ?? 0, 420, (frame.centre[1] ?? 0) + (fromView ? 85 : 0.01));
        mapCamera.lookAt(frame.centre[0] ?? 0, 0, frame.centre[1] ?? 0);
        const image = captureScene(gl, scene, mapCamera, 400, 400);
        if (image) onMinimap(image);
      });
    };
    captureRef.current = capture;
    controlsRef.current = {
      simulateContextLoss() {
        if (new URLSearchParams(window.location.search).get("qa") === "1") gl.forceContextLoss();
      },
      frame() {
        const { bases, focusId, cutaway } = latest.current;
        const view = viewCamera(bases, focusId, cutaway, {
          width: gl.domElement.clientWidth,
          height: gl.domElement.clientHeight,
        });
        camera.position.set(...view.position);
        controls.target.set(...view.target);
        if (camera instanceof OrthographicCamera) {
          camera.zoom =
            gl.domElement.clientHeight /
            (view.verticalSpan * (gl.domElement.clientHeight <= 800 && focusId && !cutaway ? 1.16 : 1));
          camera.updateProjectionMatrix();
        }
        controls.update();
      },
      focusProject(id) {
        latest.current.onFocus(id);
      },
      follow(id) {
        const object = actors.get(id);
        if (!object) return;
        const delta = object.getWorldPosition(new Vector3()).sub(controls.target);
        camera.position.add(delta);
        controls.target.add(delta);
        controls.update();
      },
      pan(x, y) {
        const scale = camera instanceof OrthographicCamera ? 1 / camera.zoom : 0.06;
        const delta = new Vector3(-x * scale, y * scale, 0).applyQuaternion(camera.quaternion);
        camera.position.add(delta);
        controls.target.add(delta);
        controls.update();
      },
      zoom(factor) {
        if (camera instanceof OrthographicCamera) {
          camera.zoom = Math.max(controls.minZoom, Math.min(controls.maxZoom, camera.zoom * factor));
          camera.updateProjectionMatrix();
        }
      },
      get worldHour() {
        return latest.current.worldHour();
      },
      async headquartersPreview(projectId) {
        const view = viewCamera(latest.current.bases, projectId, true);
        const half = view.verticalSpan / 2;
        const preview = new OrthographicCamera(-half * 1.8, half * 1.8, half, -half, 0.1, 650);
        preview.position.set(...view.position);
        preview.lookAt(...view.target);
        const groups = cutawayGroups(roots.get(projectId)).map((object) => ({
          object,
          visible: object.visible,
        }));
        try {
          for (const { object } of groups) object.visible = false;
          return captureScene(gl, scene, preview, 540, 300);
        } finally {
          for (const { object, visible } of groups) object.visible = visible;
        }
      },
    };
    capture();
    return () => {
      cancelAnimationFrame(scheduled);
      captureRef.current = null;
      controlsRef.current = null;
    };
  }, [actors, camera, captureRef, controls, controlsRef, gl, onMinimap, roots, scene]);
  return null;
}
