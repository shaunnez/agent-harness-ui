import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { isDetailAsset, isInitialAsset } from "../../src/frontier/world/asset-policy.ts";

const root = path.resolve("public/frontier");
const { assets } = JSON.parse(await readFile(path.join(root, "assets/fidelity/manifest.json"), "utf8"));
const original = JSON.parse(await readFile(path.join(root, "assets/cinematic/manifest.json"), "utf8"));

test("fidelity exports preserve measured PNG identity and a common room ground plane", async () => {
  assert.equal(new Set(assets.map((asset) => asset.id)).size, 6);
  for (const asset of assets) {
    assert.ok(asset.file.startsWith("/assets/fidelity/"));
    const bytes = await readFile(path.join(root, asset.file));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), asset.sha256, asset.id);
    assert.equal(bytes.length, asset.bytes);
    assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], asset.sourceSize);
    assert.equal(bytes[25], 6, "Alpha must survive export");
    assert.deepEqual(
      asset.logicalSize,
      asset.sourceSize.map((value) => value / 2),
    );
    if (asset.id.startsWith("mf.fidelity.room.")) {
      assert.deepEqual(asset.sourceSize, [1536, 1280]);
      assert.deepEqual(asset.groundAnchor, [384, 522]);
      assert.deepEqual(asset.footprint, [
        [384, 170],
        [736, 346],
        [384, 522],
        [32, 346],
      ]);
      assert.ok(isDetailAsset(asset));
      assert.equal(isInitialAsset(asset, "cinematic"), false);
    } else {
      const previous = original.assets.find((entry) => entry.id === asset.id);
      assert.ok(previous, "Environment revision must replace an existing identity");
      assert.deepEqual(asset.sourceSize, previous.sourceSize);
      for (let index = 0; index < 2; index++)
        assert.ok(Math.abs(asset.groundAnchor[index] - previous.groundAnchor[index]) < 0.02);
    }
  }
});
