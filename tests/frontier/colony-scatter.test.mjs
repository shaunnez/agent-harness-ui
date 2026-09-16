import assert from "node:assert/strict";
import test from "node:test";
import { colonyStressFixtures } from "../../src/frontier/fixtures/colony.ts";
import { colonyEdges, hubSlot, projectKey, projectSlots } from "../../src/frontier/world-3d/colony.ts";
import {
  corridorDistance,
  scatterFingerprint,
  scatterItems,
  scatterLayout,
  scatterRules,
} from "../../src/frontier/world-3d/scatter.ts";
import { buildField, coastRadius, heightAt, slopeAt } from "../../src/frontier/world-3d/terrain-field.ts";

const { projects } = colonyStressFixtures();
const slots = projectSlots.slice(0, projects.length).map((slot) => slot.id);
const field = buildField(slots);
function groundFor(slotId) {
  const profile = field.profiles.find((entry) => entry.id === slotId);
  const [cx, cz] = profile.centre;
  return {
    hub: profile.hub,
    flatRadius: profile.flatRadius,
    coast: (angle) => coastRadius(profile, angle),
    ground: (x, z) => ({ height: heightAt(field, cx + x, cz + z), slope: slopeAt(field, cx + x, cz + z) }),
    builtEdgeAngles: profile.built.map((edge) => edge.worldAngleDeg),
  };
}
const layoutFor = (project, index) => scatterLayout(projectKey(project), groundFor(slots[index]));

test("scatter layouts are seeded per project: stable across reloads, distinct across ten parcels", () => {
  const layouts = projects.map(layoutFor);
  assert.equal(layouts.length, 10);
  for (const [index, project] of projects.entries())
    assert.deepEqual(layoutFor(project, index), layouts[index], `${project.id} is stable`);
  assert.equal(new Set(layouts.map(scatterFingerprint)).size, 10);
  const hub = groundFor(hubSlot.id);
  assert.deepEqual(scatterLayout("H", hub), scatterLayout("H", hub));
  assert.notDeepEqual(scatterLayout("H", hub), scatterLayout("H", { ...hub, hub: false }));
});

test("purple copses stand on the shoulder: off the flat ground, short of the lip, out of corridors and the front arc", () => {
  for (const [index, project] of projects.entries()) {
    const ground = groundFor(slots[index]);
    const placements = layoutFor(project, index);
    const trees = placements.filter((p) => p.kind === "tree");
    assert.ok(trees.length >= scatterRules.clusterSize[0], `${project.id} has a copse (${trees.length})`);
    assert.ok(
      trees.some((p) => p.item.includes("Purple")),
      `${project.id} has purple trees`,
    );
    for (const tree of trees) {
      const r = Math.hypot(tree.x, tree.z);
      const angle = ((Math.atan2(tree.z, tree.x) * 180) / Math.PI + 360) % 360;
      assert.ok(
        r >= ground.flatRadius + scatterRules.treeInset[0] - 1e-9,
        `${project.id} tree on the flat ground r ${r}`,
      );
      assert.ok(
        r <= ground.coast(angle) - scatterRules.treeInset[1] + 1e-9,
        `${project.id} tree over the lip r ${r}`,
      );
      assert.ok(
        corridorDistance(tree.x, tree.z, ground.flatRadius) >= scatterRules.corridorHalfWidth,
        `${project.id} tree in a corridor`,
      );
      assert.ok(
        angle < scatterRules.frontArcDeg[0] || angle > scatterRules.frontArcDeg[1],
        `${project.id} tree in front arc`,
      );
      const at = ground.ground(tree.x, tree.z);
      assert.ok(
        at.height >= scatterRules.treeMinHeight && at.slope <= scatterRules.treeMaxSlopeDeg,
        `${project.id} tree on rock face`,
      );
    }
    for (const placement of placements) {
      assert.ok(scatterItems.includes(placement.item), placement.item);
      assert.ok(Number.isFinite(placement.rotation) && placement.scale > 0);
    }
    const lanterns = placements.filter((p) => p.kind === "lantern");
    assert.equal(lanterns.length, 4 + 2 * ground.builtEdgeAngles.length, `${project.id} lanterns`);
    const vehicles = placements.filter((p) => p.kind === "vehicle");
    assert.equal(vehicles.length, 2);
    for (const vehicle of vehicles) {
      assert.ok(
        Math.abs(vehicle.x) > 8 && Math.abs(vehicle.x) < 10.5,
        `${project.id} vehicle on the apron x ${vehicle.x}`,
      );
      assert.ok(
        vehicle.z > scatterRules.apron.z[0] && vehicle.z < scatterRules.apron.z[1],
        `${project.id} vehicle on the apron z ${vehicle.z}`,
      );
    }
    assert.ok(placements.filter((p) => p.kind === "boulder").length >= 5, `${project.id} boulders`);
  }
});

test("corridor distance measures from the spur centre lines only beyond the flat ground", () => {
  const edge = colonyEdges[0];
  const a = (edge.worldAngleDeg * Math.PI) / 180;
  assert.ok(corridorDistance(26 * Math.cos(a), 26 * Math.sin(a)) < 1e-9);
  assert.ok(corridorDistance(10 * Math.cos(a), 10 * Math.sin(a)) > 50);
  const side = [26 * Math.cos(a) - 6 * Math.sin(a), 26 * Math.sin(a) + 6 * Math.cos(a)];
  assert.ok(Math.abs(corridorDistance(side[0], side[1]) - 6) < 0.01);
});
