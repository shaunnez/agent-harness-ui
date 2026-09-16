import { useEffect, useMemo } from "react";
import { Group, InstancedMesh, Matrix4, Mesh, type Object3D, Quaternion, Raycaster, Vector3 } from "three";
import type { Point3 } from "./colony";
import type { ScatterPlacement } from "./scatter";

export interface ParcelScatterPlan {
  /** World position of the parcel origin. */
  origin: Point3;
  /** Terrain object the pieces stand on (the shared parcel or hub source, untranslated). */
  terrain: Object3D;
  placements: ScatterPlacement[];
}
/**
 * Instanced scatter: every kit item mesh becomes one InstancedMesh carrying that item's instances
 * across all parcels, so ten planted islands cost a dozen draw calls. Each piece is dropped onto the
 * terrain by a downward ray against the shared parcel mesh in parcel-local space, which is identical
 * for every parcel, so the heights are cached per placement point.
 */
export function buildScatter(kit: Object3D, plans: ParcelScatterPlan[]) {
  const root = new Group();
  root.name = "MF_Scatter";
  const ray = new Raycaster();
  const down = new Vector3(0, -1, 0);
  const heights = new Map<Object3D, Map<string, number>>();
  const groundAt = (terrain: Object3D, x: number, z: number) => {
    let cache = heights.get(terrain);
    if (!cache) {
      terrain.updateMatrixWorld(true);
      cache = new Map();
      heights.set(terrain, cache);
    }
    const key = `${x.toFixed(2)},${z.toFixed(2)}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    ray.set(new Vector3(x, 60, z), down);
    ray.far = 120;
    const hit = ray.intersectObject(terrain, true).find((entry) => entry.point.y > -2.5);
    const y = hit ? hit.point.y : 4;
    cache.set(key, y);
    return y;
  };
  const byItem = new Map<string, { plan: ParcelScatterPlan; placement: ScatterPlacement }[]>();
  for (const plan of plans)
    for (const placement of plan.placements)
      byItem.set(placement.item, [...(byItem.get(placement.item) ?? []), { plan, placement }]);
  const matrix = new Matrix4();
  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  const up = new Vector3(0, 1, 0);
  const meshes: InstancedMesh[] = [];
  for (const [item, entries] of byItem) {
    const source = kit.getObjectByName(item);
    if (!source) continue;
    source.updateMatrixWorld(true);
    const parts: Mesh[] = [];
    source.traverse((object) => {
      if (object instanceof Mesh) parts.push(object);
    });
    for (const part of parts) {
      // Bake the part's offset inside its kit item into every instance matrix.
      const local = new Matrix4().copy(source.matrixWorld).invert().multiply(part.matrixWorld);
      const instanced = new InstancedMesh(part.geometry, part.material, entries.length);
      instanced.name = `${item}:${part.name}`;
      instanced.castShadow = true;
      instanced.receiveShadow = item.startsWith("MF_Boulder") || item.startsWith("MF_Vehicle");
      entries.forEach(({ plan, placement }, index) => {
        const y = groundAt(plan.terrain, placement.x, placement.z);
        position.set(plan.origin[0] + placement.x, plan.origin[1] + y, plan.origin[2] + placement.z);
        quaternion.setFromAxisAngle(up, placement.rotation);
        scale.setScalar(placement.scale);
        matrix.compose(position, quaternion, scale).multiply(local);
        instanced.setMatrixAt(index, matrix);
      });
      instanced.instanceMatrix.needsUpdate = true;
      instanced.frustumCulled = false;
      root.add(instanced);
      meshes.push(instanced);
    }
  }
  return {
    root,
    dispose() {
      for (const mesh of meshes) mesh.dispose();
    },
  };
}

export function ParcelScatter({ kit, plans }: { kit: Object3D; plans: ParcelScatterPlan[] }) {
  const key = plans
    .map((plan) => `${plan.origin.join()}:${plan.placements.length}:${plan.placements[0]?.x ?? 0}`)
    .join("|");
  // biome-ignore lint/correctness/useExhaustiveDependencies: Scatter depends on the parcel set and the kit, not on identity.
  const built = useMemo(() => buildScatter(kit, plans), [kit, key]);
  useEffect(() => () => built.dispose(), [built]);
  return <primitive object={built.root} />;
}
