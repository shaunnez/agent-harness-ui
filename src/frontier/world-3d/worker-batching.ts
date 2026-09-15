import {
  Bone,
  type BufferGeometry,
  Float32BufferAttribute,
  Group,
  type Material,
  Matrix4,
  Mesh,
  type Object3D,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";

/** Pack rigid robot parts by material; named bones retain the authored animation tracks. */
export function batchWorker(source: Object3D) {
  source.updateMatrixWorld(true);
  const root = new Group().copy(source, false);
  const bones: Bone[] = [];
  const indices = new Map<Object3D, number>();
  const copyHierarchy = (node: Object3D): Bone => {
    const bone = new Bone().copy(node, false);
    indices.set(node, bones.length);
    bones.push(bone);
    for (const child of node.children) bone.add(copyHierarchy(child));
    return bone;
  };
  for (const child of source.children) root.add(copyHierarchy(child));
  const inverseRoot = source.matrixWorld.clone().invert();
  const transform = new Matrix4();
  const groups = new Map<Material, BufferGeometry[]>();
  source.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    if (node instanceof SkinnedMesh || Array.isArray(node.material) || node.morphTargetInfluences)
      throw new Error("The rigid worker export needs single-material parts without an existing skin.");
    const bone = indices.get(node);
    if (bone === undefined) throw new Error("The worker part has no animation bone.");
    const geometry = node.geometry.clone();
    geometry.applyMatrix4(transform.multiplyMatrices(inverseRoot, node.matrixWorld));
    const count = geometry.getAttribute("position").count;
    const joints = new Uint16Array(count * 4);
    const weights = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      joints[i * 4] = bone;
      weights[i * 4] = 1;
    }
    geometry.setAttribute("skinIndex", new Uint16BufferAttribute(joints, 4));
    geometry.setAttribute("skinWeight", new Float32BufferAttribute(weights, 4));
    const group = groups.get(node.material) ?? [];
    group.push(geometry);
    groups.set(node.material, group);
  });
  root.updateMatrixWorld(true);
  const skeleton = new Skeleton(bones);
  const owned: BufferGeometry[] = [];
  for (const [material, parts] of groups) {
    const geometry = mergeGeometries(parts);
    for (const part of parts) part.dispose();
    if (!geometry) throw new Error("The worker parts have incompatible geometry attributes.");
    owned.push(geometry);
    const mesh = new SkinnedMesh(geometry, material);
    mesh.name = `worker-material-${material.name}`;
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
    mesh.bind(skeleton);
    // The authored tool reaches beyond the resting body. These six small meshes stay admitted.
    mesh.frustumCulled = false;
  }
  return {
    scene: root,
    dispose() {
      for (const geometry of owned) geometry.dispose();
      skeleton.dispose();
    },
  };
}

export function cloneWorker(source: Object3D) {
  const body = clone(source);
  let skeleton: Skeleton | undefined;
  body.traverse((node) => {
    if (!(node instanceof SkinnedMesh)) return;
    // SkeletonUtils clones once per material mesh; the parts of one robot share one bone palette.
    skeleton ??= node.skeleton;
    node.skeleton = skeleton;
  });
  return body;
}

export function disposeWorker(body: Object3D) {
  const skeletons = new Set<Skeleton>();
  body.traverse((node) => {
    if (node instanceof SkinnedMesh) skeletons.add(node.skeleton);
  });
  for (const skeleton of skeletons) skeleton.dispose();
}
