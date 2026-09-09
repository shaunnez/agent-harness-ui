import assert from "node:assert/strict";
import test from "node:test";
import { fixtureTask } from "../../src/frontier/fixtures/scenarios.ts";
import {
  changeEnvironment,
  defaultEnvironment,
  formatWorldHour,
  LightingClock,
  lightingAt,
  normalizeEnvironment,
  worldHour,
} from "../../src/frontier/world/environment-model.ts";
import {
  actorSeed,
  basePatrol,
  patrolPose,
  workAction,
  workerBehavior,
} from "../../src/frontier/world/worker-behavior.ts";

test("a world day defaults to exactly one real hour and wraps continuously across midnight", () => {
  const start = { ...defaultEnvironment, hour: 9, anchorMs: 5000 };
  assert.equal(start.dayMinutes, 60);
  assert.equal(worldHour(start, 5000), 9);
  assert.equal(worldHour(start, 905000), 15);
  assert.equal(worldHour(start, 1805000), 21);
  assert.equal(worldHour(start, 3605000), 9);
  assert.equal(worldHour({ ...start, hour: 23.5 }, 80000), 0);
  assert.equal(formatWorldHour(24), "00:00");
});

test("speed edits and cycle/fixed switches preserve phase; saved settings reproduce it", () => {
  const original = { ...defaultEnvironment, hour: 6, anchorMs: 0 };
  const now = 400000;
  const current = worldHour(original, now);
  const slower = changeEnvironment(original, { dayMinutes: 120 }, now);
  assert.equal(worldHour(slower, now), current);
  assert.equal(worldHour(slower, now + 900000), current + 3);
  const fixed = changeEnvironment(slower, { mode: "fixed" }, now);
  assert.equal(worldHour(fixed, now + 3600000), current);
  const loaded = normalizeEnvironment(JSON.parse(JSON.stringify(slower)));
  assert.equal(worldHour(loaded, now + 300000), worldHour(slower, now + 300000));
});

test("old or corrupt browser preferences keep bounded finite environment settings", () => {
  for (const value of [null, "bad", [], {}, { dayMinutes: NaN, hour: Infinity, anchorMs: -Infinity }]) {
    const normalized = normalizeEnvironment(value);
    assert.equal(normalized.dayMinutes, 60);
    assert.ok(Number.isFinite(worldHour(normalized, 1000)));
  }
  assert.deepEqual(normalizeEnvironment({ mode: "wrong", dayMinutes: 0, hour: -1, anchorMs: -5 }), {
    mode: "cycle",
    dayMinutes: 10,
    hour: 23,
    anchorMs: 0,
  });
  assert.equal(normalizeEnvironment({ dayMinutes: 500 }).dayMinutes, 240);
});

test("lighting has distinct dawn, day, dusk and night, with darker sea and increasing evening lights", () => {
  const times = [6, 12, 19.4, 23].map(lightingAt);
  assert.deepEqual(
    times.map((time) => time.phase),
    ["Dawn", "Daylight", "Dusk", "Night"],
  );
  assert.equal(new Set(times.map((time) => time.land)).size, 4);
  assert.equal(times[1].lamps, 0);
  assert.equal(times[3].lamps, 1);
  assert.ok(lightingAt(18).lamps < lightingAt(19).lamps);
  assert.ok(lightingAt(19).lamps < lightingAt(21).lamps);
  const brightness = (rgb) => ((rgb >> 16) & 255) + ((rgb >> 8) & 255) + (rgb & 255);
  assert.ok(brightness(times[3].sea) < brightness(times[3].land) * 0.6);
  assert.deepEqual(lightingAt(24), lightingAt(0));
  assert.equal(lightingAt(23.999).sea, lightingAt(0.001).sea);
});

test("motion admission freezes light while explicit manual changes remain possible", () => {
  const clock = new LightingClock();
  const preferences = { ...defaultEnvironment, anchorMs: 1000 };
  clock.configure(preferences, true, 1000);
  assert.equal(clock.hour(901000), 15);
  clock.configure(preferences, false, 901000);
  assert.equal(clock.hour(1801000), 15);
  clock.configure({ ...preferences, mode: "fixed", hour: 23 }, false, 1801000);
  assert.equal(clock.hour(9001000), 23);
  clock.configure(preferences, true, 1801000);
  assert.equal(clock.hour(1801000), 21);
});

