import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { Group, Mesh, type MeshStandardMaterial, type Object3D } from "three";
import type { Point3 } from "./colony";
import { driveFixture } from "./interior";
import type { SceneLight } from "./ProofBase";
import { propPlacements } from "./prop-placement";

/**
 * The scanned hero props standing in the HQ rooms.
 *
 * `hq-shell.glb` ships an empty `MF_Props` root -- the plan always reserved these pieces, and the
 * greybox stood in for them. They arrive as their own kit rather than inside the shell because the
 * shell's producer receipt is hash-bound, so re-exporting it to carry three props would break the
 * guard that catches the shell drifting from the contract that produced it.
 *
 * Nothing here reads task or run state. A prop is fixture, never status, and no prop brightens
 * because work is happening on it.
 *
 * The emissive parts are named into the colony's material conventions, but a shared name is not a
 * shared material: this is a different GLB from the shell, so `ProofBase` never saw these and the
 * props held one brightness at noon and at midnight. They are cloned and driven here through the
 * same `driveFixture` the shell's interior runs on. A base owns its clones the way it owns the
 * shell's, which is more materials than the colony strictly needs -- props are identical furniture
 * in every base and, being interior, never take the project palette -- but it keeps disposal tied to
 * the base that made them rather than to whichever one happens to unmount last.
 */
export function ColonyProps({
  model,
  origin,
  light,
}: {
  model: Object3D;
  origin: Point3;
  light: React.RefObject<SceneLight>;
}) {
  const built = useMemo(() => {
    const root = new Group();
    root.name = "MF_PropsGroup";
    const materials = new Map<string, MeshStandardMaterial>();
    for (const placement of propPlacements) {
      const source = model.getObjectByName(placement.node);
      if (!source) continue;
      // Clone per placement, not per node: the wall row is one console standing in twenty places,
      // and moving a single clone twenty times would leave nineteen of them nowhere. The clones
      // share the kit's geometry and material by reference, so this is transforms, not meshes --
      // and the `own()` map below still sees one source material per node and clones it once.
      const prop = source.clone(true);
      prop.position.set(...placement.position);
      // Same convention as a room socket: a compass bearing, turned into a yaw about +Y.
      prop.rotation.y = ((90 - placement.facingDeg) * Math.PI) / 180;
      prop.traverse((child) => {
        if (!(child instanceof Mesh)) return;
        child.castShadow = true;
        child.receiveShadow = true;
        const own = (material: MeshStandardMaterial) => {
          const existing = materials.get(material.uuid);
          if (existing) return existing;
          const owned = material.clone();
          // A coloured practical driven hard is the one thing ACES flattens to white.
          if (owned.name.startsWith("practical_")) owned.toneMapped = false;
          materials.set(material.uuid, owned);
          return owned;
        };
        child.material = Array.isArray(child.material) ? child.material.map(own) : own(child.material);
      });
      root.add(prop);
    }
    return { root, materials: [...materials.values()] };
  }, [model]);
  useEffect(
    () => () => {
      // Only the materials belong to this base. The geometry under every clone is the kit's own,
      // shared by reference across all of them and across every other base, so disposing it here
      // would blank the props in each base that is still on screen.
      for (const material of built.materials) material.dispose();
    },
    [built],
  );
  useFrame(() => {
    const { lamps: dark, time } = light.current;
    let index = 0;
    for (const material of built.materials)
      driveFixture(material, dark, 1 + Math.sin(time * 0.65 + index++ * 1.7) * 0.075);
  });
  return <primitive object={built.root} position={origin} />;
}
