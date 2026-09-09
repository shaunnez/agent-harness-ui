import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { cinematicWorker } from "../../src/frontier/world/cinematic-catalog.ts";

const publicRoot = path.resolve("public/frontier");
const manifest = JSON.parse(await readFile(path.join(publicRoot, "assets/cinematic/manifest.json"), "utf8"));

test("cinematic catalogue resolves to verified RGBA exports with the measured 2x registration", async () => {
  const ids = new Set();
  for (const asset of manifest.assets) {
    assert.equal(ids.has(asset.id), false, `duplicate asset ${asset.id}`);
    ids.add(asset.id);
    assert.ok(asset.file.startsWith("/assets/cinematic/"));
    const buffer = await readFile(path.join(publicRoot, asset.file));
    assert.equal(createHash("sha256").update(buffer).digest("hex"), asset.sha256, asset.id);
    assert.equal(buffer.length, asset.bytes, asset.id);
    assert.deepEqual([buffer.readUInt32BE(16), buffer.readUInt32BE(20)], asset.sourceSize, asset.id);
    assert.equal(buffer[25], 6, `${asset.id} must remain RGBA`);
    assert.ok(asset.sourceSize.every((size) => size > 0 && size <= 2048));
    assert.deepEqual(
      asset.logicalSize,
      asset.sourceSize.map((size) => size / 2),
    );
    assert.ok(asset.groundAnchor.every(Number.isFinite));
  }
});

test("worker loop changes the articulated image without shifting its ground frame or tool contact", () => {
  const frames = cinematicWorker.frames.map((id) => manifest.assets.find((asset) => asset.id === id));
  assert.ok(frames.length >= 8);
  assert.ok(frames.every(Boolean));
  assert.equal(new Set(frames.map((frame) => frame.sha256)).size, frames.length);
  assert.ok(cinematicWorker.frameDurationMs > 0);
  const first = frames[0];
  for (const frame of frames) {
    assert.deepEqual(frame.sourceSize, first.sourceSize);
    assert.deepEqual(frame.groundAnchor, first.groundAnchor);
    const distance = Math.hypot(
      ...frame.sockets.probeTip.map((point, index) => point - first.sockets.probeTip[index]),
    );
    assert.ok(distance <= 3, `${frame.id} moved away from the station contact: ${distance}`);
  }
  const idle = manifest.assets.find((asset) => asset.id === "mf.cinematic.worker.idle");
  assert.deepEqual(idle.groundAnchor, first.groundAnchor);
  assert.ok(manifest.assets.some((asset) => asset.file === cinematicWorker.portrait));
});
