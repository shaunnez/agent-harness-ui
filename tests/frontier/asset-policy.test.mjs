import assert from "node:assert/strict";
import test from "node:test";
import {
  artDirection,
  featuredProjectId,
  isDetailAsset,
  isInitialAsset,
} from "../../src/frontier/world/asset-policy.ts";

test("cinematic review is explicit and independent of fixture/live data selection", () => {
  assert.equal(artDirection("?mode=fixture&art=cinematic"), "cinematic");
  assert.equal(artDirection("?mode=live&art=cinematic"), "cinematic");
  for (const query of ["", "?art=classic", "?art=unknown", "?mode=cinematic"])
    assert.equal(artDirection(query), "classic");
});

test("agent scenery and detail frames wait for agent entry; the world kit loads initially", () => {
  for (const id of ["mf.terrain.region", "mf.worker.standard.detail.neutral"])
    assert.equal(isDetailAsset({ id }), true);
  assert.equal(isDetailAsset({ id: "mf.cinematic.agent-floor", loadStage: "detail" }), true);
  for (const id of ["mf.terrain.water", "mf.base.standard.floor", "mf.cinematic.island"])
    assert.equal(isDetailAsset({ id }), false);
});

test("the visual study follows project identity through rename and response reordering", () => {
  const first = { id: "first", createdAt: "2026-09-01" };
  const second = { id: "second", createdAt: "2026-09-02" };
  assert.equal(featuredProjectId([second, first]), "first");
  assert.equal(featuredProjectId([{ ...first, name: "Renamed" }, second]), "first");
  assert.equal(featuredProjectId([]), undefined);
});

test("cinematic water does not eagerly transfer the unused original, while shared props stay available", () => {
  assert.equal(isInitialAsset({ id: "mf.terrain.water" }, "classic"), true);
  assert.equal(isInitialAsset({ id: "mf.terrain.water" }, "cinematic"), false);
  assert.equal(isInitialAsset({ id: "mf.prop.purple-tree" }, "cinematic"), true);
  assert.equal(isInitialAsset({ id: "mf.cinematic.worker.portrait" }, "cinematic"), false);
  assert.equal(isInitialAsset({ id: "mf.terrain.region" }, "cinematic"), false);
});
