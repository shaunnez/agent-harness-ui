import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { AnimationMixer, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { batchWorker, cloneWorker } from "../../src/frontier/world-3d/worker-batching.ts";
import {
  walkCycleSeconds,
  walkCycleSpeed,
  walkStrideMetres,
  workerClips,
} from "../../src/frontier/world-3d/worker-clips.ts";

/** The runtime body: the actual export, batched and cloned exactly as a worker receives it. */
async function workerExport() {
  const manifest = JSON.parse(
    await readFile(new URL("../../public/frontier/assets/3d-proof/manifest.json", import.meta.url), "utf8"),
  );
  const bytes = await readFile(new URL(`../../public/frontier${manifest.worker}`, import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "",
  );
  return { body: cloneWorker(batchWorker(gltf.scene).scene), clips: gltf.animations };
}

function jointsOf(body) {
  const found = new Map();
  body.traverse((node) => {
    if (node.name.startsWith("rig_")) found.set(node.name, node);
  });
  return found;
}

/** Drive one clip over `steps` samples of a full cycle, reading world positions each time. */
function sample(body, clips, name, read, steps = 48, scale = 1) {
  const clip = clips.find((entry) => entry.name === name);
  assert.ok(clip, `${name} is missing from the export`);
  const mixer = new AnimationMixer(body);
  const action = mixer.clipAction(clip);
  action.timeScale = scale;
  action.play();
  const out = [];
  for (let i = 0; i < steps; i++) {
    mixer.update(i === 0 ? 0 : (clip.duration / scale / steps) * 1);
    body.updateMatrixWorld(true);
    out.push(read(i / steps));
  }
  mixer.stopAllAction();
  return out;
}

test("the export carries every clip the work actions name, on a real joint hierarchy", async () => {
  const { body, clips } = await workerExport();
  assert.deepEqual(
    clips.map((clip) => clip.name).sort(),
    [...workerClips].sort(),
    "every named clip is exported",
  );
  const joints = jointsOf(body);
  for (const side of ["L", "R"])
    for (const part of ["thigh", "shin", "foot", "shoulder", "forearm"])
      assert.ok(joints.has(`rig_${part}_${side}`), `rig_${part}_${side} exists`);
  // The point of the rig: a shin hangs off its thigh, so swinging the hip carries the lower leg.
  const thigh = joints.get("rig_thigh_L");
  let node = joints.get("rig_foot_L");
  const ancestors = [];
  while (node) {
    ancestors.push(node.name);
    node = node.parent;
  }
  assert.ok(ancestors.includes("rig_shin_L"), "the foot hangs off the shin");
  assert.ok(ancestors.includes(thigh.name), "the shin hangs off the thigh");
});

test("both feet swing through a real stride in antiphase", async () => {
  const { body, clips } = await workerExport();
  const joints = jointsOf(body);
  const feet = ["rig_foot_L", "rig_foot_R"].map((name) => joints.get(name));
  const samples = sample(body, clips, "worker_walk", () =>
    feet.map((foot) => foot.getWorldPosition(new Vector3()).clone()),
  );
  for (let index = 0; index < feet.length; index++) {
    const lift = samples.map((frame) => frame[index].y);
    assert.ok(Math.max(...lift) - Math.min(...lift) > 0.05, `foot ${index} leaves the ground`);
    const reach = samples.map((frame) => frame[index].z);
    assert.ok(Math.max(...reach) - Math.min(...reach) > 0.3, `foot ${index} covers ground`);
  }
  // Antiphase: when one foot is at its highest the other is near the floor.
  const lifts = samples.map((frame) => frame.map((p) => p.y));
  const peak = lifts.reduce((best, row, i) => (row[0] > lifts[best][0] ? i : best), 0);
  assert.ok(lifts[peak][1] < lifts[peak][0], "the feet do not lift together");
});

test("a planted foot stays put on the ground rather than skating with the body", async () => {
  const { body, clips } = await workerExport();
  const joints = jointsOf(body);
  const foot = joints.get("rig_foot_L");
  const steps = 48;
  // Advance the body at the speed the clip is authored for, and the planted foot should hold still.
  const samples = sample(
    body,
    clips,
    "worker_walk",
    (fraction) => {
      const travelled = fraction * walkCycleSpeed * walkCycleSeconds;
      const local = foot.getWorldPosition(new Vector3());
      return { y: local.y, ground: local.z + travelled };
    },
    steps,
  );
  // `rig_foot_L` is the ankle pivot, which rides ~0.2 m above the floor; planted means at its lowest.
  // Only the longest unbroken run counts: a cycle's first and last samples are the same pose, so a
  // set that spans the loop seam would compare a foot against a body a whole stride further on.
  const floor = Math.min(...samples.map((entry) => entry.y));
  const down = samples.map((entry) => entry.y < floor + 0.02);
  let best = [];
  let run = [];
  for (const [index, grounded] of down.entries()) {
    run = grounded ? [...run, samples[index]] : [];
    if (run.length > best.length) best = run;
  }
  assert.ok(best.length > steps / 4, "the foot spends a real share of the cycle on the ground");
  const drift = Math.max(...best.map((p) => p.ground)) - Math.min(...best.map((p) => p.ground));
  assert.ok(drift < 0.12, `a planted foot holds its ground point (drifted ${drift.toFixed(3)} m)`);
});

test("the published stride matches the clip the runtime scales against", async () => {
  const meta = JSON.parse(
    await readFile(
      new URL(
        "../../design/mission-frontier/assets/staging/3d-visual-proof/astra-scene/worker-metadata.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(meta.walk.strideMetresPerCycle, walkStrideMetres);
  assert.equal(meta.animations.worker_walk.durationSeconds, walkCycleSeconds);
});
