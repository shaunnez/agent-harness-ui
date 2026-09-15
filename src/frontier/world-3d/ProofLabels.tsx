import { useFrame, useThree } from "@react-three/fiber";
import { useMemo } from "react";
import { type Object3D, Raycaster, Vector2, Vector3 } from "three";
import { separateLabels } from "./labels";
import { type ProjectBase, translated } from "./layout";
import { type ProofManifest, proofWorkerHeight } from "./model";

export function ProofLabels({
  labels,
  bases,
  actors,
  roots,
  manifest,
}: {
  labels: React.RefObject<HTMLElement | null>;
  bases: ProjectBase[];
  actors: Map<string, Object3D>;
  roots: Map<string, Object3D>;
  manifest: ProofManifest;
}) {
  const { camera, size } = useThree();
  const ray = useMemo(() => new Raycaster(), []);
  const world = useMemo(() => new Vector3(), []);
  const projected = useMemo(() => new Vector3(), []);
  useFrame(() => {
    const elements = new Map<string, HTMLElement>();
    const boxes: Array<{ id: string; x: number; y: number; width: number; height: number }> = [];
    for (const label of labels.current?.querySelectorAll<HTMLElement>("[data-proof-id]") ?? []) {
      const id = label.dataset.proofId;
      if (!id) continue;
      const isBase = id.startsWith("base:");
      if (isBase) {
        const base = bases.find((entry) => `base:${entry.project.id}` === id);
        if (!base) {
          label.hidden = true;
          continue;
        }
        world.set(...translated(manifest.sockets.base_label ?? [0, 16, -2], base.position));
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
      let obscured = false;
      if (!isBase) {
        ray.setFromCamera(new Vector2(projected.x, projected.y), camera);
        const hit = ray.intersectObjects([...roots.values()], true).find((entry) => {
          let object: Object3D | null = entry.object;
          while (object) {
            if (!object.visible) return false;
            object = object.parent;
          }
          return true;
        });
        obscured = Boolean(hit && hit.distance < ray.ray.origin.distanceTo(world) - 1.1);
      }
      label.dataset.occluded = String(obscured);
      label.hidden =
        x < 10 || x > size.width - 10 || y < 100 || y > size.height - 65 || Math.abs(projected.z) > 1;
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
  });
  return null;
}
