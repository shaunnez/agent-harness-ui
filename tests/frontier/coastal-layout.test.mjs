import assert from "node:assert/strict";
import test from "node:test";
import {
  coastalJoint,
  coastalSegment,
  coastalSite,
  projectConnections,
} from "../../src/frontier/world/coastal-layout.ts";

const projects = [
  { id: "plancheck", position: { x: 280, y: 610 } },
  { id: "harness", position: { x: 340, y: 120 } },
  { id: "strata", position: { x: 1090, y: 560 } },
];
test("coastal art joins the actual existing route without relocating projects", () => {
  const before = structuredClone(projects);
  const site = coastalSite(projects, "plancheck");
  assert.deepEqual(site?.entrance, { x: 280, y: 620 });
  assert.deepEqual(site?.join, { x: 800, y: 360 });
  assert.equal(projectConnections(projects).length, 2);
  assert.deepEqual(projects, before);
  assert.equal(coastalSegment({ x: 747.2, y: 386.4 }, { x: 280, y: 620 }, site), true);
  assert.equal(coastalSegment({ x: 340, y: 130 }, { x: 747.2, y: 333.6 }, site), false);
  assert.equal(coastalSegment({ x: 280, y: 620 }, { x: 600, y: 780 }, site), false);
  assert.equal(coastalJoint({ x: 800, y: 360 }, site), true);
});
test("saved and variable layouts retain infrastructure unless the measured connection exists", () => {
  assert.equal(coastalSite([], "plancheck"), null);
  assert.equal(coastalSite(projects.slice(0, 1), "plancheck"), null);
  assert.equal(coastalSite(projects, "harness"), null);
  const changed = structuredClone(projects);
  changed[1].position.x += 50;
  assert.equal(coastalSite(changed, "plancheck"), null);
  assert.equal(coastalSegment({ x: 0, y: 0 }, { x: 100, y: 50 }, null), false);
  const shifted = projects.map(({ id, position }) => ({
    id,
    position: { x: position.x + 900, y: position.y - 300 },
  }));
  assert.ok(
    coastalSite(shifted, "plancheck"),
    "Absolute coordinates do not bind the artwork to fixture identities",
  );
});
