import { useEffect, useMemo } from "react";
import { Group, Mesh, type Object3D } from "three";
import type { Point3 } from "./colony";
import { colonyContract } from "./colony";

/**
 * The transport standing on the hub landing terrace.
 *
 * Contract 2.0 reserves this spot as `interactionSockets.spaceport_pad` and describes slot H as the
 * shared shuttle pad; until now the pad rendered as bare ground. The model is authored with its
 * landing gear contact plane at y=0, so it stands on the pad top with no per-scene offset.
 *
 * It sits off the pad centre and turned off-axis, because a transport parked dead centre and square
 * to the world reads as a placed prop rather than something that landed. Nothing here reads task or
 * run state: the shuttle is scenery, not status.
 */
const pad = colonyContract.terrain.landing;
/** Metres from the pad centre, along the pad's own axis. */
const OFFSET = 3.2;
/** Radians about +Y: off-square so the fuselage crosses the pad markings. */
const YAW = -0.42;

export function ColonyShuttle({ model, origin }: { model: Object3D; origin: Point3 }) {
  const built = useMemo(() => {
    const root = new Group();
    root.name = "MF_Shuttle";
    const body = model.clone(true);
    body.traverse((object) => {
      if (object instanceof Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    root.add(body);
    root.position.set(origin[0] + OFFSET, origin[1] + pad.padTop, origin[2] - OFFSET * 0.6);
    root.rotation.y = YAW;
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
  return <primitive object={built} />;
}
