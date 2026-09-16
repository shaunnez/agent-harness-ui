import type { Object3D } from "three";

/** The shared shell and separate crown can each contain an MF_Roof root. */
export function cutawayGroups(root: Object3D | undefined) {
  const groups: Object3D[] = [];
  root?.traverse((object) => {
    if (object.name === "MF_Roof" || object.name === "MF_ShellCutaway") groups.push(object);
  });
  return groups;
}
