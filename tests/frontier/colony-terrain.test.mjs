import assert from "node:assert/strict";
import test from "node:test";
import {
  channelWidth,
  colonyBridges,
  colonyContract,
  colonySlot,
  hubSlot,
} from "../../src/frontier/world-3d/colony.ts";
import {
  buildField,
  channelWidthBetween,
  coastRadius,
  heightAt,
  padLevel,
  parcelProfile,
  plateauLevel,
  seaLevel,
  slopeAt,
  surfaceAt,
} from "../../src/frontier/world-3d/terrain-field.ts";

const occupied = ["P1", "P2", "P3"];
const radial = (centre, r, angleDeg) => [
  centre[0] + r * Math.cos((angleDeg * Math.PI) / 180),
  centre[1] + r * Math.sin((angleDeg * Math.PI) / 180),
];

test("Contract 2.0 replaces the circular parcel: tighter pitch, one 27 m span, the landing off to the side", () => {
  assert.equal(colonyContract.version, "2.0.0");
  assert.equal(colonyContract.colony.cellPitch, 90);
  assert.equal(colonyContract.colony.bridge.span, 27);
  assert.deepEqual(colonySlot("P1").world, [0, 0]);
  assert.notDeepEqual(hubSlot.world, [0, 0]);
  assert.ok(!("ring_road" in colonyContract.movement));
  // Three projects read as a chain through the centre cell plus the landing, not spokes around a hub.
  const bridges = colonyBridges(occupied).map((b) => `${b.from}-${b.to}`);
  assert.deepEqual(bridges.sort(), ["H-P1", "H-P2", "P1-P2", "P1-P3"]);
});

test("the height field is flat under every HQ and court apron and level on every built pad", () => {
  const field = buildField(occupied);
  for (const profile of field.profiles) {
    if (profile.hub) continue;
    for (let angle = 0; angle < 360; angle += 15)
      for (const r of [0, 6, 12, 18, 19.5])
        assert.ok(
          Math.abs(heightAt(field, ...radial(profile.centre, r, angle)) - plateauLevel) < 0.02,
          `${profile.id} flat at r ${r} angle ${angle}`,
        );
    // The court apron is flat ground; its front corners may carry a pad kerb (4.0 to 4.25) where a bridge lands.
    for (const [x, z] of [
      [-10, 24],
      [10, 24],
      [0, 20],
      [-12, 15],
      [12, 15],
    ]) {
      const h = heightAt(field, profile.centre[0] + x, profile.centre[1] + z);
      assert.ok(h >= plateauLevel - 0.02 && h <= padLevel + 0.02, `${profile.id} apron at ${x},${z}: ${h}`);
    }
  }
  for (const profile of field.profiles)
    for (const edge of profile.built) {
      for (const r of [28, 29.5, 31]) {
        const sample = surfaceAt(field, ...radial(profile.centre, r, edge.worldAngleDeg));
        assert.ok(
          Math.abs(sample.height - padLevel) < 0.02,
          `${profile.id} ${edge.id} pad at ${r}: ${sample.height}`,
        );
        assert.ok(sample.road > 0.9, `${profile.id} ${edge.id} pad is paving`);
      }
      for (const r of [22, 24, 25])
        assert.ok(
          Math.abs(heightAt(field, ...radial(profile.centre, r, edge.worldAngleDeg)) - plateauLevel) < 0.02,
          `${profile.id} ${edge.id} spur`,
        );
      // The pad's seaward face drops to the water within two metres of the abutment face.
      assert.ok(
        heightAt(field, ...radial(profile.centre, 34, edge.worldAngleDeg)) < seaLevel,
        `${profile.id} ${edge.id} water beyond the pad`,
      );
    }
});

test("coasts are irregular but never block a bridge line, and channels stay open water", () => {
  const field = buildField(occupied);
  for (const profile of field.profiles) {
    const radii = Array.from({ length: 72 }, (_, i) => coastRadius(profile, i * 5));
    const spread = Math.max(...radii) - Math.min(...radii);
    assert.ok(spread > 3, `${profile.id} coast varies by ${spread}`);
    for (const edge of profile.built)
      assert.ok(
        coastRadius(profile, edge.worldAngleDeg) <= colonyContract.terrain.coast.edgeCorridorMax,
        `${profile.id} ${edge.id}`,
      );
    if (!profile.hub)
      for (const angle of [70, 90, 110])
        assert.ok(
          coastRadius(profile, angle) >= colonyContract.terrain.coast.frontArcMin - 0.01,
          `${profile.id} front arc`,
        );
  }
  for (const bridge of colonyBridges(occupied)) {
    const width = channelWidthBetween(field, colonySlot(bridge.from).world, colonySlot(bridge.to).world);
    assert.ok(width >= channelWidth, `${bridge.from}-${bridge.to} channel ${width}`);
  }
});

