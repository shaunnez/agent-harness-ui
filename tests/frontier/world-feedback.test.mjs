import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { materialCoreChanges } from "../../server/workspace-history-projection.mjs";
import { createFixtureGateway } from "../../src/frontier/fixtures/gateway.ts";
import { fixtureTask } from "../../src/frontier/fixtures/scenarios.ts";
import { RefreshCoordinator } from "../../src/frontier/runtime/coordinator.ts";
import { currentFeedback, WorldFeedbackCursor } from "../../src/frontier/runtime/world-feedback.ts";
import { arrivalBridge } from "../../src/frontier/world-3d/arrival-journey.ts";
import { colonyWorkers } from "../../src/frontier/world-3d/colony-workers.ts";
import { projectBases } from "../../src/frontier/world-3d/layout.ts";
import { propObstacles } from "../../src/frontier/world-3d/prop-placement.ts";
import { allocateSockets } from "../../src/frontier/world-3d/rooms.ts";
import { planWorkerJourney } from "../../src/frontier/world-3d/scene-journeys.ts";
import { buildField } from "../../src/frontier/world-3d/terrain-field.ts";
import {
  clearHqSegment,
  hqJourney,
  journeyLength,
  journeyPose,
} from "../../src/frontier/world-3d/worker-journeys.ts";

const now = Date.now();
const fact = (sequence, extra = {}) => ({
  sequence,
  observedAt: new Date(now).toISOString(),
  taskId: "T1",
  projectId: "p",
  taskTitle: "Example",
  stage: "implement",
  status: "running",
  kind: "task-state",
  transition: "stage-advanced",
  fromStage: "plan",
  label: "Working",
  reason: null,
  ...extra,
});
const head = (upper = 0, sourceId = "source", floor = 0) => ({ upper, sourceId, floor, available: true });

test("typed transition facts distinguish creation, advance, started repair, attention and actual completion", () => {
  const a = fixtureTask("T1", "Example", "/example", {
    currentStage: "dev-review",
    status: "repair-required",
  });
  assert.equal(materialCoreChanges(null, a)[0].transition, "task-created");
  const b = { ...a, status: "running", activeRunKind: "repair", activeRunReservationId: "reservation" };
  assert.equal(materialCoreChanges(a, b)[0].transition, "repair-started");
  assert.equal(materialCoreChanges(b, { ...b, currentStage: "implement" })[0].transition, "repair-started");
  assert.equal(materialCoreChanges(a, { ...a, status: "completed" })[0].transition, "task-completed");
  assert.notEqual(
    materialCoreChanges(a, { ...a, status: "awaiting-pr-merge" })[0].transition,
    "task-completed",
  );
  assert.equal(
    materialCoreChanges(b, { ...b, activeRunKind: null, status: "blocked" })[0].transition,
    "attention",
  );
  assert.deepEqual(materialCoreChanges(a, a), []);
});

test("cursor baselines, orders and coalesces new facts without duplicate or historical replay", () => {
  const cursor = new WorldFeedbackCursor();
  assert.equal(cursor.request(head(12), false), null);
  const request = cursor.request(head(15), false);
  const page = {
    ...request,
    items: [fact(15, { kind: "artifact-arrived", transition: null, artifactId: "A" }), fact(14), fact(13)],
    coverage: { complete: true },
    nextCursor: null,
  };
  const effects = cursor.accept(page, now);
  assert.equal(effects.length, 1);
  assert.equal(effects[0].fact.sequence, 14);
  assert.deepEqual(cursor.accept(page, now), []);
  assert.equal(cursor.request(head(500), false), null, "burst rebases without draining a backlog");
  assert.equal(cursor.request(head(501), true), null, "reconnect/visibility resume baselines");
  assert.equal(cursor.request(head(502, "replacement"), false), null);
  assert.equal(cursor.request(head(503, "replacement", 503), false), null, "gap baselines");
});

test("obsolete candidate artifacts, state changes and expired effects are suppressed", () => {
  const effect = { fact: fact(1), kind: "stage-advanced", expiresAt: now + 100 };
  const task = { id: "T1", status: "running", currentStage: "implement" };
  assert.equal(currentFeedback(effect, [task], now), true);
  assert.equal(currentFeedback(effect, [{ ...task, currentStage: "test" }], now), false);
  assert.equal(currentFeedback(effect, [task], now + 101), false);
  assert.equal(
    currentFeedback(
      { ...effect, kind: "repair-started", fact: { ...effect.fact, reservationId: "old" } },
      [{ ...task, activeRunKind: "repair", activeRunReservationId: "new" }],
      now,
    ),
    false,
  );
  assert.equal(
    currentFeedback(
      {
        ...effect,
        kind: "artifact-arrived",
        fact: { ...effect.fact, candidateId: "C1", candidateRevision: 1 },
      },
      [{ ...task, candidates: [{ id: "C1", revisionNumber: 2 }] }],
      now,
    ),
    false,
  );
});

test("the coordinator uses real fixture facts and suppresses reconnect, source and retained-history replay", async () => {
  const gateway = createFixtureGateway(),
    runtime = new RefreshCoordinator(gateway);
  runtime.start();
  try {
    await runtime.synchronize();
    assert.deepEqual(runtime.getSnapshot().worldFeedback ?? [], []);
    gateway.sampleWorldEvent("PC-142", "plan");
    await runtime.synchronize();
    assert.equal(runtime.getSnapshot().worldFeedback[0].title, "Moved to Plan");
    await runtime.synchronize();
    assert.equal(runtime.getSnapshot().worldFeedback.length, 1);
    gateway.setDisconnected(true);
    await runtime.synchronize();
    assert.deepEqual(runtime.getSnapshot().worldFeedback, []);
    gateway.setDisconnected(false);
    gateway.sampleWorldEvent("PC-142", "test");
    await runtime.synchronize();
    assert.deepEqual(runtime.getSnapshot().worldFeedback, []);
    gateway.resetSource();
    await runtime.synchronize();
    assert.deepEqual(runtime.getSnapshot().worldFeedback, []);
  } finally {
    runtime.stop();
  }
});

