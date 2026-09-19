import { useEffect, useMemo } from "react";
import { Group, Mesh, MeshStandardMaterial, type Object3D } from "three";
import type { Point3 } from "./colony";
import { propPlacements } from "./prop-placement";

/**
 * The three scanned hero props standing in the HQ rooms.
 *
 * `hq-shell.glb` ships an empty `MF_Props` root -- the plan always reserved these pieces, and the
 * greybox stood in for them. They arrive as their own kit rather than inside the shell because the
 * shell's producer receipt is hash-bound, so re-exporting it to carry three props would break the
 * guard that catches the shell drifting from the contract that produced it.
 *
 * Nothing here reads task or run state. A prop is fixture, never status: the emissive parts are
 * named into the colony's material conventions so `ProofBase` drives them with the same ambient
 * dusk response as the rest of the interior, and no prop brightens because work is happening on it.
 */
export function ColonyProps({ model, origin }: { model: Object3D; origin: Point3 }) {
  const built = useMemo(() => {
    const root = new Group();
    root.name = "MF_PropsGroup";
    const source = model.clone(true);
    for (const placement of propPlacements) {
      const prop = source.getObjectByName(placement.node);
      if (!prop) continue;
      prop.position.set(...placement.position);
      // Same convention as a room socket: a compass bearing, turned into a yaw about +Y.
      prop.rotation.y = ((90 - placement.facingDeg) * Math.PI) / 180;
      prop.traverse((child) => {
        if (!(child instanceof Mesh)) return;
        child.castShadow = true;
        child.receiveShadow = true;
        for (const material of Array.isArray(child.material) ? child.material : [child.material])
          if (material instanceof MeshStandardMaterial && material.name.startsWith("practical_"))
            material.toneMapped = false;
      });
      root.add(prop);
    }
    return root;
  }, [model]);
  useEffect(
    () => () => {
      built.traverse((object) => {
        if (object instanceof Mesh) object.geometry.dispose();
      });
    },
    [built],
  );
  return <primitive object={built} position={origin} />;
}
