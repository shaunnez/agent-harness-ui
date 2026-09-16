import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  assignSlots,
  colonyBridges,
  colonySlot,
  builtEdges,
  slotPosition,
  projectKey,
  cameraElevationDeg,
  colonyCameras,
} from "../../src/frontier/world-3d/colony.ts";
import { allocateSockets, roomForStage, roomForTask } from "../../src/frontier/world-3d/rooms.ts";
import { clearStandingPoint } from "../../src/frontier/world-3d/room-clearance.ts";
import { proofWorkers, parseProofManifest, visibleWorkerLabels } from "../../src/frontier/world-3d/model.ts";
import { proofAssetUrls } from "../../src/frontier/world-3d/colony-assets.ts";
import { colonyStressFixtures } from "../../src/frontier/fixtures/colony.ts";
import { projectBases } from "../../src/frontier/world-3d/layout.ts";
import { parseAppearances } from "../../src/frontier/world-3d/appearance.ts";

const exported = JSON.parse(
  await readFile(new URL("../../public/frontier/assets/3d-proof/manifest.json", import.meta.url), "utf8"),
);
const manifest = parseProofManifest({
  ...exported,
  version: 3,
  colony: exported.colony ?? { contract: "/assets/3d-proof/colony-contract.json" },
});
const fixtures = colonyStressFixtures();
const input = {
  mode: "fixture",
  ...fixtures,
  location: { view: "project", projectId: "plancheck" },
  selectedId: null,
  connected: true,
  motion: true,
  idleRoaming: false,
  watchedRunActive: false,
};

