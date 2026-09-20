import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  AnimationMixer,
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  SkinnedMesh,
  Vector3,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { isOccluded, visibleOccluders } from "../../src/frontier/world-3d/occlusion.ts";
import { batchWorker, cloneWorker, disposeWorker } from "../../src/frontier/world-3d/worker-batching.ts";

test("the actual worker batches 80 parts into six materials without changing any sampled animated vertex", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../../public/frontier/assets/3d-proof/manifest.json", import.meta.url), "utf8"),
  );
  const bytes = await readFile(new URL(`../../public/frontier${manifest.worker}`, import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "",
  );
  const original = gltf.scene;
  const packed = batchWorker(original);
  const first = cloneWorker(packed.scene),
    second = cloneWorker(packed.scene);
  const meshes = (root) => {
    const result = [];
    root.traverse((node) => {
      if (node instanceof Mesh) result.push(node);
    });
    return result;
  };
  const sourceParts = meshes(original),
    firstParts = meshes(first);
  assert.equal(sourceParts.length, 80);
  assert.equal(firstParts.length, 6);
  assert.ok(firstParts.every((node) => node instanceof SkinnedMesh));
  const triangles = (parts) => parts.reduce((sum, node) => sum + node.geometry.index.count / 3, 0);
  assert.equal(triangles(firstParts), triangles(sourceParts));
  assert.equal(new Set(firstParts.map((node) => node.skeleton)).size, 1);
  assert.notEqual(firstParts[0].skeleton.bones[0], meshes(second)[0].skeleton.bones[0]);
  const mixers = [original, first].map((root) => {
    const mixer = new AnimationMixer(root);
    mixer.clipAction(gltf.animations[0]).play();
    return mixer;
  });
  for (const time of [0, 0.19, 0.47, 0.83]) {
    for (const mixer of mixers) mixer.setTime(time);
    original.updateMatrixWorld(true);
    first.updateMatrixWorld(true);
    const offsets = new Map();
    for (const part of sourceParts) {
      const packedPart = firstParts.find((node) => node.material === part.material);
      const offset = offsets.get(part.material) ?? 0;
      const positions = part.geometry.getAttribute("position");
      for (const index of [0, Math.floor(positions.count / 2), positions.count - 1]) {
        const expected = new Vector3().fromBufferAttribute(positions, index).applyMatrix4(part.matrixWorld);
        const actual = packedPart
          .getVertexPosition(offset + index, new Vector3())
          .applyMatrix4(packedPart.matrixWorld);
        assert.ok(
          expected.distanceTo(actual) < 0.00001,
          `${part.name} at ${time}: ${expected.distanceTo(actual)}`,
        );
      }
      offsets.set(part.material, offset + positions.count);
    }
  }
  disposeWorker(first);
  disposeWorker(second);
  packed.dispose();
});

test("label occlusion ignores hidden cutaway walls and geometry behind the worker", () => {
  const root = new Group();
  const wall = new Mesh(new BoxGeometry(2, 2, 1), new MeshBasicMaterial());
  wall.position.z = -5;
  const roof = new Group();
  roof.add(wall);
  root.add(roof);
  root.updateMatrixWorld(true);
  const ray = new Raycaster(new Vector3(), new Vector3(0, 0, -1));
  const hits = [];
  assert.equal(isOccluded(ray, visibleOccluders([root]), 10, hits), true);
  assert.equal(isOccluded(ray, visibleOccluders([root]), 3, hits), false);
  roof.visible = false;
  assert.equal(isOccluded(ray, visibleOccluders([root]), 10, hits), false);
  assert.equal(ray.far, Infinity);
  assert.equal(hits.length, 0);
  wall.geometry.dispose();
  wall.material.dispose();
});
