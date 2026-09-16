import { useEffect, useMemo } from "react";
import { Mesh, type Object3D } from "three";
import { colonyBridges, slotPosition } from "./colony";
import { occupiedSlots, type ProjectBase } from "./layout";

/** Bridges and their abutments between occupied lattice neighbours; the land itself is the height field. */
export function ColonyGround({ bases, span, end }: { bases: ProjectBase[]; span: Object3D; end: Object3D }) {
  const key = occupiedSlots(bases).join();
  // biome-ignore lint/correctness/useExhaustiveDependencies: Geometry placement only depends on occupied slots.
  const objects = useMemo(() => {
    const slots = occupiedSlots(bases);
    const objects: Object3D[] = [];
    for (const bridge of colonyBridges(slots)) {
      const model = span.clone(true);
      model.position.set(bridge.start[0], 0, bridge.start[1]);
      model.rotation.y = (-bridge.worldAngleDeg * Math.PI) / 180;
      objects.push(model);
      for (const [slot, edge] of [
        [bridge.from, bridge.fromEdge],
        [bridge.to, bridge.toEdge],
      ] as const) {
        const position = slotPosition(slot);
        const abutment = end.clone(true);
        abutment.position.set(position[0] + edge.padCentre[0], 0, position[2] + edge.padCentre[1]);
        abutment.rotation.y = (-edge.worldAngleDeg * Math.PI) / 180;
        objects.push(abutment);
      }
    }
    for (const object of objects)
      object.traverse((node) => {
        if (node instanceof Mesh) node.castShadow = node.receiveShadow = true;
      });
    return objects;
  }, [key, span, end]);
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
