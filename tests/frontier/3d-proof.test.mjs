import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fixtureProjects, makeFixtureTasks } from "../../src/frontier/fixtures/scenarios.ts";
import {
  assignMissingAppearances,
  baseVariants,
  parseAppearances,
  projectAppearanceKey,
  randomAppearance,
  readAppearances,
  saveAppearance,
} from "../../src/frontier/world-3d/appearance.ts";
import { separateLabels } from "../../src/frontier/world-3d/labels.ts";
import { projectBases, translated, viewCamera } from "../../src/frontier/world-3d/layout.ts";
import {
  existingWorldUrl,
  parseProofManifest,
  proofVisible,
  proofWorkers,
  visibleWorkerLabels,
} from "../../src/frontier/world-3d/model.ts";
import { shoreDistance } from "../../src/frontier/world-3d/water.ts";

const manifest = parseProofManifest(
  JSON.parse(
    await readFile(new URL("../../public/frontier/assets/3d-proof/manifest.json", import.meta.url), "utf8"),
  ),
);
const input = (changes = {}) => ({
  mode: "fixture",
  projects: fixtureProjects,
  tasks: makeFixtureTasks(),
  location: { view: "world", projectId: null, taskId: null, runId: null },
  selectedId: "PC-142",
  connected: true,
  motion: true,
  idleRoaming: true,
  watchedRunActive: false,
  ...changes,
});
const search = "?mode=fixture&scenario=workflow&renderer=3d";

test("3D preview admits each fixture project while remaining opt-in and excluding live data", () => {
  assert.equal(proofVisible(search, input()), true);
  assert.equal(proofVisible("?mode=fixture", input()), false);
  assert.equal(proofVisible("?mode=live&renderer=3d", input({ mode: "live" })), false);
  assert.equal(proofVisible(search, input({ mode: "live" })), false);
  assert.equal(proofVisible(search, input({ location: { view: "project", projectId: "harness" } })), true);
  assert.equal(proofVisible(search, input({ location: { view: "agent", taskId: "AH-051" } })), true);
  assert.equal(proofVisible(search, input({ location: { view: "project", projectId: "plancheck" } })), true);
  assert.equal(proofVisible(search, input({ projects: [] })), false);
  assert.equal(existingWorldUrl(search), "?mode=fixture&scenario=workflow#world");
});

test("workers preserve running, answer, repair and completed distinctions without changing fixture data", () => {
  const scene = input();
  const before = structuredClone(scene);
  const workers = proofWorkers(scene, manifest);
  assert.deepEqual(
    workers
      .filter((worker) => worker.projectId === "plancheck")
      .map(({ task }) => task.id)
      .sort(),
    ["PC-142", "PC-148", "PC-153"],
  );
  assert.equal(new Set(workers.map((worker) => worker.projectId)).size, fixtureProjects.length);
  assert.equal(workers.find(({ task }) => task.id === "PC-142").behavior, "work");
  assert.equal(workers.find(({ task }) => task.id === "PC-148").behavior, "park");
  assert.equal(workers.find(({ task }) => task.id === "PC-153").behavior, "park");
  const completed = scene.tasks.find(
    (task) => task.repositoryPath === fixtureProjects[0].repositoryPath && task.status === "completed",
  );
  assert.ok(completed);
  const selected = proofWorkers({ ...scene, selectedId: completed.id }, manifest).find(
    ({ task }) => task.id === completed.id,
  );
  assert.equal(selected.behavior, "park");
  assert.equal(selected.moving, false);
  assert.deepEqual(scene, before);
});

test("historical Watch parks only that worker; active sibling evidence remains authoritative", () => {
  const scene = input({
    location: { view: "agent", taskId: "PC-142", runId: "R-PC-142-plan-1" },
    watchedRunActive: false,
    watchedStage: "plan",
    watchedRunStatus: "completed",
  });
  const watched = proofWorkers(scene, manifest).find(({ task }) => task.id === "PC-142");
  assert.equal(watched.behavior, "park");
  assert.equal(watched.stage, "plan");
  assert.match(watched.detail, /completed/);
  const unavailable = proofWorkers({ ...scene, watchedRunStatus: null }, manifest).find(
    ({ task }) => task.id === "PC-142",
  );
  assert.equal(unavailable.detail, "Run details unavailable");
  assert.equal(unavailable.moving, false);
  const running = scene.tasks.find((task) => task.id === "PC-142");
  running.status = "blocked";
  running.attention = { kind: "blocked", label: "Sibling package waiting", stage: "implement" };
  const overview = proofWorkers({ ...scene, location: { view: "world" } }, manifest).find(
    ({ task }) => task.id === running.id,
  );
  assert.equal(overview.behavior, "work");
  assert.equal(overview.tone, "blocked");
});

