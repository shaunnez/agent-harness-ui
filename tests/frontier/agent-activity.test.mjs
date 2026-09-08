import assert from "node:assert/strict";
import test from "node:test";
import {
  activityScroll,
  currentRecordedTool,
  eventAge,
  runEvents,
} from "../../src/frontier/runtime/agent-activity.ts";
import { fixtureRun } from "../../src/frontier/fixtures/scenarios.ts";
const run = fixtureRun("A", "implement", "running");
const tool = { id: "tool-1", name: "read_file", category: "file", phase: "started", result: null };
const event = (id, extra = {}) => ({
  id,
  at: `2026-09-09T00:00:0${id}Z`,
  stage: "implement",
  runId: run.id,
  ...extra,
});
test("activity is chronological, deduplicated, and never attributed to an unloaded or sibling run", () => {
  const input = [
    event("2"),
    event("1"),
    event("2"),
    event("3", { runId: "sibling" }),
    event("4", { runId: null }),
    event("5", { runId: null, stage: "test" }),
  ];
  assert.deepEqual(
    runEvents(input, run).map((e) => e.id),
    ["1", "2", "4"],
  );
  assert.deepEqual(runEvents(input, undefined), []);
});
test("only an exact active run with a non-terminal identified tool can label current activity", () => {
  const running = { ...run, toolCalls: [tool] };
  assert.equal(currentRecordedTool(running, [], true).id, "tool-1");
  assert.equal(currentRecordedTool(running, [], false), undefined);
  assert.equal(currentRecordedTool({ ...running, toolCalls: [{ ...tool, id: null }] }, [], true), undefined);
  const done = event("2", { toolCall: { ...tool, phase: "completed" } });
  const delayed = event("3", { toolCall: tool });
  assert.equal(currentRecordedTool(running, [done, delayed], true), undefined);
  assert.equal(currentRecordedTool(run, [event("1", { runId: "sibling", toolCall: tool })], true), undefined);
  assert.equal(currentRecordedTool(run, [event("1", { runId: null, toolCall: tool })], true), undefined);
});
test("age is a recorded timestamp delta, not an inference about execution health", () => {
  const now = Date.parse("2026-09-09T00:10:00Z");
  assert.equal(eventAge("2026-09-09T00:00:00Z", now), 600000);
  assert.equal(eventAge(undefined, now), null);
  assert.equal(eventAge("bad", now), null);
  assert.equal(eventAge("2026-09-10T00:00:00Z", now), 0);
});
test("reading position is preserved on append and anchored when earlier history loads", () => {
  const current = { following: false, previousHeight: 1000, height: 1200, top: 200, earlier: false };
  assert.equal(activityScroll(current), 200);
  assert.equal(activityScroll({ ...current, earlier: true }), 400);
  assert.equal(activityScroll({ ...current, following: true }), 1200);
});

test("sample activity and usage controls are bounded in-memory records", async () => {
  const { createFixtureGateway } = await import("../../src/frontier/fixtures/gateway.ts");
  const gateway = createFixtureGateway();
  const before = await gateway.activity("PC-142");
  gateway.appendActivity("PC-142", 1000);
  assert.equal((await gateway.activity("PC-142")).items.length, before.items.length + 30);
  gateway.setUsageState("PC-142", "pending");
  assert.equal((await gateway.runs("PC-142")).items.find((run) => run.status === "running").usage, null);
  gateway.setUsageState("PC-142", "zero");
  assert.equal(
    (await gateway.runs("PC-142")).items.find((run) => run.status === "running").usage.totalTokens,
    0,
  );
  assert.throws(() => gateway.appendActivity("MS-086", 1), /active run/);
});