test("land has relief and cliffs, never exceeds the label anchor, and is deterministic per slot", () => {
  const field = buildField(occupied);
  let highest = -Infinity,
    steepest = 0;
  for (let x = field.bounds.minX; x <= field.bounds.maxX; x += 2.5)
    for (let z = field.bounds.minZ; z <= field.bounds.maxZ; z += 2.5) {
      const h = heightAt(field, x, z);
      highest = Math.max(highest, h);
      if (h > -2 && h < 3.5) steepest = Math.max(steepest, slopeAt(field, x, z));
    }
  assert.ok(highest > plateauLevel + 5, `outcrops rise above the plateau: ${highest}`);
  assert.ok(highest < 15, `nothing reaches the label anchor: ${highest}`);
  assert.ok(steepest > 60, `cliff faces are steep: ${steepest}`);
  const again = parcelProfile("P1", occupied);
  assert.deepEqual(again.outcrops, parcelProfile("P1", occupied).outcrops);
  assert.notDeepEqual(parcelProfile("P1", occupied).outcrops, parcelProfile("P2", occupied).outcrops);
  // Adding a neighbour never changes the land of an existing parcel except on the newly built edge.
  const before = buildField(["P1", "P2"]);
  const after = buildField(["P1", "P2", "P3"]);
  const p2 = colonySlot("P2").world;
  for (let angle = 0; angle < 360; angle += 7)
    for (const r of [10, 22, 27, 33])
      assert.ok(
        Math.abs(heightAt(before, ...radial(p2, r, angle)) - heightAt(after, ...radial(p2, r, angle))) < 1e-9,
      );
});

test("streams are seeded per slot, carve descending channels on a camera-facing flank and fall into the sea clear of every bridge", () => {
  const field = buildField(occupied);
  const withWater = field.profiles.filter((profile) => profile.water);
  assert.ok(
    withWater.length >= 1 && withWater.length < field.profiles.length,
    "some parcels have a stream, some do not",
  );
  assert.equal(parcelProfile("P2", occupied).water, null);
  const edgeAngles = colonyContract.colony.edges.map((edge) => edge.worldAngleDeg);
  const angularGap = (a, b) => Math.abs(((((a - b) % 360) + 540) % 360) - 180);
  for (const profile of withWater) {
    const water = profile.water;
    for (let i = 1; i < water.path.length; i++) {
      assert.ok(water.path[i].bed <= water.path[i - 1].bed + 1e-9, `${profile.id} bed descends`);
      assert.ok(water.path[i].water <= water.path[i - 1].water + 1e-9, `${profile.id} water descends`);
      assert.ok(water.path[i].water > water.path[i].bed, `${profile.id} water above the bed`);
    }
    for (const pool of water.pools) {
      const r = Math.hypot(pool.x, pool.z);
      assert.ok(r - pool.radius > profile.flatRadius + 1.2, `${profile.id} pool clear of the HQ plateau`);
      const ground = heightAt(field, profile.centre[0] + pool.x, profile.centre[1] + pool.z);
      assert.ok(
        ground < pool.water && ground > pool.bed - 0.05,
        `${profile.id} pool is cut into the land: ${ground}`,
      );
    }
    for (const edge of edgeAngles)
      assert.ok(
        angularGap(water.fall.angleDeg, edge) >= 19,
        `${profile.id} fall ${water.fall.angleDeg} near edge ${edge}`,
      );
    const lip = heightAt(field, profile.centre[0] + water.fall.x, profile.centre[1] + water.fall.z);
    assert.ok(lip < water.fall.top && lip > seaLevel + 1, `${profile.id} lip cut at ${lip}`);
    assert.ok(
      heightAt(field, profile.centre[0] + water.fall.base[0], profile.centre[1] + water.fall.base[1]) <
        seaLevel,
      `${profile.id} fall lands in the sea`,
    );
    // The world and exterior cameras look from +x, +z: the fall is on a flank they see.
    const a = (water.fall.angleDeg * Math.PI) / 180;
    assert.ok(0.6 * Math.cos(a) + 0.8 * Math.sin(a) > -0.25, `${profile.id} fall faces the camera side`);
  }
});
