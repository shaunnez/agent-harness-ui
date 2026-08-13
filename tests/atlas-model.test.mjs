import assert from "node:assert/strict";
import test from "node:test";
import {
  atlasConnections,
  atlasRepairRoads,
  atlasRoads,
  atlasRooms,
  getAtlasTransitionPath,
  getAtlasStatusLabel,
  getAtlasTaskTone,
  getPackageOverview,
} from "../src/components/atlas/atlasModel.ts";

test("atlas renders the ten canonical workflow rooms once and in order", () => {
  assert.deepEqual(
    atlasRooms.map((room) => room.stageId),
    [
      "triage",
      "scouts",
      "grill",
      "specification",
      "plan",
      "implement",
      "dev-review",
      "test",
      "final-review",
      "approval",
    ],
  );
  assert.equal(new Set(atlasRooms.map((room) => room.stageId)).size, 10);
  assert.equal(new Set(atlasRooms.map((room) => room.roomName)).size, 10);
  assert.equal(atlasConnections.length, 9);
  assert.deepEqual(atlasConnections[5], ["implement", "dev-review"]);
  assert.deepEqual(atlasConnections[8], ["final-review", "approval"]);
  assert.equal(atlasRoads.length, 9);
  assert.deepEqual(
    atlasRepairRoads.map((road) => road.from),
    ["dev-review", "test"],
  );
  assert.deepEqual(getAtlasTransitionPath("implement", "dev-review"), atlasRoads[5].points);
  assert.deepEqual(getAtlasTransitionPath("dev-review", "implement"), atlasRepairRoads[0].points);
  assert.deepEqual(getAtlasTransitionPath("approval", "dev-review"), []);
});

test("package summary scales from one package to more than four without fixed slots", () => {
  const packageWith = (id, batch, status) => ({ id, batch, status });
  assert.deepEqual(getPackageOverview([packageWith("S1", 1, "planned")]), {
    total: 1,
    active: 0,
    blocked: 0,
    ready: 0,
    integrated: 0,
    queued: 1,
    batches: 1,
  });
  assert.deepEqual(
    getPackageOverview([
      packageWith("S1", 1, "integrated"),
      packageWith("S2", 2, "ready_for_integration"),
      packageWith("S3", 2, "running"),
      packageWith("S4", 2, "failed"),
      packageWith("S5", 3, "planned"),
      packageWith("S6", 3, "planned"),
      packageWith("S7", 4, "running"),
    ]),
    { total: 7, active: 2, blocked: 1, ready: 1, integrated: 1, queued: 2, batches: 4 },
  );
});

test("task tones make blocked and human-attention states explicit", () => {
  assert.equal(getAtlasTaskTone({ status: "running", activeRunIds: ["RUN-1"] }), "running");
  assert.equal(getAtlasTaskTone({ status: "running", activeRunIds: [] }), "attention");
  assert.equal(getAtlasTaskTone({ status: "repair-required" }), "blocked");
  assert.equal(getAtlasTaskTone({ status: "awaiting-human-approval" }), "attention");
  assert.equal(getAtlasTaskTone({ status: "completed" }), "complete");
  assert.equal(getAtlasStatusLabel({ status: "awaiting-grill" }), "Needs input");
  assert.equal(getAtlasStatusLabel({ status: "queued" }), "Queued");
  assert.equal(getAtlasStatusLabel({ status: "repair-required" }), "Repair required");
});
