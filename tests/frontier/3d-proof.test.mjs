import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fixtureProjects, makeFixtureTasks } from "../../src/frontier/fixtures/scenarios.ts";
import {
  assignMissingAppearances,
  baseVariants,
  legacyBaseVariants,
  legacyVariant,
  parseAppearances,
  projectAppearanceKey,
  randomAppearance,
  readAppearances,
  saveAppearance,
} from "../../src/frontier/world-3d/appearance.ts";
import { colonyCameras } from "../../src/frontier/world-3d/colony.ts";
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

// The original v2 contract stays supported after the colony v3 export replaces the public manifest.
const manifest = parseProofManifest({
  ...JSON.parse(
    await readFile(new URL("../../public/frontier/assets/3d-proof/manifest.json", import.meta.url), "utf8"),
  ),
  version: 2,
});
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

test("crowded labels near the top edge drop below their neighbours instead of leaving the viewport", () => {
  const boxes = Array.from({ length: 6 }, (_, index) => ({
    id: `w${index}`,
    x: 400 + index * 4,
    y: 150 + index * 6,
    width: 240,
    height: 57,
  }));
  // A pinned room name sits in the stack's path and a HUD panel covers the top-left corner.
  const room = { id: "room:planning", x: 410, y: 320, width: 90, height: 26, pinned: true };
  const panel = { x: 0, y: 0, width: 520, height: 140 };
  const limits = { bounds: { top: 8, bottom: 900 }, obstacles: [panel] };
  const bounded = separateLabels([...boxes, room], limits);
  const clear = (label, other) =>
    !(
      Math.abs(label.x - other.x) < (label.width + other.width) / 2 &&
      label.bottom > other.bottom - other.height &&
      label.bottom - label.height < other.bottom
    );
  assert.equal(bounded.length, boxes.length + 1);
  assert.equal(bounded.find((label) => label.id === room.id).bottom, room.y);
  for (const label of bounded) {
    assert.ok(
      label.bottom - label.height >= 8,
      `${label.id} leaves the top at ${label.bottom - label.height}`,
    );
    assert.ok(label.bottom <= 900);
    assert.equal(label.x, [...boxes, room].find((box) => box.id === label.id).x);
    assert.ok(
      clear(label, {
        x: panel.x + panel.width / 2,
        width: panel.width,
        bottom: panel.height,
        height: panel.height,
      }),
      `${label.id} covers the HUD panel`,
    );
    for (const other of bounded.filter((box) => box.id !== label.id))
      assert.ok(clear(label, other), `${label.id} overlaps ${other.id}`);
  }
  assert.ok(separateLabels(boxes).some((label) => label.bottom - label.height < 100));
});

test("a card walking below a fractional-height room name clears every later card too", () => {
  // Live values from the fourteen-task cutaway: the room label bottom is 196.796875, cards are 57 tall.
  const room = { id: "room:implementation", x: 735, y: 196.796875, width: 105, height: 24, pinned: true };
  const cards = [
    { id: "low", x: 569, y: 253, width: 189, height: 57 },
    { id: "mid", x: 624, y: 335, width: 189, height: 57 },
    { id: "high", x: 662, y: 227.7, width: 188, height: 57 },
  ];
  const panel = { x: 697.5, y: 66, width: 173, height: 40 };
  const placed = separateLabels([room, ...cards], { bounds: { top: 8, bottom: 995 }, obstacles: [panel] });
  for (const label of placed)
    for (const other of placed.filter((box) => box.id !== label.id)) {
      const overlapX = Math.abs(label.x - other.x) < (label.width + other.width) / 2;
      const overlapY =
        label.bottom > other.bottom - other.height && label.bottom - label.height < other.bottom;
      assert.equal(overlapX && overlapY, false, `${label.id} overlaps ${other.id}`);
    }
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
    ...legacyBaseVariants.map((variant) => [variant, manifest.bases[variant].src]),
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
    const camera = viewCamera(bases, base.project.id, true);
    assert.deepEqual(camera.target, translated(colonyCameras.cutaway.target, base.position));
  }
  const archived = { ...fixtureProjects[0], archivedAt: "2026-09-16" };
  assert.equal(projectBases([archived]).length, 0);
  // The colony retains archived parcels as dormant scenery, including an archived-only world.
  assert.equal(proofVisible(search, input({ projects: [archived] })), true);
});