test("connection and motion admission stop every worker loop, without inventing task completion", () => {
  const disconnected = proofWorkers(input({ connected: false }), manifest);
  assert.ok(disconnected.every((worker) => worker.behavior === "park" && !worker.moving));
  assert.ok(disconnected.every((worker) => worker.detail === "Connection unknown"));
  const paused = proofWorkers(input({ motion: false }), manifest);
  assert.ok(paused.every((worker) => !worker.moving));
  assert.equal(paused.find(({ task }) => task.id === "PC-142").behavior, "work");
});

test("idle workers use the outdoor court height in the cutaway, while work remains inside", () => {
  const scene = input({ location: { view: "project", projectId: "plancheck" } });
  const task = scene.tasks.find((entry) => entry.id === "PC-142");
  task.status = "created";
  task.activeRunIds = [];
  task.activeRunKind = null;
  task.attention = { kind: "idle", stage: "implement", label: "Idle" };
  const worker = proofWorkers(scene, manifest).find((entry) => entry.task.id === task.id);
  assert.equal(worker.behavior, "roam");
  assert.deepEqual(
    worker.position,
    translated(
      manifest.sockets.court_implement,
      projectBases(scene.projects).find((base) => base.project.id === "plancheck").position,
    ),
  );
  const frozen = proofWorkers({ ...scene, motion: false }, manifest).find(
    (entry) => entry.task.id === task.id,
  );
  assert.equal(frozen.moving, false);
  assert.equal(frozen.behavior, "roam");
});

test("projected labels separate crowded cards without moving their horizontal worker anchors", () => {
  const boxes = [
    { id: "one", x: 220, y: 400, width: 200, height: 60 },
    { id: "two", x: 240, y: 385, width: 180, height: 60 },
    { id: "three", x: 250, y: 370, width: 200, height: 60 },
    { id: "apart", x: 650, y: 400, width: 180, height: 60 },
  ];
  const original = structuredClone(boxes);
  const result = separateLabels(boxes);
  for (const label of result) {
    assert.equal(label.x, boxes.find((box) => box.id === label.id).x);
    assert.ok(label.bottom <= label.y);
    for (const other of result.filter((box) => box.id !== label.id)) {
      const overlapX = Math.abs(label.x - other.x) < (label.width + other.width) / 2;
      const overlapY =
        label.bottom > other.bottom - other.height && label.bottom - label.height < other.bottom;
      assert.equal(overlapX && overlapY, false);
    }
  }
  assert.equal(result.find((box) => box.id === "apart").bottom, 400);
  assert.deepEqual(boxes, original);
});

test("scene manifest rejects missing sockets, foreign assets and invalid shoreline geometry", () => {
  assert.throws(() => parseProofManifest({ ...manifest, worker: "https://example.com/robot.glb" }));
  assert.throws(() => parseProofManifest({ ...manifest, sockets: {} }));
  assert.throws(() => parseProofManifest({ ...manifest, shorelineXZ: [] }));
  assert.throws(() =>
    parseProofManifest({
      ...manifest,
      shorelineXZ: [
        [
          [0, NaN],
          [1, 2],
          [3, 4],
        ],
      ],
    }),
  );
  const loops = [
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
    [
      [20, 0],
      [25, 0],
      [25, 5],
      [20, 5],
    ],
  ];
  assert.deepEqual(shoreDistance(5, 5, loops), { distance: 5, land: true });
  assert.deepEqual(shoreDistance(12, 5, loops), { distance: 2, land: false });
  assert.equal(shoreDistance(22, 2, loops).land, true);
});

test("browser GLBs retain portable PBR, named cutaway groups and the existing worker animation", async () => {
  for (const [kind, url] of [
    ["scene", manifest.scene],
    ["worker", manifest.worker],
    ...baseVariants.map((variant) => [variant, manifest.bases[variant].src]),
  ]) {
    const bytes = await readFile(new URL(`../../public/frontier${url}`, import.meta.url));
    assert.equal(bytes.readUInt32LE(0), 0x46546c67);
    assert.equal(bytes.readUInt32LE(8), bytes.length);
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    if (kind !== "worker") {
      const names = new Set(gltf.nodes.map((node) => node.name));
      for (const name of kind === "scene"
        ? ["MF_Terrain", "MF_Bridge", "MF_Planting"]
        : ["MF_Roof", "MF_ShellCutaway", "MF_BaseFixed", "MF_Interior", "MF_Practicals"])
        assert.ok(names.has(name), `${kind}: ${name}`);
      if (kind !== "scene")
        for (const material of ["identity_roof_inset", "identity_roof_ring", "identity_trim"])
          assert.ok(
            gltf.materials.some((entry) => entry.name === material),
            `${kind}: ${material}`,
          );
      assert.ok(gltf.materials.some((material) => material.normalTexture));
      assert.ok(gltf.materials.some((material) => material.pbrMetallicRoughness?.baseColorTexture));
      assert.ok(
        gltf.materials.some((material) => material.name.startsWith("practical_") && material.emissiveFactor),
      );
      assert.ok(
        gltf.images.every((image) => image.bufferView !== undefined || image.uri?.startsWith("data:")),
      );
    } else assert.ok(gltf.animations.some((clip) => clip.name === "worker_tool_work"));
  }
});