test("foreground Watch receives new activity within three seconds without manual refresh", async (t) => {
  const gateway = createFixtureGateway();
  gateway.sampleWorldEvent("PC-142", "working");
  const runtime = new RefreshCoordinator(gateway);
  runtime.start();
  try {
    runtime.select("PC-142");
    await runtime.synchronize();
    const started = Date.now();
    gateway.sampleWorldEvent("PC-142", "tool");
    while (
      !runtime.getSnapshot().selected?.activity.items.some((event) => event.title === "Reading repository")
    ) {
      assert.ok(Date.now() - started < 3000, "foreground activity exceeded the three-second budget");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    t.diagnostic(`Recorded activity to Watch snapshot: ${Date.now() - started} ms`);
    assert.equal(runtime.getSnapshot().selected.core.status, "running");
  } finally {
    runtime.stop();
  }
});

test("room journeys follow door openings, clear the table and furniture, and finish at the destination", () => {
  const names = ["briefing", "planning", "implementation", "review", "testing"];
  for (const from of names)
    for (const to of names) {
      const a = allocateSockets([{ id: "a", room: from, workers: 1 }], undefined, propObstacles).workers[0]
        .socket.position;
      const b = allocateSockets([{ id: "b", room: to, workers: 1 }], undefined, propObstacles).workers[0]
        .socket.position;
      const route = hqJourney(a, b, propObstacles);
      assert.ok(route, `${from} -> ${to} has a clear route`);
      for (let i = 1; i < route.length; i++) assert.ok(clearHqSegment(route[i - 1], route[i], propObstacles));
      assert.deepEqual(journeyPose(route, journeyLength(route) + 1).position, b);
      if (from === "briefing" && to !== "briefing")
        assert.ok(
          route.some((p) => p[2] > 21.6),
          "briefing exits via the court, never through corridor partitions",
        );
    }
  assert.equal(hqJourney([0, 4.3, 0], [4, 4.3, 3], propObstacles), null, "central table is not walkable");
});

test("arrivals require a connected bridge path, including occupied outer rings", () => {
  assert.ok(arrivalBridge("P1", ["P1"]));
  assert.ok(
    arrivalBridge(
      "P10",
      Array.from({ length: 10 }, (_, i) => `P${i + 1}`),
    ),
  );
  assert.equal(arrivalBridge("P100", ["P100"]), null);
});

test("a crowded outer-island arrival ends on the court, never at an overflow socket behind the HQ", async () => {
  const gateway = createFixtureGateway("normal");
  const id = gateway.sampleWorldEvent("LOAD-10-1", "arrival");
  const input = {
    projects: await gateway.projects(),
    tasks: await gateway.summaries(),
    location: { view: "world" },
    connected: true,
    motion: true,
    idleRoaming: true,
  };
  const manifest = JSON.parse(
    await readFile(new URL("../../public/frontier/assets/3d-proof/manifest.json", import.meta.url)),
  );
  const bases = projectBases(input.projects);
  const worker = colonyWorkers(input, bases, manifest).find((actor) => actor.task.id === id);
  const base = bases.find((item) => item.project.id === worker.projectId);
  const journey = planWorkerJourney(
    { kind: "task-created", receivedAt: now },
    worker,
    input,
    manifest,
    bases,
    buildField(bases.map((item) => item.slot)),
  );
  assert.ok(journey);
  assert.deepEqual(journey.route.at(-1), worker.route[0]);
  for (let distance = 0; distance < journeyLength(journey.route); distance += 0.25) {
    const p = journeyPose(journey.route, distance).position;
    assert.ok(
      Math.hypot(p[0] - base.position[0], p[2] - base.position[2]) > 18,
      "exterior arrival stays outside the HQ footprint",
    );
  }
});

test("motion gates, historical Watch and shared physical rooms never create false journeys", async () => {
  const gateway = createFixtureGateway();
  gateway.sampleWorldEvent("PC-142", "plan");
  const input = {
    projects: await gateway.projects(),
    tasks: await gateway.summaries(),
    location: { view: "project", projectId: "plancheck" },
    selectedId: null,
    connected: true,
    motion: true,
    idleRoaming: true,
    watchedRunActive: false,
  };
  const manifest = JSON.parse(
    await readFile(new URL("../../public/frontier/assets/3d-proof/manifest.json", import.meta.url)),
  );
  const bases = projectBases(input.projects),
    worker = colonyWorkers(input, bases, manifest).find((w) => w.task.id === "PC-142");
  const effect = { kind: "stage-advanced", fact: fact(1, { fromStage: "implement" }), receivedAt: now };
  assert.ok(planWorkerJourney(effect, worker, input, manifest, bases, null));
  assert.equal(planWorkerJourney(effect, worker, { ...input, motion: false }, manifest, bases, null), null);
  assert.equal(
    planWorkerJourney(
      effect,
      worker,
      { ...input, location: { view: "agent", taskId: "PC-142" } },
      manifest,
      bases,
      null,
    ),
    null,
  );
  assert.equal(
    planWorkerJourney(
      { ...effect, fact: { ...effect.fact, fromStage: "specification" } },
      worker,
      input,
      manifest,
      bases,
      null,
    ),
    null,
  );
});
