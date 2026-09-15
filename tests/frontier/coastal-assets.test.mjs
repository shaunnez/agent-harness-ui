import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve("public/frontier");
test("coastal runtime layers form the complete registered scene with unchanged export bytes", async () => {
  const { assets } = JSON.parse(await readFile(path.join(root, "assets/coastal/manifest.json"), "utf8"));
  const required = ["terrain", "base", "bridge", "front", "lights", "shallows", "shore"];
  assert.equal(new Set(assets.map(({ id }) => id)).size, assets.length);
  for (const layer of required)
    assert.ok(
      assets.some(({ id }) => id === `mf.coastal.${layer}`),
      layer,
    );
  for (const asset of assets) {
    assert.match(asset.file, /^\/assets\/coastal\/mf\.coastal\.[a-z.-]+\.[a-f0-9]{12}\.png$/);
    const bytes = await readFile(path.join(root, asset.file));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), asset.sha256);
    assert.equal(bytes.length, asset.bytes);
    assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [2560, 1920]);
    assert.equal(bytes[25], 6, "RGBA transparency is part of the occlusion contract");
    assert.deepEqual(asset.sourceSize, [2560, 1920]);
    assert.deepEqual(asset.logicalSize, [1280, 960]);
    assert.deepEqual(asset.groundAnchor, [640, 600]);
    assert.equal(asset.loadStage, "initial");
  }
});
