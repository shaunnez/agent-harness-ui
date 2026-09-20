import { cutawayGroups } from "./cutaway";
import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo } from "react";
import { Color, Mesh, type MeshStandardMaterial, type Object3D } from "three";
import { basePalettes } from "./appearance";
import type { ProjectBase } from "./layout";

/**
 * How far each exterior practical carries the project palette after dark. Windows stay mostly warm
 * so a base still reads as lived in; the markers are identity signals, so they go furthest. Interior
 * practicals are excluded entirely -- the rooms keep their authored warm light whatever the palette.
 */
const palettePractical: Record<string, number> = {
  practical_warm_window_glass: 0.85,
  practical_warm_strip: 1,
  practical_station_marker: 1,
  practical_delivery_beacon: 1,
};

export interface SceneLight {
  lamps: number;
  time: number;
  /** Sea tint of the hour (hex), shared by the sea and the fresh water. */
  sea?: number;
}
export function ProofBase({
  base,
  source,
  environment,
  cutaway,
  light,
  roots,
  onSelect,
}: {
  base: ProjectBase;
  source: Object3D;
  /** Legacy archipelago only: the island tile under this base. Contract 2.0 land is the shared field. */
  environment?: Object3D;
  cutaway: boolean;
  light: React.RefObject<SceneLight>;
  roots: Map<string, Object3D>;
  onSelect(): void;
}) {
  const models = useMemo(() => {
    // Keyed by (material, interior) rather than by material alone: `practical_warm_strip` lights both
    // a room and a wall outside, and one shared clone would drag the interiors to the palette too.
    const materials = new Map<string, MeshStandardMaterial>();
    const clone = (original: Object3D) => {
      const result = original.clone(true);
      result.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        object.castShadow = object.receiveShadow = true;
        let interior = false;
        for (let node: Object3D | null = object; node; node = node.parent)
          if (node.name.startsWith("MF_Interior")) {
            interior = true;
            break;
          }
        const prepare = (material: MeshStandardMaterial) => {
          const key = `${material.uuid}|${interior ? "in" : "out"}`;
          const existing = materials.get(key);
          if (existing) return existing;
          const owned = material.clone();
          owned.userData.interior = interior;
          owned.userData.warm = owned.emissive.clone();
          // The authored albedo matters as much as the emissive here: practical_warm_strip is
          // [1, 0.49, 0.14] on both, so tinting only the emissive left a warm orange surface lit by
          // warm lamps, and every base's strips read the same pale amber whatever the palette.
          owned.userData.albedo = owned.color.clone();
          materials.set(key, owned);
          return owned;
        };
        object.material = Array.isArray(object.material)
          ? object.material.map(prepare)
          : prepare(object.material);
      });
      return result;
    };
    return { base: clone(source), environment: environment ? clone(environment) : null, materials };
  }, [source, environment]);
  useLayoutEffect(() => {
    roots.set(base.project.id, models.base);
    for (const group of cutawayGroups(models.base)) group.visible = !cutaway;
    return () => {
      roots.delete(base.project.id);
    };
  }, [models, roots, base.project.id, cutaway]);
  const palette = useMemo(
    () => new Color(basePalettes[base.appearance.palette].color),
    [base.appearance.palette],
  );
  /** What the base emits: deep enough to keep its hue once multiplied by the emissive intensity. */
  const paletteLight = useMemo(
    () => new Color(basePalettes[base.appearance.palette].light),
    [base.appearance.palette],
  );
  useLayoutEffect(() => {
    for (const material of models.materials.values()) {
      if (material.name.startsWith("identity_")) {
        material.color.copy(palette);
        material.emissive.copy(paletteLight);
      }
    }
  }, [models, palette, paletteLight]);
  useEffect(
    () => () => {
      for (const material of models.materials.values()) material.dispose();
    },
    [models],
  );
  useFrame(() => {
    const { lamps: dark, time } = light.current;
    let index = 0;
    for (const material of models.materials.values()) {
      // These are ambient station instruments, never task-progress signals.
      const pulse = 1 + Math.sin(time * 0.65 + index++ * 1.7) * 0.075;
      if (material.name.startsWith("identity_")) material.emissiveIntensity = (0.48 + dark * 0.65) * pulse;
      else if (material.name.startsWith("ambient_")) material.emissiveIntensity = (0.75 + dark * 1.4) * pulse;
      else if (material.name.startsWith("practical_")) {
        // After dark the exterior practicals take the project palette, so a base is identifiable by
        // its own light at night. `dark` is 0 in daylight, so this is a no-op by day.
        const mix = material.userData.interior ? 0 : (palettePractical[material.name] ?? 0);
        // Intensity is pulled back in step with the mix. Emissive is multiplied channel by channel,
        // so a coloured light driven at the white lamps' gain clips to white and loses the hue that
        // is the whole point of it -- the more palette a lamp carries, the dimmer it has to run.
        material.emissiveIntensity = (0.38 + dark * 3.0) * (1 - 0.5 * mix * dark);
        if (mix > 0) material.emissive.copy(material.userData.warm as Color).lerp(paletteLight, dark * mix);
      }
    }
  });
  return (
    <group position={base.position}>
      {models.environment && <primitive object={models.environment} />}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Three ray picking mirrors the accessible project label. */}
      <primitive
        object={models.base}
        onClick={(event: { stopPropagation(): void }) => {
          event.stopPropagation();
          onSelect();
        }}
      />
    </group>
  );
}
