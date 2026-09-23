import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Color, Mesh, type MeshStandardMaterial, type Object3D } from "three";
import { basePalettes } from "./appearance";
import { cutawayGroups, setCutawayVisible } from "./cutaway";
import {
  driveFixture,
  driveRoomInlay,
  lendFloorSurface,
  patchScreens,
  planarFloorUVs,
  tintRoomInlay,
} from "./interior";
import type { ProjectBase } from "./layout";
import { roomIds } from "./rooms";

/**
 * How far each exterior practical carries the project palette after dark.
 *
 * All the way, for all of them. Holding the windows back at 0.85 left 15% of their authored amber in
 * the mix, and because the pull-back on intensity scales with this number it also ran them brighter
 * than the strips beside them -- so the wide window bands read pale pink while the thin wall strips
 * on the same building read saturated. Two values here means two colours on one base.
 *
 * Interior practicals are excluded entirely: the rooms keep their authored warm light whatever the
 * project colour, which is what stops the cutaway going monochrome.
 */
const palettePractical: Record<string, number> = {
  practical_warm_window_glass: 1,
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
        // Shared geometry, so this runs once for the whole colony however many bases there are.
        if (object.name.includes("__room_inlay_")) planarFloorUVs(object.geometry);
      });
      return result;
    };
    return { base: clone(source), environment: environment ? clone(environment) : null, materials };
  }, [source, environment]);
  useLayoutEffect(() => {
    roots.set(base.project.id, models.base);
    for (const group of cutawayGroups(models.base)) setCutawayVisible(group, !cutaway);
    return () => {
      roots.delete(base.project.id);
    };
  }, [models, roots, base.project.id, cutaway]);
  /** One shared uniform object, so every screen in this base scrolls off the same clock. */
  const screenClock = useRef({ value: 0 }).current;
  const palette = useMemo(
    () => new Color(basePalettes[base.appearance.palette].color),
    [base.appearance.palette],
  );
  /** What the base emits: deep enough to keep its hue once multiplied by the emissive intensity. */
  const paletteLight = useMemo(
    () => new Color(basePalettes[base.appearance.palette].light),
    [base.appearance.palette],
  );
  /** Research colours run their identity glow brighter than the delivery set. */
  const glow = basePalettes[base.appearance.palette].glow;
  useLayoutEffect(() => {
    for (const material of models.materials.values()) {
      if (material.name.startsWith("identity_")) {
        material.color.copy(palette);
        material.emissive.copy(paletteLight);
      }
    }
  }, [models, palette, paletteLight]);
  /** Runs once per clone: room tones are fixed by the floor plan and never change with appearance. */
  useLayoutEffect(() => {
    const basalt = [...models.materials.values()].find((entry) => entry.name === "court_weathered_basalt");
    for (const material of models.materials.values()) {
      const room = roomIds.find((id) => material.name === `room_inlay_${id}`);
      if (room) {
        tintRoomInlay(material, room);
        if (basalt) lendFloorSurface(material, basalt);
      } else if (material.name === "ambient_screen_service") patchScreens(material, screenClock);
    }
  }, [models, screenClock]);
  useEffect(
    () => () => {
      for (const material of models.materials.values()) material.dispose();
    },
    [models],
  );
  useFrame(() => {
    const { lamps: dark, time } = light.current;
    screenClock.value = time;
    let index = 0;
    for (const material of models.materials.values()) {
      // These are ambient station instruments, never task-progress signals.
      const pulse = 1 + Math.sin(time * 0.65 + index++ * 1.7) * 0.075;
      const mix = material.userData.interior ? 0 : (palettePractical[material.name] ?? 0);
      if (material.name.startsWith("room_inlay_")) driveRoomInlay(material, dark);
      else if (material.name.startsWith("identity_"))
        material.emissiveIntensity = (0.48 + dark * 0.65) * pulse * glow;
      else if (mix > 0) {
        // After dark the exterior practicals take the project palette, so a base is identifiable by
        // its own light at night. `dark` is 0 in daylight, so this is a no-op by day.
        //
        // Intensity is pulled back in step with the mix. Emissive is multiplied channel by channel,
        // so a coloured light driven at the white lamps' gain clips to white and loses the hue that
        // is the whole point of it -- the more palette a lamp carries, the dimmer it has to run.
        material.emissiveIntensity = (0.38 + dark * 3.0) * (1 - 0.5 * mix * dark);
        material.emissive.copy(material.userData.warm as Color).lerp(paletteLight, dark * mix);
      }
      // Everything left is an interior fixture, and lights exactly as the props kit's does.
      else driveFixture(material, dark, pulse);
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