test("one base per project has separate routes and stable placement under refresh/reordering", () => {
  const bases = projectBases(fixtureProjects);
  assert.equal(bases.length, fixtureProjects.length);
  assert.equal(new Set(bases.map((base) => base.position.join())).size, bases.length);
  assert.deepEqual(projectBases([...fixtureProjects].reverse()), bases);
  const scene = input();
  for (const base of bases) {
    const workers = proofWorkers(scene, manifest, bases).filter(
      (worker) => worker.projectId === base.project.id,
    );
    assert.ok(workers.every((worker) => worker.task.repositoryPath === base.project.repositoryPath));
    assert.ok(workers.every((worker) => worker.position[1] === 4.25));
    assert.deepEqual(
      workers[0].route,
      manifest.walkableRoutes.court.map((p) => translated(p, base.position)),
    );
    const cutaway = proofWorkers(
      { ...scene, location: { view: "project", projectId: base.project.id } },
      manifest,
      bases,
    );
    assert.ok(cutaway.length > 0 && cutaway.every((worker) => worker.projectId === base.project.id));
    const camera = viewCamera(bases, manifest, base.project.id, true);
    assert.deepEqual(camera.target, translated(manifest.cameras.cutaway.target, base.position));
  }
  const archived = { ...fixtureProjects[0], archivedAt: "2026-09-16" };
  assert.equal(projectBases([archived]).length, 0);
  assert.equal(proofVisible(search, input({ projects: [archived] })), false);
});

test("appearance defaults distribute all three buildings and persist without overwriting another project", () => {
  const saved = assignMissingAppearances(fixtureProjects, {});
  assert.equal(new Set(Object.values(saved).map((appearance) => appearance.variant)).size, 3);
  const first = fixtureProjects[0],
    second = fixtureProjects[1];
  const selected = { variant: "relay", palette: "blue" };
  const key = projectAppearanceKey(first),
    otherKey = projectAppearanceKey(second);
  const store = new Map();
  const storage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
  };
  saveAppearance(storage, otherKey, { variant: "foundry", palette: "purple" });
  saveAppearance(storage, key, selected);
  assert.deepEqual(readAppearances(storage)[key], selected);
  assert.deepEqual(readAppearances(storage)[otherKey], { variant: "foundry", palette: "purple" });
  const refreshed = assignMissingAppearances([...fixtureProjects].reverse(), { ...saved, [key]: selected });
  // A saved choice keeps its building and colour; the colony slot is completed alongside it.
  assert.deepEqual(refreshed[key], { ...selected, slot: "P1" });
  assert.deepEqual(refreshed[otherKey], saved[otherKey]);
  assert.deepEqual(
    parseAppearances({ version: 1, projects: { bad: { variant: "castle", palette: "green" } } }),
    {},
  );
  assert.deepEqual(readAppearances({ getItem: () => "corrupt" }), {});
  assert.deepEqual(
    randomAppearance(() => 0.999),
    { variant: "foundry", palette: "purple" },
  );
});

test("overview labels keep one relevant task per project, with full labels in the focused base", () => {
  const scene = input();
  const workers = proofWorkers(scene, manifest);
  const overview = visibleWorkerLabels(workers, scene, null);
  assert.equal(overview.length, fixtureProjects.length);
  assert.ok(overview.some((worker) => worker.task.id === scene.selectedId));
  assert.deepEqual(visibleWorkerLabels(workers, scene, "plancheck"), workers);
});

test("incomplete or externally referenced variant kits fail closed", () => {
  assert.throws(() => parseProofManifest({ ...manifest, bases: { command: manifest.bases.command } }));
  assert.throws(() =>
    parseProofManifest({
      ...manifest,
      bases: {
        ...manifest.bases,
        relay: { ...manifest.bases.relay, preview: "https://example.com/relay.png" },
      },
    }),
  );
  assert.throws(() => parseProofManifest({ ...manifest, environmentLightPositions: [[0, Infinity, 0]] }));
});

test("larger fixture crews stay clear of the analysis bench and each other inside every base", () => {
  for (const base of projectBases(fixtureProjects)) {
    const workers = proofWorkers(
      input({ location: { view: "project", projectId: base.project.id } }),
      manifest,
    );
    for (const worker of workers) {
      const x = worker.position[0] - base.position[0],
        z = worker.position[2] - base.position[2];
      assert.ok(Math.abs(x) > 2.6 || Math.abs(z) > 2.3, `${worker.task.id} must clear the central console`);
      for (const other of workers.filter((entry) => entry.task.id !== worker.task.id))
        assert.ok(
          Math.hypot(worker.position[0] - other.position[0], worker.position[2] - other.position[2]) >= 3.3,
        );
    }
  }
});
