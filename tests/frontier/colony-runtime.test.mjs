import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { colonyStressFixtures } from "../../src/frontier/fixtures/colony.ts";
import { assignMissingAppearances, parseAppearances } from "../../src/frontier/world-3d/appearance.ts";
import {
  assignSlots,
  builtEdges,
  cameraElevationDeg,
  colonyBridges,
  colonyCameras,
  colonySlot,
  projectKey,
  slotPosition,
} from "../../src/frontier/world-3d/colony.ts";
import { proofAssetUrls } from "../../src/frontier/world-3d/colony-assets.ts";
import { projectBases } from "../../src/frontier/world-3d/layout.ts";
import {
  parseProofManifest,
  proofWorkerState,
  proofWorkers,
  visibleWorkerLabels,
} from "../../src/frontier/world-3d/model.ts";
import { clearStandingPoint } from "../../src/frontier/world-3d/room-clearance.ts";
import { allocateSockets, roomForStage, roomForTask } from "../../src/frontier/world-3d/rooms.ts";

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
      assert.ok(Math.hypot(aa[0] - bb[0], aa[2] - bb[2]) > 89.9);
    }
  const bridges = colonyBridges(Object.values(saved));
  for (const id of Object.values(saved)) assert.ok(bridges.some((b) => b.from === id || b.to === id));
  assert.throws(() => slotPosition("bad"));
  assert.equal(saved[projectKey(projects[0])], "P1");
});
test("three bases read as a chain through the centre cell, with the landing terrace off to the side", () => {
  assert.equal(colonyBridges(["P1", "P2", "P3"]).length, 4);
  assert.equal(builtEdges("H", ["P1", "P2", "P3"]).size, 2);
  assert.equal(builtEdges("P1", ["P1", "P2", "P3"]).size, 3);
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
  // Inside a base every robot is labelled, package robots included, so no agent stands in a room
  // unidentified. The World overview still collapses to one card per project.
  assert.equal(visibleWorkerLabels(workers, input, null).length, 17);
  assert.equal(visibleWorkerLabels(workers, { ...input, location: { view: "world" } }, null).length, 1);
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

test("over-capacity fixture reports a preview problem without throwing or mutating tasks", () => {
  const source = fixtures.tasks.find((task) => task.id === "COL-001");
  const tasks = Array.from({ length: 300 }, (_, i) => ({ ...source, id: `over-${i}`, workPackages: [] }));
  const state = { ...input, tasks };
  const before = structuredClone(tasks);
  const result = proofWorkerState(state, manifest, projectBases(fixtures.projects));
  assert.match(result.problem, /no clear standing position/);
  assert.deepEqual(result.workers, []);
  assert.deepEqual(tasks, before);
});

test("bounded shoreline sampling retains exact coast/land values across separate parcels", async () => {
  const { createCoastalWater, shoreDistance } = await import("../../src/frontier/world-3d/water.ts");
  const loops = [
    [
      [0, 0],
      [12, 0],
      [12, 12],
      [0, 12],
      [0, 0],
    ],
    [
      [200, 200],
      [212, 200],
      [212, 212],
      [200, 212],
      [200, 200],
    ],
  ];
  const water = createCoastalWater(loops),
    size = water.texture.image.width,
    bytes = water.texture.image.data;
  for (let row = 0; row < size; row += 31)
    for (let col = 0; col < size; col += 29) {
      const x = (col / (size - 1)) * water.uniforms.uShoreSpan.value.x + water.uniforms.uShoreMin.value.x;
      const z = (row / (size - 1)) * water.uniforms.uShoreSpan.value.y + water.uniforms.uShoreMin.value.y;
      const expected = shoreDistance(x, z, loops),
        offset = (row * size + col) * 4;
      assert.equal(bytes[offset], Math.round(Math.min(1, expected.distance / 40) * 255));
      assert.equal(bytes[offset + 1], expected.land ? 255 : 0);
    }
  water.material.dispose();
  water.texture.dispose();
});

test("duplicate stored slots are repaired deterministically before laying out project bases", () => {
  const projects = fixtures.projects.slice(0, 2);
  const saved = Object.fromEntries(
    projects.map((project) => [projectKey(project), { variant: "command", palette: "blue", slot: "P1" }]),
  );
  const bases = projectBases(projects, saved, true);
  assert.equal(new Set(bases.map((base) => base.slot)).size, 2);
  const repaired = assignMissingAppearances(projects, saved);
  assert.equal(repaired[projectKey(projects[0])].slot, "P1");
  assert.equal(repaired[projectKey(projects[1])].slot, "P2");
  assert.equal(repaired[projectKey(projects[1])].palette, "blue");
});

test("four crowns render on one shell and a missing crown falls back to Command", async () => {
  const { Group } = await import("three");
  const { colonyModels } = await import("../../src/frontier/world-3d/colony-assets.ts");
  const { baseVariants } = await import("../../src/frontier/world-3d/appearance.ts");
  const named = (name) => {
    const group = new Group();
    group.name = name;
    return group;
  };
  const value = {
    ...manifest,
    colony: {
      contract: "/assets/3d-proof/contract.json",
      shell: "/assets/3d-proof/hq-shell.glb",
      crowns: {
        bastion: "/assets/3d-proof/crown-bastion.glb",
        command: "/assets/3d-proof/crown-command.glb",
        relay: "/assets/3d-proof/crown-relay.glb",
        foundry: "/assets/3d-proof/crown-foundry.glb",
      },
      crownPreviews: { bastion: "/assets/3d-proof/crown-preview-bastion.png" },
      parcelHub: "/assets/3d-proof/parcel-hub.glb",
      parcelA: "/assets/3d-proof/parcel-a.glb",
      bridgeSpan: "/assets/3d-proof/bridge-span-27.glb",
      bridgeEnd: "/assets/3d-proof/bridge-end.glb",
    },
  };
  assert.equal(parseProofManifest(value).version, 3);
  assert.throws(() =>
    parseProofManifest({
      ...value,
      colony: { ...value.colony, crownPreviews: { relay: "https://example.com/relay.png" } },
    }),
  );
  const urls = proofAssetUrls(value);
  assert.equal(urls.filter((url) => url.includes("crown-")).length, 4);
  const loaded = new Map(urls.map((url) => [url, named(url.split("/").pop())]));
  const models = colonyModels(value, loaded);
  assert.deepEqual(Object.keys(models.bases).sort(), [...baseVariants].sort());
  for (const variant of baseVariants) {
    const [shell, crown] = models.bases[variant].children;
    assert.equal(shell.name, "hq-shell.glb", `${variant} shares the shell`);
    assert.equal(crown.name, `crown-${variant}.glb`, `${variant} wears its own crown`);
  }
  assert.equal(models.owned.length, 0);
  // Without a Relay crown the Relay pick still renders (Command crown) rather than failing.
  const partial = { ...value, colony: { ...value.colony, crowns: { command: value.colony.crowns.command } } };
  const fallback = colonyModels(
    partial,
    new Map(proofAssetUrls(partial).map((url) => [url, named(url.split("/").pop())])),
  );
  assert.equal(fallback.bases.relay.children[1].name, "crown-command.glb");
});

test("one room table serves every crown: room assignment never reads the building variant", async () => {
  const { roomForTask, allocateSockets } = await import("../../src/frontier/world-3d/rooms.ts");
  const { baseVariants } = await import("../../src/frontier/world-3d/appearance.ts");
  const requests = [
    { id: "a", room: roomForTask({ status: "running", stage: "implement" }), workers: 2 },
    { id: "b", room: roomForTask({ status: "running", stage: "dev-review" }), workers: 1 },
    { id: "c", room: roomForTask({ status: "completed", stage: "implement" }), workers: 1 },
  ];
  const reference = allocateSockets(requests);
  assert.equal(reference.workers.length, 4);
  // The allocation has no variant input at all; every crown shares the same sockets and overflow.
  for (const variant of baseVariants) assert.deepEqual(allocateSockets(requests), reference, variant);
});
