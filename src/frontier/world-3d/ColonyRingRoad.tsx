import { useEffect, useMemo } from "react";
import { BufferAttribute, BufferGeometry, Mesh, type MeshStandardMaterial, type Object3D } from "three";
import { colonyContract } from "./colony";
import type { ProjectBase } from "./layout";
import { heightAt, ringRoadRadius, type TerrainField } from "./terrain-field";

const ringRoad = colonyContract.colony.ringRoad;
const apron = colonyContract.terrain.plateau.courtApron;
const spurHalfWidth = colonyContract.colony.spurs.width / 2;
const padRadial = colonyContract.colony.pads.radial;
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
/** One flat ribbon of kerb, positioned at its parcel centre. */
function ribbon(
  positions: number[],
  indices: number[],
  material: MeshStandardMaterial,
  cx: number,
  cz: number,
  name: string,
) {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(cx, 0, cz);
  mesh.receiveShadow = true;
  return mesh;
}

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
    // Cloned, not borrowed. The kerb needs a depth bias to sit on paving without tearing against it,
    // and the source material is the one the bridge decks are drawn with.
    if (!found) return null;
    const owned = (found as MeshStandardMaterial).clone();
    owned.polygonOffset = true;
    owned.polygonOffsetFactor = -2;
    owned.polygonOffsetUnits = -2;
    return owned;
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
        result.push(
          ribbon(
            positions,
            indices,
            material,
            cx,
            cz,
            `MF_RingRoad_${profile.id}_${side < 0 ? "inner" : "outer"}`,
          ),
        );
      }
      // The loop has to arrive somewhere. Each built spur gets the same pair of lines running from
      // the carriageway out to the bridge pad, so the ring turns onto the approach instead of
      // sweeping past it and leaving the bridge joined to nothing.
      for (const edge of profile.built) {
        const a = (edge.worldAngleDeg * Math.PI) / 180;
        const dx = Math.cos(a);
        const dz = Math.sin(a);
        const px = -Math.sin(a);
        const pz = Math.cos(a);
        const from = ringRoadRadius(profile, edge.worldAngleDeg);
        const to = (padRadial[1] ?? 31.5) - 0.5;
        for (const side of [-1, 1] as const) {
          const offset = side * (spurHalfWidth - kerbInset);
          const positions: number[] = [];
          const indices: number[] = [];
          const steps = 24;
          let previousSpur = false;
          for (let i = 0; i <= steps; i++) {
            const r = from + ((to - from) * i) / steps;
            const centreX = dx * r + px * offset;
            const centreZ = dz * r + pz * offset;
            // The apron is paved at its own level, a quarter metre above the height field. A kerb
            // laid on the field crosses under it and surfaces in broken dashes where the two graze.
            if (
              centreX >= (apron.x[0] ?? -12.5) - 1 &&
              centreX <= (apron.x[1] ?? 12.5) + 1 &&
              centreZ >= (apron.z[0] ?? 14) - 1 &&
              centreZ <= (apron.z[1] ?? 27) + 1
            ) {
              previousSpur = false;
              continue;
            }
            const y = heightAt(field, cx + centreX, cz + centreZ) + lift;
            const half = kerbWidth / 2;
            const base = positions.length / 3;
            positions.push(
              centreX - px * half,
              y,
              centreZ - pz * half,
              centreX + px * half,
              y,
              centreZ + pz * half,
            );
            if (previousSpur) indices.push(base - 2, base - 1, base, base - 1, base + 1, base);
            previousSpur = true;
          }
          if (indices.length === 0) continue;
          result.push(
            ribbon(
              positions,
              indices,
              material,
              cx,
              cz,
              `MF_RingRoad_${profile.id}_${edge.id}_${side < 0 ? "left" : "right"}`,
            ),
          );
        }
      }
    }
    return result;
  }, [field, material, slotKey]);
  useEffect(
    () => () => {
      for (const mesh of meshes) mesh.geometry.dispose();
      material?.dispose();
    },
    [meshes, material],
  );
  return (
    <>
      {meshes.map((mesh) => (
        <primitive key={mesh.uuid} object={mesh} />
      ))}
    </>
  );
}
