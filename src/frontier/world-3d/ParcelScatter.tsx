import { useEffect, useMemo } from "react";
import {
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  Quaternion,
  Vector3,
} from "three";
import type { Point3 } from "./colony";
import type { ScatterPlacement } from "./scatter";
import { seaLevel } from "./terrain-field";

export interface ParcelScatterPlan {
  /** World position of the parcel origin. */
  origin: Point3;
  /** Parcel-local ground height under a piece. */
  groundAt(x: number, z: number): number;
  placements: ScatterPlacement[];
}
/** How far a piece sits into the ground, and where its anchor is, by kind. */
function restingHeight(placement: ScatterPlacement, ground: number) {
  switch (placement.kind) {
    case "cliff":
      // Top-anchored: hung from under the lip, leaning outward, so the body overhangs the face and
      // the inner half of its top breaks the ground as bare rock.
      return ground - 0.9;
    case "rock":
      return ground - 0.35 * placement.scale;
    case "boulder":
      return ground - 0.25 * placement.scale;
    case "shore":
      // In the toe water: never below the surface by more than half its height, never floating.
      return Math.max(ground, seaLevel - 0.45 * placement.scale) - 0.15;
    case "crystal":
      return ground - 0.12;
    default:
      return ground;
  }
}
const receivesShadow = new Set(["rock", "boulder", "shore", "cliff", "vehicle", "crystal"]);
const castsShadow = new Set([
  "tree",
  "scrub",
  "rock",
  "boulder",
  "shore",
  "cliff",
  "crystal",
  "lantern",
  "vehicle",
]);

/**
 * Kit rock materials darken and go glossy near the water line, like the terrain's splash zone, so
 * cliff pieces and shoreline rocks read as one wet band with the land.
 */
const patched = new WeakSet<MeshStandardMaterial>();
function wetRock(material: MeshStandardMaterial) {
  if (patched.has(material)) return;
  patched.add(material);
  material.customProgramCacheKey = () => "colony_rock_wet";
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\n varying vec3 vRockWorld;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vRockWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
          vRockWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n varying vec3 vRockWorld;")
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        float wetRock = 1.0 - smoothstep(0.1, 1.6, vRockWorld.y);
        diffuseColor.rgb *= mix(1.0, 0.42, wetRock);`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.35, 1.0 - smoothstep(0.1, 1.6, vRockWorld.y));`,
      );
  };
  material.needsUpdate = true;
}

/** Crystal shards: a saturated violet body with a restrained glow that bloom lifts at dusk. */
function tuneCrystal(material: MeshStandardMaterial) {
  material.color.setRGB(0.4, 0.22, 0.8);
  material.emissive.setRGB(0.5, 0.26, 1.0);
  material.emissiveIntensity = 0.55;
  material.roughness = 0.22;
  material.metalness = 0.05;
}

/**
 * Instanced scatter: every kit item mesh becomes one InstancedMesh carrying that item's instances
 * across all parcels, so ten planted islands cost a few dozen draw calls. Each piece stands on the
 * height the plan reports for its point, which is the same analytic field the terrain was built from.
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
  const lean = new Quaternion();
  const scale = new Vector3();
  const up = new Vector3(0, 1, 0);
  const side = new Vector3(1, 0, 0);
  const meshes: InstancedMesh[] = [];
  for (const [item, entries] of byItem) {
    const source = kit.getObjectByName(item);
    if (!source) continue;
    source.updateMatrixWorld(true);
    const parts: Mesh[] = [];
    source.traverse((object) => {
      if (object instanceof Mesh) parts.push(object);
    });
    const kind = entries[0]?.placement.kind ?? "tree";
    for (const part of parts) {
      // Bake the part's offset inside its kit item into every instance matrix.
      const local = new Matrix4().copy(source.matrixWorld).invert().multiply(part.matrixWorld);
      const instanced = new InstancedMesh(part.geometry, part.material, entries.length);
      instanced.name = `${item}:${part.name}`;
      instanced.castShadow = castsShadow.has(kind);
      instanced.receiveShadow = receivesShadow.has(kind);
      for (const material of Array.isArray(part.material) ? part.material : [part.material]) {
        if (material instanceof MeshStandardMaterial && material.name.startsWith("rock_")) wetRock(material);
        if (material instanceof MeshStandardMaterial && material.name === "crystal_glow")
          tuneCrystal(material);
      }
      entries.forEach(({ plan, placement }, index) => {
        const y = restingHeight(placement, plan.groundAt(placement.x, placement.z));
        position.set(plan.origin[0] + placement.x, plan.origin[1] + y, plan.origin[2] + placement.z);
        quaternion.setFromAxisAngle(up, placement.rotation);
        if (placement.tilt) quaternion.multiply(lean.setFromAxisAngle(side, placement.tilt));
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