test("colony slots persist across reorder/archive, remain distinct, and extend beyond ring two", () => {
  const projects = Array.from({ length: 40 }, (_, i) => ({
    id: `project-${i}`,
    repositoryPath: `/sample/${i}`,
    createdAt: String(i).padStart(3, "0"),
  }));
  const saved = assignSlots(projects);
  assert.equal(Object.keys(saved).length, 40);
  assert.equal(new Set(Object.values(saved)).size, 40);
  assert.deepEqual(assignSlots([...projects].reverse(), saved), saved);
  assert.deepEqual(assignSlots(projects.slice(1), saved), saved);
  assert.equal(colonySlot("P19").ring, 3);
  assert.equal(colonySlot("P37").ring, 4);
  assert.deepEqual(
    parseAppearances({ version: 1, projects: { p: { variant: "command", palette: "blue", slot: "P40" } } }).p
      .slot,
    "P40",
  );
  for (const [i, a] of Object.values(saved).entries())
    for (const b of Object.values(saved).slice(i + 1)) {
      const aa = slotPosition(a),
        bb = slotPosition(b);
      assert.ok(Math.hypot(aa[0] - bb[0], aa[2] - bb[2]) > 107.9);
    }
  const bridges = colonyBridges(Object.values(saved));
  for (const id of Object.values(saved)) assert.ok(bridges.some((b) => b.from === id || b.to === id));
  assert.throws(() => slotPosition("bad"));
  assert.equal(saved[projectKey(projects[0])], "P1");
});
test("three bases connect only to hub and hidden spurs track actual neighbors", () => {
  assert.equal(colonyBridges(["P1", "P2", "P3"]).length, 3);
  assert.equal(builtEdges("H", ["P1", "P2", "P3"]).size, 3);
  assert.equal(builtEdges("P1", ["P1", "P2", "P3"]).size, 1);
  assert.ok(colonyBridges(Array.from({ length: 10 }, (_, i) => `P${i + 1}`)).length > 10);
  assert.ok(Math.abs(cameraElevationDeg(colonyCameras.cutaway) - 40) < 0.1);
  assert.ok(Math.abs(cameraElevationDeg(colonyCameras.exterior) - 28.4) < 0.1);
});
test("room mapping honors every stage and only delivered status moves a task to dispatch", () => {
  const map = {
    triage: "briefing",
    scouts: "briefing",
    grill: "briefing",
    specification: "planning",
    plan: "planning",
    implement: "implementation",
    "dev-review": "review",
    test: "testing",
    "final-review": "review",
    approval: "review",
  };
  for (const [stage, room] of Object.entries(map)) {
    assert.equal(roomForStage(stage), room);
    assert.equal(roomForTask({ stage, status: "blocked" }), room);
  }
  assert.equal(roomForTask({ stage: "approval", status: "awaiting-pr-merge" }), "dispatch");
});
test("strict allocation fills implementation, hub then court without losing parallel workers", () => {
  const requests = Array.from({ length: 14 }, (_, i) => ({
    id: `task${i}`,
    room: "implementation",
    workers: i < 3 ? 2 : 1,
  }));
  const result = allocateSockets(requests);
  assert.equal(result.workers.length, 17);
  assert.ok(result.workers.some((w) => w.socket.id.startsWith("hq_hub")));
  assert.ok(result.workers.some((w) => w.socket.id.startsWith("court")));
  for (const [i, worker] of result.workers.entries()) {
    assert.equal(clearStandingPoint(worker.socket.position, worker.socket.id), true);
    for (const other of result.workers.slice(i + 1))
      assert.ok(
        Math.hypot(
          worker.socket.position[0] - other.socket.position[0],
          worker.socket.position[2] - other.socket.position[2],
        ) >=
          3.3 - 1e-9,
      );
  }
  assert.deepEqual(allocateSockets(requests), result);
  const briefing = allocateSockets([{ id: "a", room: "briefing", workers: 3 }]);
  assert.ok(!briefing.workers.some((w) => w.socket.id === "hq_briefing_02"));
  assert.throws(
    () => allocateSockets([{ id: "too-many", room: "implementation", workers: 300 }]),
    /no clear standing position/,
  );
});
test("colony stress has ten projects and fourteen open tasks; packages preserve task and watch identities", () => {
  assert.equal(fixtures.projects.length, 10);
  assert.equal(
    fixtures.tasks.filter((t) => t.repositoryPath === fixtures.projects[0].repositoryPath).length,
    14,
  );
  const workers = proofWorkers(input, manifest);
  assert.equal(workers.length, 17);
  assert.equal(new Set(workers.map((w) => w.id)).size, 17);
  assert.equal(visibleWorkerLabels(workers, input, null).length, 14);
  const watch = proofWorkers(
    {
      ...input,
      location: { view: "agent", taskId: "COL-001" },
      watchedStage: "plan",
      watchedRunStatus: "completed",
    },
    manifest,
  );
  const historical = watch.filter((w) => w.task.id === "COL-001");
  assert.equal(historical.length, 1);
  assert.equal(historical[0].behavior, "park");
  assert.equal(historical[0].room, "planning");
  assert.ok(proofWorkers({ ...input, motion: false }, manifest).every((w) => !w.moving));
  assert.ok(
    proofWorkers({ ...input, connected: false }, manifest).every((w) => w.behavior === "park" && !w.moving),
  );
  const archived = { ...fixtures.projects[0], archivedAt: "2026-09-16" };
  const bases = projectBases([archived], {}, true);
  assert.equal(bases.length, 1);
  assert.equal(proofWorkers({ ...input, projects: [archived] }, manifest, bases).length, 0);
});
test("v3 accepts partial greybox assets, rejects unsafe references, and downloads shared colony sources once", () => {
  const value = {
    ...manifest,
    colony: {
      contract: "/assets/3d-proof/contract.json",
      shell: "/assets/3d-proof/hq-shell.glb",
      crowns: { command: "/assets/3d-proof/crown.glb" },
      parcelHub: "/assets/3d-proof/parcel.glb",
      parcelA: "/assets/3d-proof/parcel.glb",
    },
  };
  assert.equal(parseProofManifest(value).version, 3);
  assert.equal(new Set(proofAssetUrls(value)).size, proofAssetUrls(value).length);
  assert.ok(!proofAssetUrls(value).includes(value.scene));
  assert.throws(() =>
    parseProofManifest({ ...value, colony: { ...value.colony, shell: "https://example.com/evil.glb" } }),
  );
  assert.throws(() => parseProofManifest({ ...value, colony: { ...value.colony, contract: "/other.json" } }));
  assert.throws(() =>
    parseProofManifest({ ...value, colony: { ...value.colony, hqLightPositions: [[0, NaN, 0]] } }),
  );
  assert.equal(parseProofManifest({ ...manifest, version: 2 }).version, 2);
});

test("every bridge reaches the opposite face within 5cm through ring three", () => {
  for (const bridge of colonyBridges(Array.from({ length: 30 }, (_, i) => `P${i + 1}`))) {
    const angle = (bridge.worldAngleDeg * Math.PI) / 180;
    assert.ok(
      Math.hypot(
        bridge.start[0] + 27 * Math.cos(angle) - bridge.end[0],
        bridge.start[1] + 27 * Math.sin(angle) - bridge.end[1],
      ) < 0.05,
      `${bridge.from}-${bridge.to}`,
    );
  }
});
