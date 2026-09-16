import { rooms, type RoomId } from "./rooms";
import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { type Intersection, Matrix4, type Object3D, Raycaster, Vector2, Vector3 } from "three";
import type { Point3 } from "./colony";
import { type ScreenRect, separateLabels } from "./labels";
import { type ProjectBase, translated } from "./layout";
import { type ProofView, workerHeight } from "./model";
import { profiling, recordLabelTime } from "./PerformanceProbe";
import { isOccluded, visibleOccluders } from "./occlusion";

export function ProofLabels({
  labels,
  bases,
  baseLabel,
  robotView,
  actors,
  roots,
  sceneKey,
  hudKey,
}: {
  labels: React.RefObject<HTMLElement | null>;
  bases: ProjectBase[];
  /** Base-local anchor of the project label: the contract's for the colony, the manifest socket otherwise. */
  baseLabel: Point3;
  /** Task cards sit above the robot's head, which grows with the view's robot scale. */
  robotView: ProofView;
  actors: Map<string, Object3D>;
  roots: Map<string, Object3D>;
  sceneKey: string;
  /** Changes when a HUD panel may have appeared or moved (selection, Watch), forcing an obstacle refresh. */
  hudKey: string;
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
  const obstacles = useRef<{ time: number; rects: ScreenRect[] }>({ time: -1000, rects: [] });
  const lastHud = useRef(hudKey);
  useFrame(() => {
    if (lastHud.current !== hudKey) {
      lastHud.current = hudKey;
      obstacles.current.time = -1000;
    }
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
    const boxes: Parameters<typeof separateLabels>[0] = [];
    for (const label of labels.current?.querySelectorAll<HTMLElement>("[data-proof-id]") ?? []) {
      const id = label.dataset.proofId;
      if (!id) continue;
      present.add(id);
      const isBase = id.startsWith("base:");
      const isRoom = id.startsWith("room:");
      if (isRoom) {
        const room = rooms[id.slice(5) as RoomId];
        const base = bases[0];
        if (!base || !room) {
          label.hidden = true;
          continue;
        }
        world.set(...translated(room.labelAnchor, base.position));
      } else if (isBase) {
        const base = bases.find((entry) => `base:${entry.project.id}` === id);
        if (!base) {
          label.hidden = true;
          continue;
        }
        world.set(...translated(baseLabel, base.position));
      } else {
        const actor = actors.get(id);
        if (!actor) {
          label.hidden = true;
          continue;
        }
        actor.getWorldPosition(world);
        world.y += workerHeight(robotView) + 1.1;
      }
      projected.copy(world).project(camera);
      const x = (projected.x * 0.5 + 0.5) * size.width;
      const y = (-projected.y * 0.5 + 0.5) * size.height;
      label.hidden =
        x < 10 || x > size.width - 10 || y < 100 || y > size.height - 65 || Math.abs(projected.z) > 1;
      if (label.hidden) continue;
      let obscured = false;
      if (!isBase && !isRoom) {
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
        boxes.push({ id, x, y, width: label.offsetWidth, height: label.offsetHeight, pinned: isRoom });
      }
    }
    // Cards stay inside the viewport and off the HUD (panels, decisions, dock, minimap and the world clock text).
    if (now - obstacles.current.time > 250) {
      obstacles.current = {
        time: now,
        rects: Array.from(
          document.querySelectorAll<HTMLElement>(".panel, .attention-stack, .world-clock"),
          (panel) => {
            const rect = panel.getBoundingClientRect();
            return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
          },
        ).filter((rect) => rect.width > 0 && rect.height > 0),
      };
    }
    const limits = { bounds: { top: 8, bottom: size.height - 8 }, obstacles: obstacles.current.rects };
    for (const box of separateLabels(boxes, limits)) {
      const label = elements.get(box.id);
      if (!label) continue;
      const below = box.bottom > box.y;
      label.style.transform = `translate(${box.x}px, ${box.bottom}px) translate(-50%, -100%)`;
      label.dataset.leader = below ? "up" : "down";
      label.style.setProperty(
        "--proof-leader",
        `${Math.max(0, below ? box.bottom - box.height - box.y : box.y - box.bottom)}px`,
      );
    }
    for (const id of visibility.current.keys()) if (!present.has(id)) visibility.current.delete(id);
    recordLabelTime(start);
  });
  return null;
}
