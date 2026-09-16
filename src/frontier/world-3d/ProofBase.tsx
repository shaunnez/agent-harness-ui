import { hiddenEdgeGroups } from "./colony";
import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo } from "react";
import { Mesh, type MeshStandardMaterial, type Object3D } from "three";
import { basePalettes } from "./appearance";
import type { ProjectBase } from "./layout";

export interface SceneLight {
  lamps: number;
  time: number;
}
export function ProofBase({
  base,
  occupiedSlots,
  source,
  environment,
  cutaway,
  light,
  roots,
  onSelect,
}: {
  base: ProjectBase;
  occupiedSlots?: string[];
  source: Object3D;
  environment: Object3D;
  cutaway: boolean;
  light: React.RefObject<SceneLight>;
  roots: Map<string, Object3D>;
  onSelect(): void;
}) {
  const models = useMemo(() => {
    const materials = new Map<MeshStandardMaterial, MeshStandardMaterial>();
    const clone = (original: Object3D) => {
      const result = original.clone(true);
      result.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        object.castShadow = object.receiveShadow = true;
        const prepare = (material: MeshStandardMaterial) => {
          const existing = materials.get(material);
          if (existing) return existing;
          const owned = material.clone();
          materials.set(material, owned);
          return owned;
        };
        object.material = Array.isArray(object.material)
          ? object.material.map(prepare)
          : prepare(object.material);
      });
      return result;
    };
    return { base: clone(source), environment: clone(environment), materials };
  }, [source, environment]);
  useLayoutEffect(() => {
    roots.set(base.project.id, models.base);
    if (occupiedSlots) {
      const hidden = new Set(hiddenEdgeGroups(base.slot, occupiedSlots));
      models.environment.traverse((object) => {
        if (object.name.startsWith("MF_Road_Spur_") || object.name.startsWith("MF_Pad_"))
          object.visible = !hidden.has(object.name);
      });
    }
    for (const name of ["MF_Roof", "MF_ShellCutaway"]) {
      const group = models.base.getObjectByName(name);
      if (group) group.visible = !cutaway;
    }
    return () => {
      roots.delete(base.project.id);
    };
  }, [models, roots, base.project.id, base.slot, occupiedSlots, cutaway]);
  useLayoutEffect(() => {
    const tint = basePalettes[base.appearance.palette].color;
    for (const material of models.materials.values()) {
      if (material.name.startsWith("identity_")) {
        material.color.set(tint);
        material.emissive.set(tint);
      }
    }
  }, [models, base.appearance.palette]);
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
      else if (material.name.startsWith("practical_")) material.emissiveIntensity = 0.38 + dark * 3.0;
    }
  });
  return (
    <group position={base.position}>
      <primitive object={models.environment} />
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
