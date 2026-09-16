import { useEffect, useMemo } from "react";
import type { Object3D } from "three";
import { colonyBridges, hiddenEdgeGroups } from "./colony";
import type { ProjectBase } from "./layout";

export function ColonyGround({
  bases,
  hub,
  span,
  end,
}: {
  bases: ProjectBase[];
  hub: Object3D;
  span: Object3D;
  end: Object3D;
}) {
  const key = bases.map((base) => base.slot).join();
  // biome-ignore lint/correctness/useExhaustiveDependencies: Geometry placement only depends on occupied slots.
  const objects = useMemo(() => {
    const slots = bases.map((base) => base.slot);
    const centre = hub.clone(true);
    for (const name of hiddenEdgeGroups("H", slots)) {
      const object = centre.getObjectByName(name);
      if (object) object.visible = false;
    }
    const objects = [centre];
    for (const bridge of colonyBridges(slots)) {
      const model = span.clone(true);
      model.position.set(bridge.start[0], 0, bridge.start[1]);
      model.rotation.y = (-bridge.worldAngleDeg * Math.PI) / 180;
      objects.push(model);
      for (const [slot, edge] of [
        [bridge.from, bridge.fromEdge],
        [bridge.to, bridge.toEdge],
      ] as const) {
        const base = bases.find((base) => base.slot === slot);
        const position = base?.position ?? [0, 0, 0];
        const abutment = end.clone(true);
        abutment.position.set(
          (position[0] ?? 0) + edge.padCentre[0],
          0,
          (position[2] ?? 0) + edge.padCentre[1],
        );
        abutment.rotation.y = (-edge.worldAngleDeg * Math.PI) / 180;
        objects.push(abutment);
      }
    }
    return objects;
  }, [key, hub, span, end]);
  useEffect(() => {
    for (const object of objects) object.updateMatrixWorld(true);
  }, [objects]);
  return (
    <>
      {objects.map((object) => (
        <primitive key={object.uuid} object={object} />
      ))}
    </>
  );
}
