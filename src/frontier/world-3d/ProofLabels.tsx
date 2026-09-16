import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { type Intersection, Matrix4, type Object3D, Raycaster, Vector2, Vector3 } from "three";
import { baseLabelAnchor } from "./colony";
import { separateLabels } from "./labels";
import { type ProjectBase, translated } from "./layout";
import { type ProofManifest, proofWorkerHeight } from "./model";
import { profiling, recordLabelTime } from "./PerformanceProbe";
import { isOccluded, visibleOccluders } from "./occlusion";

export function ProofLabels({
  labels,
  bases,
  actors,
  roots,
  manifest,
  sceneKey,
}: {
  labels: React.RefObject<HTMLElement | null>;
  bases: ProjectBase[];
  actors: Map<string, Object3D>;
  roots: Map<string, Object3D>;
  manifest: ProofManifest;
  sceneKey: string;
}) {
  const { camera, size } = useThree();
  const ray = useMemo(() => new Raycaster(), []);
  const world = useMemo(() => new Vector3(), []);
  const projected = useMemo(() => new Vector3(), []);
  const screen = useMemo(() => new Vector2(), []);
  const hits = useMemo<Intersection[]>(() => [], []);
  const visibility = useRef(
    new Map<string, { time: number; obscured: boolean; view: number; point: Vector3 }>(),
  );
  const view = useMemo(() => new Matrix4(), []);
  const previous = useRef({ matrix: new Matrix4(), version: 0, sceneKey });
  useFrame(() => {
    const start = profiling ? performance.now() : 0;
    const now = performance.now();
    view.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    if (!view.equals(previous.current.matrix)) {
      previous.current.matrix.copy(view);
      previous.current.version++;
    }
    if (previous.current.sceneKey !== sceneKey) {
      previous.current.sceneKey = sceneKey;
      visibility.current.clear();
    }
    let occluders: ReturnType<typeof visibleOccluders> | undefined;
    const present = new Set<string>();
    const elements = new Map<string, HTMLElement>();
    const boxes: Array<{ id: string; x: number; y: number; width: number; height: number }> = [];
    for (const label of labels.current?.querySelectorAll<HTMLElement>("[data-proof-id]") ?? []) {
      const id = label.dataset.proofId;
      if (!id) continue;
      present.add(id);
      const isBase = id.startsWith("base:");
      if (isBase) {
        const base = bases.find((entry) => `base:${entry.project.id}` === id);
        if (!base) {
          label.hidden = true;
          continue;
        }
        world.set(...translated(baseLabelAnchor, base.position));
      } else {
        const actor = actors.get(id);
        if (!actor) {
          label.hidden = true;
          continue;
        }
        actor.getWorldPosition(world);
        world.y += proofWorkerHeight + 1.1;
      }
      projected.copy(world).project(camera);
      const x = (projected.x * 0.5 + 0.5) * size.width;
      const y = (-projected.y * 0.5 + 0.5) * size.height;
      label.hidden =
        x < 10 || x > size.width - 10 || y < 100 || y > size.height - 65 || Math.abs(projected.z) > 1;
      if (label.hidden) continue;
      let obscured = false;
      if (!isBase) {
        const cached = visibility.current.get(id);
        if (
          cached &&
          ((cached.view === previous.current.version && cached.point.distanceToSquared(world) < 0.000001) ||
            now - cached.time < 100)
        )
          obscured = cached.obscured;
        else {
          ray.setFromCamera(screen.set(projected.x, projected.y), camera);
          occluders ??= visibleOccluders(roots.values());
          obscured = isOccluded(ray, occluders, ray.ray.origin.distanceTo(world), hits);
          visibility.current.set(id, {
            time: now,
            obscured,
            view: previous.current.version,
            point: world.clone(),
          });
        }
      }
      label.dataset.occluded = String(obscured);
      if (!label.hidden && !obscured) {
        elements.set(id, label);
        boxes.push({ id, x, y, width: label.offsetWidth, height: label.offsetHeight });
      }
    }
    for (const box of separateLabels(boxes)) {
      const label = elements.get(box.id);
      if (!label) continue;
      label.style.transform = `translate(${box.x}px, ${box.bottom}px) translate(-50%, -100%)`;
      label.style.setProperty("--proof-leader", `${box.y - box.bottom}px`);
    }
    for (const id of visibility.current.keys()) if (!present.has(id)) visibility.current.delete(id);
    recordLabelTime(start);
  });
  return null;
}
