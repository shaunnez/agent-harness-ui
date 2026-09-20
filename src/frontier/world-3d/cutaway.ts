import { Mesh, type Object3D } from "three";

/** The shared shell and separate crown can each contain an MF_Roof root. */
export function cutawayGroups(root: Object3D | undefined) {
  const groups: Object3D[] = [];
  root?.traverse((object) => {
    if (object.name === "MF_Roof" || object.name === "MF_ShellCutaway") groups.push(object);
  });
  return groups;
}

const ignore = () => {};
/**
 * Shows or hides a cutaway group, and takes it out of picking with it.
 *
 * `visible = false` alone is not enough, and that is the whole of the bug where a robot inside an
 * opened base could not be clicked while one on the court could. Three stopped checking `visible` in
 * the raycaster years ago, and react-three-fiber sorts raw intersections by distance without a
 * visibility filter of its own -- so the lifted roof, sitting between the camera and every robot in
 * the building, went on catching their rays. The hit bubbled up to the base's own click handler,
 * which calls `stopPropagation`, and the robot never heard it: you selected the project instead.
 *
 * Restoring `Mesh.prototype.raycast` rather than remembering each mesh's own is safe here because
 * the shell is plain meshes; nothing in a cutaway group carries a skin or a custom raycast.
 */
export function setCutawayVisible(group: Object3D, visible: boolean) {
  group.visible = visible;
  group.traverse((object) => {
    if (object instanceof Mesh) object.raycast = visible ? Mesh.prototype.raycast : ignore;
  });
}