const task = fixtureTask("LW-1", "Lighting test", "/demo", {
  currentStage: "implement",
  status: "running",
  activeRunIds: ["run-1"],
});
test("active identity admits work, including a running sibling of a failed package", () => {
  assert.equal(workerBehavior(task, true, true, true), "work");
  assert.equal(
    workerBehavior(
      {
        ...task,
        attention: { kind: "failed" },
        workPackages: [
          { id: "S1", status: "failed" },
          { id: "S2", status: "running" },
        ],
      },
      true,
      true,
      true,
    ),
    "work",
  );
  assert.equal(workerBehavior({ ...task, activeRunIds: [] }, true, true, true), "park");
  assert.equal(workerBehavior(task, true, false, true), "park");
});

test("offline, completed and historical runs park even if stale active ids exist", () => {
  assert.equal(workerBehavior(task, false, true, true), "park");
  assert.equal(workerBehavior(task, true, true, true, true), "park");
  for (const status of ["completed", "closed", "archived", "cancelled"])
    assert.equal(workerBehavior({ ...task, status }, true, true, true), "park");
});

test("only explicit idle allows task wandering; every decision, wait and error stays parked", () => {
  const idle = { ...task, activeRunIds: [], attention: { kind: "idle" } };
  assert.equal(workerBehavior(idle, true, false, true), "roam");
  assert.equal(workerBehavior(idle, true, false, false), "park");
  for (const kind of [
    "answer",
    "approval",
    "dependency",
    "failed",
    "repair",
    "blocked",
    "external",
    "unavailable",
    "completed",
    "running",
  ])
    assert.equal(workerBehavior({ ...idle, attention: { kind } }, true, false, true), "park", kind);
  assert.equal(workerBehavior({ ...idle, attention: undefined }, true, false, true), "park");
});

test("recorded role and station select six distinct work rhythms", () => {
  assert.equal(workAction("scouts", "scout-schema"), "scan");
  assert.equal(workAction("implement", "repair"), "fabricate");
  assert.equal(workAction("test"), "diagnose");
  assert.equal(workAction("dev-review"), "inspect");
  assert.equal(workAction("final-review"), "inspect");
  assert.equal(workAction("grill"), "communicate");
  assert.equal(workAction("specification", "design-codex"), "console");
  assert.equal(workAction("plan"), "console");
});

test("authored patrols remain bounded and deterministic, pause and turn without teleporting", () => {
  for (const view of ["world", "project"]) {
    const path = basePatrol(100, 200, 0, view);
    const seed = actorSeed("crew-1");
    const xs = path.map((p) => p.x),
      ys = path.map((p) => p.y);
    let prior = null,
      walking = 0,
      paused = 0;
    const facings = new Set();
    for (let time = 0; time < 120000; time += 100) {
      const pose = patrolPose(path, time, seed, 12);
      assert.deepEqual(pose, patrolPose(path, time, seed, 12));
      assert.ok(pose.x >= Math.min(...xs) && pose.x <= Math.max(...xs));
      assert.ok(pose.y >= Math.min(...ys) && pose.y <= Math.max(...ys));
      if (prior) assert.ok(Math.hypot(pose.x - prior.x, pose.y - prior.y) <= 1.21);
      pose.walking ? walking++ : paused++;
      facings.add(pose.facing);
      prior = pose;
    }
    assert.ok(walking && paused);
    assert.equal(facings.size, 2);
  }
});

test("headquarters ambient route stays inside the open front floor strip", () => {
  for (const point of basePatrol(0, 0, 0, "project")) {
    assert.ok(point.y < -Math.abs(point.x) / 2);
    assert.ok(point.y >= -75);
  }
  assert.deepEqual(patrolPose([], 100, 1, 0), { x: 0, y: 0, walking: false, facing: 1, gait: 0 });
});
