import { useEffect, useMemo } from "react";
import { BufferAttribute, BufferGeometry, Mesh, type MeshStandardMaterial, type Object3D } from "three";
import { colonyContract } from "./colony";
import type { ProjectBase } from "./layout";
import { heightAt, ringRoadRadius, type TerrainField } from "./terrain-field";

const ringRoad = colonyContract.colony.ringRoad;
const apron = colonyContract.terrain.plateau.courtApron;
/** Segments around the loop. At radius 24 this is a kerb vertex about every 0.5 m. */
const segments = 288;
/** Painted kerb width, and how far it sits inside the paved band's edge. */
const kerbWidth = 0.34;
const kerbInset = 0.3;
/** Clear of the paving so the line never z-fights the height field it is painted on. */
const lift = 0.035;

/**
 * The ochre kerb lines that make the ring road read as the same deck as the bridges.
 *
 * The paving underneath is already the bridge's own surface -- both sample `court_weathered_basalt`,
 * and the height field levels the band so it catches the light the way the flat court does. What a
 * bridge deck has and a painted band does not is the pair of `utility_ochre` lines down its edges,
 * so that is what this adds, taking the material from the bridge model rather than approximating it.
 *
 * Two thin ribbons rather than a full deck: the surface is already right, and geometry laid over the
 * whole band would z-fight the terrain across its entire area instead of along two 0.34 m strips.
 */
export function ColonyRingRoad({
  bases,
  field,
  span,
}: {
  bases: ProjectBase[];
  field: TerrainField;
  /** The bridge span model, read only for its authored kerb material. */
  span: Object3D;
}) {
  const material = useMemo(() => {
    let found: MeshStandardMaterial | null = null;
    span.traverse((node) => {
      if (found || !(node instanceof Mesh)) return;
      const candidate = (Array.isArray(node.material) ? node.material : [node.material]).find(
        (entry) => (entry as MeshStandardMaterial).name === "utility_ochre",
      );
      if (candidate) found = candidate as MeshStandardMaterial;
    });
    return found;
  }, [span]);
  const slotKey = bases.map((base) => base.appearance.slot ?? "").join();
  // biome-ignore lint/correctness/useExhaustiveDependencies: The kerbs depend on the occupied slots and the field.
  const meshes = useMemo(() => {
    if (!material) return [];
    const result: Mesh[] = [];
    for (const profile of field.profiles) {
      // The landing terrace is a pad, not a parcel with a plateau, and an unconnected slot has no
      // spurs for a loop to link.
      if (profile.hub || profile.built.length === 0) continue;
      const [cx, cz] = profile.centre;
      for (const side of [-1, 1] as const) {
        const positions: number[] = [];
        const indices: number[] = [];
        let previous = false;
        for (let i = 0; i <= segments; i++) {
          const angleDeg = (i / segments) * 360;
          const a = (angleDeg * Math.PI) / 180;
          const centre = ringRoadRadius(profile, angleDeg);
          const edge = centre + side * (ringRoad.width / 2 - kerbInset);
          const dx = Math.cos(a);
          const dz = Math.sin(a);
          // The apron paves the whole court front at its own level and the band yields to it there,
          // so the kerb stops at its edge rather than floating across it.
          const inApron =
            dx * centre >= (apron.x[0] ?? -12.5) - 1 &&
            dx * centre <= (apron.x[1] ?? 12.5) + 1 &&
            dz * centre >= (apron.z[0] ?? 14) - 1 &&
            dz * centre <= (apron.z[1] ?? 27) + 1;
          if (inApron) {
            previous = false;
            continue;
          }
          const y = heightAt(field, cx + dx * centre, cz + dz * centre) + lift;
          const inner = edge - kerbWidth / 2;
          const outer = edge + kerbWidth / 2;
          const base = positions.length / 3;
          positions.push(dx * inner, y, dz * inner, dx * outer, y, dz * outer);
          if (previous) indices.push(base - 2, base - 1, base, base - 1, base + 1, base);
          previous = true;
        }
        if (indices.length === 0) continue;
        const geometry = new BufferGeometry();
        geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        const mesh = new Mesh(geometry, material);
        mesh.name = `MF_RingRoad_${profile.id}_${side < 0 ? "inner" : "outer"}`;
        mesh.position.set(cx, 0, cz);
        mesh.receiveShadow = true;
        result.push(mesh);
      }
    }
    return result;
  }, [field, material, slotKey]);
  useEffect(
    () => () => {
      for (const mesh of meshes) mesh.geometry.dispose();
    },
    [meshes],
  );
  return (
    <>
      {meshes.map((mesh) => (
        <primitive key={mesh.uuid} object={mesh} />
      ))}
    </>
  );
}
