import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { isInitialAsset } from "../../src/frontier/world/asset-policy.ts";
import { livingWorker } from "../../src/frontier/world/living-catalog.ts";

const manifest = JSON.parse(await readFile("public/frontier/assets/living/manifest.json", "utf8"));
test("living assets match qualified RGBA hashes, dimensions, bounds and registration", async () => {
  const ids = new Set();
  for (const asset of manifest.assets) {
    assert.equal(ids.has(asset.id), false);
    ids.add(asset.id);
    const bytes = await readFile(path.join("public/frontier", asset.file));
    assert.equal(bytes.length, asset.bytes, asset.id);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), asset.sha256, asset.id);
    assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], asset.sourceSize);
    assert.equal(bytes[25], 6);
    assert.ok(asset.sourceSize.every((size) => size > 0 && size <= 2048));
    assert.deepEqual(
      asset.logicalSize,
      asset.sourceSize.map((size) => size / 2),
    );
    if (asset.id.includes("worker")) {
      assert.deepEqual(asset.groundAnchor, [96, 167]);
      assert.ok(asset.boundsSourcePixels[0] > 0 && asset.boundsSourcePixels[1] > 0);
      assert.ok(asset.boundsSourcePixels[2] < 384 && asset.boundsSourcePixels[3] < 384);
    }
  }
});
test("walking loads initially while the two richer work loops remain lazy", () => {
  for (const pose of ["walk", "scan", "type"]) {
    const frames = livingWorker[pose].map((id) => manifest.assets.find((asset) => asset.id === id));
    assert.equal(frames.length, 8);
    assert.ok(frames.every(Boolean));
    assert.equal(new Set(frames.map((frame) => frame.sha256)).size, 8);
    for (const frame of frames) assert.equal(isInitialAsset(frame, "cinematic"), pose === "walk");
  }
  const initial = manifest.assets.filter((asset) => isInitialAsset(asset, "cinematic"));
  assert.ok(initial.reduce((sum, asset) => sum + asset.bytes, 0) < 1.2 * 1024 * 1024);
});