test("appearance defaults spread the buildings and persist without overwriting another project", () => {
  const saved = assignMissingAppearances(fixtureProjects, {});
  assert.equal(new Set(Object.values(saved).map((appearance) => appearance.variant)).size, 3);
  assert.deepEqual(baseVariants, ["bastion", "command", "relay", "foundry"]);
  assert.equal(legacyVariant("bastion"), "command");
  assert.equal(legacyVariant("relay"), "relay");
  assert.deepEqual(
    randomAppearance(() => 0),
    { variant: "bastion", palette: "blue" },
  );
  assert.deepEqual(
    parseAppearances({ version: 1, projects: { hex: { variant: "bastion", palette: "red" } } }),
    { hex: { variant: "bastion", palette: "red" } },
  );
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

test("without ?colony=1 the v3 manifest is consumed as v2 and the archipelago layout is unchanged", async () => {
  const { colonyRequested, withoutColony } = await import("../../src/frontier/world-3d/model.ts");
  const { archipelagoBases } = await import("../../src/frontier/world-3d/layout.ts");
  const { proofAssetUrls } = await import("../../src/frontier/world-3d/colony-assets.ts");
  const search = "?mode=fixture&renderer=3d&art=cinematic";
  assert.equal(colonyRequested(search), false);
  assert.equal(colonyRequested(`${search}&colony=1`), true);
  const published = parseProofManifest(
    JSON.parse(
      await readFile(new URL("../../public/frontier/assets/3d-proof/manifest.json", import.meta.url), "utf8"),
    ),
  );
  assert.equal(published.version, 3);
  const legacy = withoutColony(published);
  assert.equal(legacy.version, 2);
  assert.equal("colony" in legacy, false);
  assert.deepEqual(legacy.bases, published.bases);
  // The legacy kit is fetched, the colony kit is not.
  const urls = proofAssetUrls(legacy);
  assert.ok(urls.includes(published.scene) && urls.includes(published.bases.command.src));
  assert.ok(!urls.some((url) => url.includes("hq-shell") || url.includes("parcel-")));
  assert.equal(withoutColony({ ...published, version: 2 }).version, 2);
  assert.throws(() => withoutColony({ ...published, bases: undefined }), /archipelago kit/);
  // Main's staggered coastal grid: plancheck first, then id order; no slots, no bridges.
  const bases = archipelagoBases(fixtureProjects, {});
  assert.equal(bases.length, fixtureProjects.length);
  assert.equal(bases[0].project.id, "plancheck");
  assert.ok(bases.every((base) => base.slot === undefined));
  assert.deepEqual(
    bases.map((base) => base.position.map((n) => Number(n.toFixed(3)))),
    [
      [1.568, 0, 37.18],
      [-68.897, 0, -26.859],
      [18.115, 0, -41.401],
    ],
  );
  assert.deepEqual(archipelagoBases([...fixtureProjects].reverse(), {}), bases);
  assert.equal(archipelagoBases([{ ...fixtureProjects[0], archivedAt: "2026-09-16" }], {}).length, 0);
  // Cameras come from the manifest, not the colony contract, and the world fit is the archipelago's.
  const cutaway = viewCamera(bases, "plancheck", true, undefined, legacy);
  assert.deepEqual(cutaway.target, translated(legacy.cameras.cutaway.target, bases[0].position));
  const world = viewCamera(bases, null, false, { width: 1280, height: 720 }, legacy);
  assert.equal(world.verticalSpan, 137);
  assert.equal(world.viewOffset, undefined);
  assert.notDeepEqual(viewCamera(bases, "plancheck", true).target, cutaway.target);
});

test("robots render 2x in World, 1.4x on a focused exterior and true size in the cutaway", async () => {
  const { proofView, workerScale, workerHeight, proofWorkerScale, proofWorkerHeight, workerViewScale } =
    await import("../../src/frontier/world-3d/model.ts");
  assert.deepEqual(workerViewScale, { world: 2, exterior: 1.4, cutaway: 1 });
  const world = { location: { view: "world", projectId: null, taskId: null, runId: null } };
  assert.equal(proofView(world, null), "world");
  assert.equal(proofView(world, "plancheck"), "exterior");
  assert.equal(proofView({ location: { view: "project", projectId: "plancheck" } }, null), "cutaway");
  assert.equal(proofView({ location: { view: "agent", taskId: "PC-142" } }, "plancheck"), "cutaway");
  assert.equal(workerScale("cutaway"), proofWorkerScale);
  assert.equal(workerHeight("cutaway"), proofWorkerHeight);
  assert.ok(Math.abs(workerScale("world") - proofWorkerScale * 2) < 1e-12);
  assert.ok(Math.abs(workerHeight("exterior") - 3.1 * 1.4) < 1e-12);
  // Standing positions and spacing are unchanged by the view: allocation stays at true size.
  const scene = input({ location: { view: "world", projectId: null, taskId: null, runId: null } });
  const positions = proofWorkers(scene, manifest).map((worker) => worker.position.join());
  assert.deepEqual(
    proofWorkers(scene, manifest).map((worker) => worker.position.join()),
    positions,
  );
});

test("crowded rooms collapse plain working cards to compact markers but never attention or selection", async () => {
  const { compactWorkerLabels } = await import("../../src/frontier/world-3d/model.ts");
  const worker = (id, overrides = {}) => ({
    task: { id },
    projectId: "plancheck",
    room: "implementation",
    tone: "working",
    behavior: "work",
    ...overrides,
  });
  const crowd = Array.from({ length: 14 }, (_, i) => worker(`COL-${String(i + 1).padStart(3, "0")}`));
  const cutaway = {
    location: { view: "project", projectId: "plancheck", taskId: null },
    selectedId: "COL-009",
  };
  const compact = compactWorkerLabels(crowd, cutaway, null);
  // Every plain card collapses; the selected task stays full.
  assert.equal(compact.size, 13);
  assert.equal(compact.has("COL-009"), false);
  const mixed = [
    ...crowd.slice(0, 6),
    worker("COL-ANS", { tone: "answer" }),
    worker("COL-FIX", { tone: "repair", behavior: "park" }),
    worker("COL-WATCH"),
  ];
  const watched = compactWorkerLabels(mixed, { location: { view: "agent", taskId: "COL-WATCH" } }, null);
  assert.deepEqual(
    [...watched].sort(),
    crowd.slice(0, 6).map((w) => w.task.id),
  );
  // Small rooms and other rooms are untouched; the World overview never compacts.
  assert.equal(compactWorkerLabels(crowd.slice(0, 4), cutaway, null).size, 0);
  const rooms = [...crowd.slice(0, 5), ...crowd.slice(5, 8).map((w) => ({ ...w, room: "review" }))];
  assert.deepEqual(
    [...compactWorkerLabels(rooms, cutaway, null)],
    ["COL-001", "COL-002", "COL-003", "COL-004", "COL-005"],
  );
  assert.equal(compactWorkerLabels(crowd, { location: { view: "world" } }, null).size, 0);
  // A focused exterior groups its court like a room.
  assert.equal(
    compactWorkerLabels(
      crowd.map((w) => ({ ...w, room: undefined })),
      { location: { view: "world" } },
      "plancheck",
    ).size,
    14,
  );
});

test("a card that fits nowhere covers another card before it covers a HUD panel", () => {
  // Live 1280 x 720 shape: navigation panel top-left, selection panel across the bottom, two pinned room
  // names and three wide cards anchored inside the only free gap.
  const nav = { x: 12, y: 101, width: 500, height: 42 };
  const selection = { x: 259, y: 449, width: 657, height: 236 };
  const rooms = [
    { id: "room:implementation", x: 586, y: 194, width: 108, height: 25, pinned: true },
    { id: "room:planning", x: 351, y: 297, width: 67, height: 25, pinned: true },
    { id: "room:briefing", x: 361, y: 388, width: 62, height: 25, pinned: true },
  ];
  const cards = [
    { id: "COL-001", x: 385, y: 202, width: 245, height: 57 },
    { id: "COL-002", x: 498, y: 171, width: 245, height: 57 },
    { id: "COL-003", x: 636, y: 162, width: 245, height: 57 },
  ];
  const placed = separateLabels([...rooms, ...cards], {
    bounds: { top: 8, bottom: 712 },
    obstacles: [nav, selection],
  });
  const covers = (label, rect) =>
    Math.abs(label.x - (rect.x + rect.width / 2)) < (label.width + rect.width) / 2 &&
    label.bottom > rect.y &&
    label.bottom - label.height < rect.y + rect.height;
  for (const label of placed.filter((entry) => entry.id.startsWith("COL"))) {
    assert.ok(label.bottom - label.height >= 8 && label.bottom <= 712, `${label.id} leaves the viewport`);
    assert.equal(covers(label, nav), false, `${label.id} covers the navigation panel`);
    assert.equal(covers(label, selection), false, `${label.id} covers the selection panel`);
  }
});
