import { useEffect, useMemo } from "react";
import { Group, InstancedMesh, Matrix4, Mesh, type Object3D, Quaternion, Vector3 } from "three";
import type { Point3 } from "./colony";
import type { ScatterPlacement } from "./scatter";

export interface ParcelScatterPlan {
  /** World position of the parcel origin. */
  origin: Point3;
  /** Parcel-local ground height under a piece. */
  groundAt(x: number, z: number): number;
  placements: ScatterPlacement[];
}
/**
 * Instanced scatter: every kit item mesh becomes one InstancedMesh carrying that item's instances
 * across all parcels, so ten planted islands cost a dozen draw calls. Each piece stands on the height
 * the plan reports for its point, which is the same analytic field the terrain mesh was built from.
 */
export function buildScatter(kit: Object3D, plans: ParcelScatterPlan[]) {
  const root = new Group();
  root.name = "MF_Scatter";
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
        // Boulders sit into the ground a little so they never hover on a slope.
        const sink = placement.kind === "boulder" ? 0.25 * placement.scale : 0;
        const y = plan.groundAt(placement.x, placement.z) - sink;
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
