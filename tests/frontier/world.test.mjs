import assert from "node:assert/strict";
import test from "node:test";
import { createFixtureGateway } from "../../src/frontier/fixtures/gateway.ts";
import { latestRun } from "../../src/frontier/runtime/presentation.ts";
import {
  cameraLimits,
  constrainCamera,
  coverBackdrop,
  fitCamera,
  pointInContainedImage,
  screenToWorld,
  zoomAround,
} from "../../src/frontier/world/camera.ts";
import { ProjectPlacement, TransitionTracker } from "../../src/frontier/world/layout.ts";

test("project identity keeps its location through rename, removal, additions and reload", async () => {
  const projects = await createFixtureGateway().projects();
  let saved = null;
  const storage = {
    getItem: () => saved,
    setItem: (_, value) => {
      saved = value;
    },
  };
  const placement = new ProjectPlacement(storage);
  const original = placement.locate(projects);
  const renamed = { ...projects[1], name: "Renamed project" };
  const changed = new ProjectPlacement(storage).locate([renamed, { ...projects[0], id: "new-project" }]);
  assert.deepEqual(changed[0].position, original[1].position);
  assert.ok(!original.some((item) => JSON.stringify(item.position) === JSON.stringify(changed[1].position)));
});

test("only a newer observed stage change triggers a transition; reconnect seeds current state", async () => {
  const task = (await createFixtureGateway().summaries())[0];
  const tracker = new TransitionTracker();
  assert.deepEqual(tracker.reconcile([task], true), []);
  const next = { ...task, currentStage: "test", pollVersion: "next" };
  assert.deepEqual(tracker.reconcile([next], true), [task.id]);
  assert.deepEqual(tracker.reconcile([next], true), []);
  tracker.reconcile([next], false);
  const afterReconnect = { ...next, currentStage: "final-review", pollVersion: "later" };
  assert.deepEqual(tracker.reconcile([afterReconnect], true), []);
});

test("camera zoom preserves the ground point under the pointer including clamped limits", () => {
  const camera = { x: 52, y: -120, zoom: 1 };
  const pointer = { x: 513, y: 286 };
  for (const amount of [0.2, 1.3, 10]) {
    const next = zoomAround(camera, pointer, amount);
    const before = screenToWorld(pointer, camera),
      after = screenToWorld(pointer, next);
    assert.ok(Math.abs(before.x - after.x) < 1e-9 && Math.abs(before.y - after.y) < 1e-9);
    assert.ok(next.zoom >= cameraLimits.min && next.zoom <= cameraLimits.max);
  }
  const small = fitCamera(320, 400, { x: 0, y: 0, width: 5000, height: 5000 });
  assert.equal(small.zoom, cameraLimits.min);
  assert.ok(Number.isFinite(small.x) && Number.isFinite(small.y));
});

test("delivery motion begins once for newly observed completion and never on initial load or reconnect", async () => {
  const task = {
    ...(await createFixtureGateway().summaries())[0],
    currentStage: "approval",
    status: "awaiting-pr-merge",
    pollVersion: "before",
  };
  const tracker = new TransitionTracker();
  assert.deepEqual(tracker.reconcile([task], true), []);
  const merged = { ...task, status: "completed", pollVersion: "after" };
  assert.deepEqual(tracker.reconcile([merged], true), [task.id]);
  assert.deepEqual(tracker.reconcile([merged], true), []);
  tracker.reconcile([task], false);
  assert.deepEqual(tracker.reconcile([merged], true), []);
});

test("latest worker selection is independent of API page order and respects active run identity", () => {
  const older = { id: "old", startedAt: "2026-09-01T00:00:00Z", status: "completed" };
  const newer = { id: "new", startedAt: "2026-09-02T00:00:00Z", status: "completed" };
  assert.equal(latestRun([newer, older]).id, "new");
  assert.equal(latestRun([older, newer]).id, "new");
  assert.equal(latestRun([{ ...older, status: "running" }, newer], ["old"]).id, "old");
});

test("minimap clicks account for letterboxing rather than shifting the world target", () => {
  const box = { width: 240, height: 150 },
    image = { width: 260, height: 100 };
  assert.deepEqual(pointInContainedImage({ x: 120, y: 75 }, box, image), { x: 0.5, y: 0.5 });
  assert.equal(pointInContainedImage({ x: 120, y: 10 }, box, image), null);
  const left = pointInContainedImage({ x: 0, y: 75 }, box, image);
  assert.deepEqual(left, { x: 0, y: 0.5 });
});

test("pan boundaries retain a reachable world and preserve zoom", () => {
  const bounds = { x: -100, y: -20, width: 1450, height: 840 };
  const viewport = { width: 1568, height: 1003 };
  for (const offset of [-100000, 100000]) {
    const camera = constrainCamera({ x: offset, y: offset, zoom: 0.3 }, viewport, bounds);
    const center = screenToWorld({ x: viewport.width / 2, y: viewport.height / 2 }, camera);
    assert.ok(center.x >= -400 && center.x <= 1650);
    assert.ok(center.y >= -320 && center.y <= 1120);
    assert.equal(camera.zoom, 0.3);
  }
});

test("detail zoom and pan keep the finite backdrop covering the viewport", () => {
  const bounds = { x: -979.2, y: -1692, width: 3686.4, height: 2304 };
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 1568, height: 1003 },
  ]) {
    for (const offset of [-10000, 10000]) {
      const camera = coverBackdrop({ x: offset, y: offset, zoom: 0.3 }, viewport, bounds);
      assert.ok(camera.x + bounds.x * camera.zoom <= 1e-6);
      assert.ok(camera.y + bounds.y * camera.zoom <= 1e-6);
      assert.ok(camera.x + (bounds.x + bounds.width) * camera.zoom >= viewport.width - 1e-6);
      assert.ok(camera.y + (bounds.y + bounds.height) * camera.zoom >= viewport.height - 1e-6);
      assert.ok(camera.zoom >= 0.55);
    }
  }
});

test("normal performance fixtures have 10 projects and 100 selectable records without network access", async () => {
  const fixture = createFixtureGateway("normal");
  assert.equal((await fixture.projects()).length, 10);
  const summaries = await fixture.summaries();
  assert.equal(summaries.length, 100);
  assert.equal(new Set(summaries.map((task) => task.id)).size, 100);
  assert.equal((await fixture.core(summaries[99].id)).id, summaries[99].id);
});

test("task rooms retain their slots as headquarters grows beyond the opening trio", async () => {
  const { taskSite } = await import("../../src/frontier/world/layout.ts");
  const sites = Array.from({ length: 100 }, (_, index) => taskSite(index));
  assert.equal(new Set(sites.map(({ x, y }) => `${x}:${y}`)).size, 100);
  assert.deepEqual(sites[0], { x: -211.2, y: -105.6 });
  assert.deepEqual(sites[3], { x: 0, y: -211.2 });
  assert.ok(Math.max(...sites.map(({ x }) => Math.abs(x))) < 3000);
});
