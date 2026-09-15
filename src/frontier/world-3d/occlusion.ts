import { type Intersection, Mesh, type Object3D, type Raycaster } from "three";

export function visibleOccluders(roots: Iterable<Object3D>) {
  const meshes: Mesh[] = [];
  for (const root of roots)
    root.traverseVisible((object) => {
      if (object instanceof Mesh) meshes.push(object);
    });
  return meshes;
}

/** Only existence matters: stop at the first visible hit before the worker. */
export function isOccluded(ray: Raycaster, meshes: Mesh[], distance: number, hits: Intersection[]) {
  const previous = ray.far;
  ray.far = Math.max(0, distance - 1.1);
  try {
    for (const mesh of meshes) {
      hits.length = 0;
      ray.intersectObject(mesh, false, hits);
      if (hits.length) return true;
    }
    return false;
  } finally {
    hits.length = 0;
    ray.far = previous;
  }
}
