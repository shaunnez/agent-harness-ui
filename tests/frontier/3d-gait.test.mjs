import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { proofWorkerScale } from "../../src/frontier/world-3d/model.ts";
import {
  applyGait,
  buildGait,
  gaitBob,
  gaitStrideCycle,
  restGait,
} from "../../src/frontier/world-3d/worker-gait.ts";
import { batchWorker, cloneWorker } from "../../src/frontier/world-3d/worker-batching.ts";

/** The runtime body: the actual export, batched and cloned exactly as a worker receives it. */
async function workerBody() {
  const manifest = JSON.parse(
    await readFile(new URL("../../public/frontier/assets/3d-proof/manifest.json", import.meta.url), "utf8"),
  );
  const bytes = await readFile(new URL(`../../public/frontier${manifest.worker}`, import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "",
  );
  return cloneWorker(batchWorker(gltf.scene).scene);
}

/** Sample one full cycle, returning each foot's fore/aft offset within the body. */
function walkCycle(gait, body, steps = 48) {
  const feet = gait.parts.filter((part) => part.node.name.startsWith("segmented_foot"));
  const samples = [];
  for (let i = 0; i < steps; i++) {
    const walked = (i / steps) * gaitStrideCycle;
    applyGait(gait, (walked / gaitStrideCycle) * Math.PI * 2, 1);
    body.updateMatrixWorld(true);
    samples.push({
      walked,
      feet: feet.map((part) => ({ name: part.node.name, z: part.node.position.z, y: part.node.position.y })),
    });
  }
  return { feet, samples };
}

test("the actual worker export exposes a complete two-sided leg rig for the procedural gait", async () => {
  const body = await workerBody();
  const gait = buildGait(body);
  assert.ok(gait, "the flat worker export should still resolve a leg rig");
  // Nine parts a side: thigh, thigh armour, knee, knee pin, shin, shell, seam, foot, toe.
  assert.equal(gait.parts.length, 18);
  assert.equal(gait.parts.filter((part) => part.right).length, 9);
  assert.equal(gait.parts.filter((part) => !part.right).length, 9);
  // The hip must sit above the knee it swings, on both sides.
  assert.ok(gait.hip.left.y > gait.knee.left.y);
  assert.ok(gait.hip.right.y > gait.knee.right.y);
});

test("both feet swing through a real stride in antiphase", async () => {
  const body = await workerBody();
  const gait = buildGait(body);
  const { feet, samples } = walkCycle(gait, body);
  assert.equal(feet.length, 2);
  const series = {};
  for (const sample of samples)
    for (const foot of sample.feet) {
      series[foot.name] ??= [];
      series[foot.name].push(foot.z);
    }
  const names = Object.keys(series);
  for (const name of names) {
    const span = Math.max(...series[name]) - Math.min(...series[name]);
    // A visible stride, but never longer than the worker is tall.
    assert.ok(span > 0.4, `${name} swings ${span.toFixed(3)}, which reads as sliding rather than walking`);
    assert.ok(span < 1.2, `${name} swings ${span.toFixed(3)}, which over-strides`);
  }
  const [left, right] = names.map((name) => series[name]);
  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const ml = mean(left),
    mr = mean(right);
  let product = 0,
    sqL = 0,
    sqR = 0;
  for (let i = 0; i < left.length; i++) {
    product += (left[i] - ml) * (right[i] - mr);
    sqL += (left[i] - ml) ** 2;
    sqR += (right[i] - mr) ** 2;
  }
  // One leg reaches while the other trails; in step would read as hopping.
  assert.ok(product / Math.sqrt(sqL * sqR) < -0.8, "the legs should swing in opposition");
});

test("a planted foot stays put on the ground rather than skating with the body", async () => {
  const body = await workerBody();
  const gait = buildGait(body);
  const steps = 48;
  const { feet, samples } = walkCycle(gait, body, steps);
  const travelPerStep = (gaitStrideCycle / steps) * 1000;
  for (const foot of feet) {
    const ground = samples.map(
      // The body advances along the world while the foot offset moves within it.
      (sample) =>
        sample.walked * 1000 +
        sample.feet.find((entry) => entry.name === foot.node.name).z * proofWorkerScale * 1000,
    );
    let slowest = Infinity;
    for (let i = 1; i < ground.length; i++) slowest = Math.min(slowest, Math.abs(ground[i] - ground[i - 1]));
    // During stance the foot should barely move across the ground the body is crossing.
    assert.ok(
      slowest < travelPerStep * 0.2,
      `the slowest ground movement was ${slowest.toFixed(1)} against ${travelPerStep.toFixed(1)} of travel`,
    );
  }
});

test("a worker standing still returns to the exact authored rest pose", async () => {
  const body = await workerBody();
  const gait = buildGait(body);
  const rest = gait.parts.map((part) => ({
    position: part.node.position.clone(),
    quaternion: part.node.quaternion.clone(),
  }));
  applyGait(gait, 1.7, 1);
  assert.ok(
    gait.parts.some((part, index) => part.node.position.distanceTo(rest[index].position) > 1e-6),
    "the walk should actually move the legs before it is cleared",
  );
  restGait(gait);
  gait.parts.forEach((part, index) => {
    assert.ok(part.node.position.distanceTo(rest[index].position) < 1e-9);
    // Compared component-wise: the export's quaternions are not exactly unit length, so a
    // self dot product lands a rounding step away from one even for an identical pose.
    for (const field of ["x", "y", "z", "w"])
      assert.equal(part.node.quaternion[field], rest[index].quaternion[field]);
  });
  // A faded-out blend is the same as standing, so a paused worker never drifts.
  applyGait(gait, 1.7, 0);
  gait.parts.forEach((part, index) => {
    assert.ok(part.node.position.distanceTo(rest[index].position) < 1e-9);
  });
  assert.equal(gaitBob(1.7, 0), 0);
  assert.ok(gaitBob(Math.PI / 2, 1) > 0);
});
