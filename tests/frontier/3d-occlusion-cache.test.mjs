import assert from "node:assert/strict";
import test from "node:test";
import { PerspectiveCamera } from "three";
import { OcclusionCache } from "../../src/frontier/world-3d/finish.ts";

/** Advance a number of frames at a fixed step, counting the ones that rebuild the buffer. */
function frames(cache, camera, count, step) {
  let rebuilt = 0;
  for (let i = 0; i < count; i++) if (cache.expired(camera, step)) rebuilt++;
  return rebuilt;
}

test("the first frame has no occlusion buffer to reuse", () => {
  const camera = new PerspectiveCamera();
  camera.updateMatrixWorld(true);
  assert.equal(new OcclusionCache(0.08).expired(camera, 0), true);
});

test("a parked camera rebuilds on the hold interval rather than every frame", () => {
  const camera = new PerspectiveCamera();
  camera.position.set(4, 6, 9);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const cache = new OcclusionCache(0.08);
  cache.expired(camera, 0);
  // One second at 60fps: a rebuild every 0.08s is around twelve, not sixty.
  const rebuilt = frames(cache, camera, 60, 1 / 60);
  assert.ok(rebuilt >= 11, `rebuilt ${rebuilt} times, so scene movement would lag the occlusion`);
  assert.ok(rebuilt <= 13, `rebuilt ${rebuilt} times, so the hold is not deferring the work`);
  // Four frames in five reuse the buffer, which is where the saved geometry pass comes from.
  assert.ok(rebuilt / 60 <= 0.25);
});

test("moving the camera rebuilds the buffer that same frame", () => {
  const camera = new PerspectiveCamera();
  camera.updateMatrixWorld(true);
  const cache = new OcclusionCache(0.08);
  cache.expired(camera, 0);
  assert.equal(cache.expired(camera, 1 / 60), false);
  camera.position.x += 0.01;
  camera.updateMatrixWorld(true);
  assert.equal(cache.expired(camera, 1 / 60), true, "a nudged camera may not reuse the last view");
  // An orbit rebuilds every frame, which is the cost this cache declines to cut.
  let orbited = 0;
  for (let i = 0; i < 30; i++) {
    camera.rotation.y += 0.02;
    camera.updateMatrixWorld(true);
    if (cache.expired(camera, 1 / 60)) orbited++;
  }
  assert.equal(orbited, 30);
});

test("a zoom rebuilds the buffer even from a camera that has not moved", () => {
  const camera = new PerspectiveCamera();
  camera.updateMatrixWorld(true);
  const cache = new OcclusionCache(0.08);
  cache.expired(camera, 0);
  assert.equal(cache.expired(camera, 1 / 60), false);
  camera.fov = 40;
  camera.updateProjectionMatrix();
  assert.equal(cache.expired(camera, 1 / 60), true);
});
