import { useEffect, useMemo } from "react";
import { Group, Mesh, MeshStandardMaterial, type Object3D } from "three";
import type { Point3 } from "./colony";
import { colonyContract } from "./colony";
import { shuttleOffset, shuttleYaw } from "./shuttle-placement";

/**
 * The transport standing on the hub landing terrace, and the pad it stands on.
 *
 * Contract 2.0 reserved this spot as `interactionSockets.spaceport_pad` and describes slot H as the
 * shared shuttle pad; until the scans landed it rendered as bare ground, and the greybox still calls
 * it `empty_landing_pad`. One GLB carries both roots: `MF_Pad` is centred on the pad, `MF_Shuttle`
 * stands on it. Both are authored with their contact plane at y=0, so neither needs a scene offset
 * beyond the pad top.
 *
 * The shuttle sits slightly off centre and turned off-square, because a transport parked dead centre
 * and square to the world reads as a placed prop rather than something that landed. Nothing here
 * reads task or run state: the shuttle and its pad are scenery, never status.
 */
const pad = colonyContract.terrain.landing;
/**
 * The deck is authored with its top face at y=0, which put it exactly coplanar with the terrain's
 * flat pad level. Coplanar surfaces z-fight, and the further the camera pulls back the coarser the
 * depth buffer gets there, so the pad flickered when the world view zoomed out. Seven centimetres of
 * lift separates them at every distance; the kerb below stays buried in the ground.
 */
const PAD_LIFT = 0.07;
/** Practical lamps the pad beacons imply, kept to two so the scene's light budget is unchanged. */
const LAMPS: { position: Point3; intensity: number; distance: number }[] = [
  { position: [6.5, 3.2, -5.5], intensity: 26, distance: 26 },
  { position: [-7.0, 2.6, 4.5], intensity: 18, distance: 22 },
];

export function ColonyShuttle({ model, origin }: { model: Object3D; origin: Point3 }) {
  const built = useMemo(() => {
    const root = new Group();
    root.name = "MF_ShuttleGroup";
    const source = model.clone(true);
    const body = source.getObjectByName("MF_Shuttle");
    const deck = source.getObjectByName("MF_Pad");
    const dress = (object: Object3D, casts: boolean) =>
      object.traverse((child) => {
        if (!(child instanceof Mesh)) return;
        child.castShadow = casts;
        child.receiveShadow = true;
        // Emissive pad materials are already authored; make sure they survive tone mapping at dusk.
        for (const material of Array.isArray(child.material) ? child.material : [child.material])
          if (material instanceof MeshStandardMaterial && material.name.startsWith("practical_"))
            material.toneMapped = false;
      });
    if (deck) {
      deck.position.set(0, 0, 0);
      dress(deck, false);
      root.add(deck);
    }
    if (body) {
      body.position.set(shuttleOffset, 0, -shuttleOffset * 0.6);
      body.rotation.y = shuttleYaw;
      dress(body, true);
      root.add(body);
    }
    root.position.set(origin[0], origin[1] + pad.padTop + PAD_LIFT, origin[2]);
    return root;
  }, [model, origin]);
  useEffect(
    () => () => {
      built.traverse((object) => {
        if (object instanceof Mesh) object.geometry.dispose();
      });
    },
    [built],
  );
  return (
    <>
      <primitive object={built} />
      {LAMPS.map((lamp) => (
        <pointLight
          key={`shuttle:${lamp.position.join()}`}
          color="#ffc37f"
          intensity={lamp.intensity}
          distance={lamp.distance}
          decay={2}
          position={[
            origin[0] + lamp.position[0],
            origin[1] + pad.padTop + PAD_LIFT + lamp.position[1],
            origin[2] + lamp.position[2],
          ]}
        />
      ))}
    </>
  );
}
