import assert from "node:assert/strict";
import test from "node:test";
import { colonyStressFixtures } from "../../src/frontier/fixtures/colony.ts";
import { colonyEdges, projectKey } from "../../src/frontier/world-3d/colony.ts";
import {
  corridorDistance,
  scatterFingerprint,
  scatterItems,
  scatterLayout,
  scatterRules,
} from "../../src/frontier/world-3d/scatter.ts";

test("scatter layouts are seeded per project: stable across reloads, distinct across ten parcels", () => {
  const { projects } = colonyStressFixtures();
  const layouts = projects.map((project) => scatterLayout(projectKey(project)));
  assert.equal(layouts.length, 10);
  for (const [index, project] of projects.entries())
    assert.deepEqual(scatterLayout(projectKey(project)), layouts[index], `${project.id} is stable`);
  assert.equal(new Set(layouts.map(scatterFingerprint)).size, 10);
  // The hub has its own, also stable, arrangement.
  assert.deepEqual(scatterLayout("H", { hub: true }), scatterLayout("H", { hub: true }));
  assert.notDeepEqual(scatterLayout("H", { hub: true }), scatterLayout("H"));
});

test("purple clusters stay outside r34, out of every spur corridor and off the front arc", () => {
  const { projects } = colonyStressFixtures();
  for (const project of projects) {
    const placements = scatterLayout(projectKey(project));
    const trees = placements.filter((p) => p.kind === "tree");
    assert.ok(trees.length >= scatterRules.clusterSize[0], `${project.id} has a copse`);
    assert.ok(
      trees.some((p) => p.item.includes("Purple")),
      `${project.id} has purple trees`,
    );
    for (const tree of trees) {
      const r = Math.hypot(tree.x, tree.z);
      assert.ok(r >= 34 && r <= scatterRules.maxTreeRadius, `${project.id} tree radius ${r}`);
      assert.ok(
        corridorDistance(tree.x, tree.z) >= scatterRules.corridorHalfWidth,
        `${project.id} tree in a corridor`,
      );
      const angle = ((Math.atan2(tree.z, tree.x) * 180) / Math.PI + 360) % 360;
      assert.ok(
        angle < scatterRules.frontArcDeg[0] || angle > scatterRules.frontArcDeg[1],
        `${project.id} tree in front arc`,
      );
    }
    for (const placement of placements) {
      assert.ok(scatterItems.includes(placement.item), placement.item);
      assert.ok(Number.isFinite(placement.rotation) && placement.scale > 0);
    }
    assert.equal(placements.filter((p) => p.kind === "lantern").length, 6);
    assert.equal(placements.filter((p) => p.kind === "vehicle").length, 2);
    for (const vehicle of placements.filter((p) => p.kind === "vehicle")) {
      const r = Math.hypot(vehicle.x, vehicle.z);
      assert.ok(r > 27.5 && r < 32.5, `${project.id} vehicle parks on the ring road`);
    }
    assert.ok(placements.filter((p) => p.kind === "boulder").length >= 5);
  }
});

test("corridor distance measures from the spur centre lines only beyond the ring road", () => {
  // On a spur's own line beyond the ring road the distance is zero; inside the ring it is unbounded.
  const edge = colonyEdges[0];
  const a = (edge.worldAngleDeg * Math.PI) / 180;
  assert.ok(corridorDistance(36 * Math.cos(a), 36 * Math.sin(a)) < 1e-9);
  assert.ok(corridorDistance(10 * Math.cos(a), 10 * Math.sin(a)) > 50);
  const side = [36 * Math.cos(a) - 6 * Math.sin(a), 36 * Math.sin(a) + 6 * Math.cos(a)];
  assert.ok(Math.abs(corridorDistance(side[0], side[1]) - 6) < 0.01);
});
