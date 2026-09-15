import assert from "node:assert/strict";
import test from "node:test";
import {
  acknowledge,
  commandMemoryKey,
  establishBaseline,
  readCommandMemory,
  toggleWatchPin,
  writeCommandMemory,
} from "../../src/frontier/app/command-memory.ts";
import { createFixtureGateway } from "../../src/frontier/fixtures/gateway.ts";
import { mergeHistory, summarizeBriefing } from "../../src/frontier/runtime/briefing.ts";
import { RefreshCoordinator } from "../../src/frontier/runtime/coordinator.ts";
import {
  createDecisionSession,
  decisionSessionView,
  orderedDecisions,
} from "../../src/frontier/runtime/decision-session.ts";

const storage = () => {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};
const head = (sourceId = "source-A", upper = 4) => ({
  sourceId,
  upper,
  available: true,
  capturedAt: "2026-09-09T01:00:00Z",
});
async function until(predicate) {
  for (let index = 0; index < 200; index++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("Refresh state was not reached");
}

test("source-scoped memory merges sequential writes, monotonic acknowledgement and the four-pin cap", () => {
  const store = storage();
  establishBaseline(store, head());
  writeCommandMemory(store, "source-A", (current) => toggleWatchPin(current, { taskId: "A", runId: null }));
  writeCommandMemory(store, "source-A", (current) =>
    acknowledge(current, { sequence: 10, at: "2026-09-09T02:00:00Z" }),
  );
  writeCommandMemory(store, "source-A", (current) =>
    toggleWatchPin(current, { taskId: "A", runId: "old-run" }),
  );
  writeCommandMemory(store, "source-A", (current) =>
    acknowledge(current, { sequence: 7, at: "2026-09-09T01:30:00Z" }),
  );
  const result = establishBaseline(store, head());
  assert.equal(result.checkpoint.sequence, 10, "an older tab cannot rewind acknowledgement");
  assert.equal(result.pins.length, 2);
  assert.deepEqual(establishBaseline(store, head("source-B")).pins, []);
  for (const taskId of ["B", "C"])
    writeCommandMemory(store, "source-A", (current) => toggleWatchPin(current, { taskId, runId: null }));
  assert.throws(
    () =>
      writeCommandMemory(store, "source-A", (current) =>
        toggleWatchPin(current, { taskId: "D", runId: null }),
      ),
    /Four pins/,
  );
  assert.equal(readCommandMemory(store, "source-A").pins.length, 4);
  writeCommandMemory(store, "source-A", (current) =>
    toggleWatchPin(current, { taskId: "A", runId: "old-run" }),
  );
  assert.equal(readCommandMemory(store, "source-A").pins[0].runId, null);
  assert.throws(() => establishBaseline(null, head()), /unavailable/);
});

test("malformed local preferences cannot create bogus checkpoints or unbounded pins", () => {
  const store = storage();
  store.setItem(
    commandMemoryKey,
    JSON.stringify({
      "source-A": {
        checkpoint: { sequence: -1, at: "bad" },
        pins: [null, { taskId: "A", runId: null }, { taskId: "A", runId: null }, { taskId: "B" }],
      },
    }),
  );
  assert.deepEqual(readCommandMemory(store, "source-A"), {
    checkpoint: null,
    pins: [{ taskId: "A", runId: null }],
  });
});

test("decision order is stable through new arrivals, resolution and deletion", async () => {
  const gateway = createFixtureGateway();
  const tasks = await gateway.summaries();
  const original = orderedDecisions(tasks);
  const selected = original[1];
  const session = createDecisionSession(tasks, selected.id, "PC-142", "source-A");
  const arrived = { ...selected, id: "NEW", createdAt: "2000-01-01T00:00:00Z" };
  const changed = tasks
    .filter((task) => task.id !== original[0].id && task.id !== selected.id)
    .concat(arrived);
  const view = decisionSessionView(session, changed);
  assert.equal(view.state, "missing");
  assert.equal(view.ids[view.index], selected.id);
  assert.equal(view.next, original[2].id);
  assert.deepEqual(
    view.fresh.map((task) => task.id),
    ["NEW"],
  );
  assert.equal(session.originSelectedId, "PC-142");
  assert.equal(session.sourceId, "source-A");
  await gateway.sampleHistoryChange(selected.id, "completed");
  assert.equal(decisionSessionView(session, await gateway.summaries()).state, "resolved");
});

test("briefing deduplicates observations and run totals, preserving late, zero and missing usage", () => {
  const base = {
    taskId: "T",
    taskTitle: "Old title",
    projectId: "P",
    projectName: "Old project",
    stage: "implement",
    kind: "run-completed",
    observedAt: "2026-09-09T03:00:00Z",
  };
  const record = (sequence, id, completedAt, usage) => ({
    ...base,
    sequence,
    run: { id, completedAt, usage },
  });
  const items = [
    record(1, "A", "2026-09-09T02:00:00Z", { inputTokens: 10, outputTokens: 3 }),
    record(2, "A", "2026-09-09T02:00:00Z", { inputTokens: 20, outputTokens: 4 }),
    record(3, "B", "2026-09-09T02:01:00Z", null),
    record(4, "C", "2026-09-09T02:02:00Z", { inputTokens: 0, outputTokens: 0 }),
    record(5, "late", "2026-09-09T00:30:00Z", { inputTokens: 9999 }),
    record(6, "undated", null, { inputTokens: 9999 }),
  ];
  const merged = mergeHistory(items, { items: items.slice(1) });
  assert.equal(merged.length, 6);
  const summary = summarizeBriefing(
    merged,
    "2026-09-09T01:00:00Z",
    "2026-09-09T03:00:00Z",
    [{ id: "T", title: "Renamed task" }],
    [{ id: "P", name: "Renamed project" }],
  );
  assert.equal(summary.completedRuns, 3);
  assert.equal(summary.lateRuns, 2);
  assert.equal(summary.totals.input.value, 20);
  assert.equal(summary.totals.input.known, 2);
  assert.equal(summary.totals.cost.value, null);
  assert.equal(summary.groups[0].project, "Renamed project");
  assert.equal(summary.groups[0].tasks[0].title, "Renamed task");
  assert.equal(
    summarizeBriefing(items, "2026-09-09T01:00:00Z", "2026-09-09T03:00:00Z", [], []).groups[0].tasks[0]
      .available,
    false,
  );
});

test("four run pins share bounded concurrency and cache unchanged versions; task pins fetch no details", async () => {
  const gateway = createFixtureGateway("normal"),
    runtime = new RefreshCoordinator(gateway);
  let active = 0,
    maximum = 0,
    reads = 0,
    coreReads = 0;
  const readRun = gateway.watchedRun,
    core = gateway.core;
  gateway.core = async (...args) => {
    coreReads++;
    return core(...args);
  };
  gateway.watchedRun = async (...args) => {
    reads++;
    active++;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    try {
      return await readRun(...args);
    } finally {
      active--;
    }
  };
  try {
    runtime.start();
    await until(() => runtime.getSnapshot().tasks.length === 100);
    const source = runtime.getSnapshot().workspace.sourceId;
    const pins = [1, 2, 3, 4].map((id) => ({ taskId: `LOAD-${id}-1`, runId: `R-LOAD-${id}-1-implement-1` }));
    runtime.setWatchRequests(source, pins);
    await until(() => Object.keys(runtime.getSnapshot().watchedRuns).length === 4);
    const count = reads;
    await runtime.refresh();
    assert.equal(reads, count);
    assert.equal(maximum, 2);
    assert.equal(coreReads, 0);
    runtime.setWatchRequests(
      source,
      pins.map((pin) => ({ ...pin, runId: null })),
    );
    await runtime.refresh();
    assert.deepEqual(runtime.getSnapshot().watchedRuns, {});
    assert.equal(coreReads, 0);
    gateway.resetSource();
    await runtime.synchronize();
    assert.notEqual(runtime.getSnapshot().workspace.sourceId, source);
    runtime.setWatchRequests(source, pins);
    assert.deepEqual(runtime.getSnapshot().watchedRuns, {});
  } finally {
    runtime.stop();
  }
});

test("history captures a stable upper boundary and old-source requests cannot enter a replacement workspace", async () => {
  const gateway = createFixtureGateway(),
    runtime = new RefreshCoordinator(gateway);
  try {
    runtime.start();
    await until(() => runtime.getSnapshot().tasks.length === 12);
    const base = runtime.getSnapshot().workspace;
    gateway.sampleHistoryChange("PC-142", "completed");
    await runtime.synchronize();
    const upper = runtime.getSnapshot().workspace.upper;
    gateway.sampleHistoryChange("PC-142", "blocked");
    const page = await runtime.readHistory({ sourceId: base.sourceId, after: base.upper, through: upper });
    assert.ok(page.items.every((item) => item.sequence <= upper));
    assert.ok(!page.items.some((item) => item.status === "blocked"));
    gateway.resetSource();
    await runtime.synchronize();
    await assert.rejects(
      runtime.readHistory({ sourceId: base.sourceId, after: 0, through: upper }),
      /source changed/,
    );
  } finally {
    runtime.stop();
  }
});

test("an exact pinned run opens without paging and disappears when no longer retained", async () => {
  const gateway = createFixtureGateway(),
    runtime = new RefreshCoordinator(gateway);
  const exact = gateway.exactRun;
  let exactReads = 0,
    pageReads = 0,
    removed = false;
  gateway.runs = async () => {
    pageReads++;
    return { items: [], nextCursor: "older", total: 1000 };
  };
  gateway.exactRun = async (...args) => {
    exactReads++;
    return removed ? null : exact(...args);
  };
  try {
    runtime.start();
    await until(() => runtime.getSnapshot().tasks.length === 12);
    runtime.select("PC-142");
    runtime.selectRun("R-PC-142-plan-1");
    await until(() => runtime.getSnapshot().selected?.runs.items.some((run) => run.id === "R-PC-142-plan-1"));
    assert.equal(exactReads, 1);
    assert.ok(pageReads <= 2, "Only the selected first page is read, never all retained pages");
    removed = true;
    gateway.sampleHistoryChange("PC-142", "blocked");
    await runtime.synchronize();
    assert.equal(
      runtime.getSnapshot().selected.runs.items.some((run) => run.id === "R-PC-142-plan-1"),
      false,
    );
  } finally {
    runtime.stop();
  }
});

test("external fixture changes preserve frozen decisions and replace candidate identity", async () => {
  const gateway = createFixtureGateway(undefined, true);
  const original = await gateway.summaries();
  const chosen = orderedDecisions(original).find((task) => task.id !== "PC-148");
  const session = createDecisionSession(original, chosen.id, null, (await gateway.workspaceHead()).sourceId);
  gateway.sampleExternalChange(chosen.id, "resolve");
  assert.equal(decisionSessionView(session, await gateway.summaries()).state, "resolved");
  gateway.sampleExternalChange(chosen.id, "remove");
  assert.equal(decisionSessionView(session, await gateway.summaries()).state, "missing");
  const before = await gateway.core("PC-148");
  gateway.sampleExternalChange("PC-148", "candidate");
  const after = await gateway.core("PC-148");
  assert.equal(after.candidates.at(-1).revisionNumber, before.candidates.at(-1).revisionNumber + 1);
  assert.notEqual(after.candidates.at(-1).headRevision, before.candidates.at(-1).headRevision);
  assert.deepEqual(after.activeRunIds, []);
  assert.equal(after.blocker, null);
});
