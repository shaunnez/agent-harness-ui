import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createActivityRecorder } from "../../../server/incremental-activity.mjs";
import { RetentionOrchestrator } from "../../../server/orchestrator-retention.mjs";
import { beginAgentRun } from "../../../server/run-activity.mjs";
import { SqliteTaskStore } from "../../../server/sqlite-store.mjs";

async function setup(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "frontier-activity-"));
  const store = new SqliteTaskStore(path.join(root, "tasks.sqlite3"));
  await store.init();
  t.after(async () => {
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  const task = await store.create({
    title: "Activity test",
    description: "Fixture",
    repositoryPath: "/fixture",
    workflow: "implement",
    priority: "medium",
  });
  await store.update(task.id, (draft) => {
    draft.status = "running";
    for (const id of ["R1", "R2"])
      beginAgentRun(draft, {
        id,
        stage: "implement",
        kind: "implementation",
        role: "implement",
        workPackageId: id === "R1" ? "S1" : "S2",
        startedAt: new Date().toISOString(),
      });
  });
  return { store, taskId: task.id };
}
const event = (id = "tool", phase = "started") => ({
  type: "activity",
  title: "Tool activity",
  detail: "API_KEY=secret-value",
  privateReasoning: "NEVER RETAIN",
  toolCall: { id, name: "read_file", category: "file-read", phase, result: null },
});

test("the default timer publishes activity before completion without an explicit flush", async (t) => {
  const context = await setup(t);
  const recorder = createActivityRecorder({ ...context, runId: "R1" });
  t.after(() => recorder.close());
  const started = Date.now();
  recorder.add(event());
  let task;
  do {
    await new Promise((resolve) => setTimeout(resolve, 20));
    task = await context.store.get(context.taskId);
  } while (!task.events.some((entry) => entry.toolCall) && Date.now() - started < 1500);
  assert.ok(task.events.some((entry) => entry.toolCall));
  assert.equal(task.runs[0].status, "running");
  assert.ok(Date.now() - started < 1500);
  t.diagnostic(`Callback to observed SQLite activity: ${Date.now() - started} ms`);
});

test("activity persists during exact active runs, redacts data, and terminal retention never duplicates it", async (t) => {
  const context = await setup(t);
  const a = createActivityRecorder({ ...context, runId: "R1" });
  const b = createActivityRecorder({ ...context, runId: "R2" });
  a.add(event());
  a.add(event());
  a.add(event("tool", "completed"));
  b.add(event());
  const started = Date.now();
  await Promise.all([a.flush(), b.flush()]);
  const during = await context.store.get(context.taskId);
  assert.equal(during.runs[0].status, "running");
  const events = during.events.filter((item) => item.toolCall);
  assert.equal(events.length, 3);
  assert.deepEqual(new Set(events.map((item) => item.workPackageId)), new Set(["S1", "S2"]));
  assert.ok(Date.now() - started < 3000);
  assert.ok(!JSON.stringify(events).includes("secret-value"));
  assert.ok(!JSON.stringify(events).includes("NEVER RETAIN"));
  await Promise.all([a.close(), b.close()]);
  const retention = new RetentionOrchestrator(context);
  await retention._finishAgentRun(
    context.taskId,
    "implement",
    "Fixture",
    {
      runId: "R1",
      runtimeEvents: a.events(),
      completedAt: new Date().toISOString(),
      usage: null,
    },
    "completed",
  );
  assert.equal((await context.store.get(context.taskId)).events.filter((item) => item.toolCall).length, 3);
  assert.equal(a.add(event("late")), false);
});

test("failed storage retains pending data for retry and reports recovery without overwriting newer state", async (t) => {
  const context = await setup(t);
  let fail = true;
  const reports = [];
  const recorder = createActivityRecorder({
    ...context,
    runId: "R1",
    report: (item) => reports.push(item),
    store: {
      update: (...args) =>
        fail ? Promise.reject(new Error("disk unavailable")) : context.store.update(...args),
    },
  });
  recorder.add(event());
  await assert.rejects(recorder.flush(), /disk/);
  await context.store.update(context.taskId, (task) => {
    task.title = "Newer title";
  });
  fail = false;
  await recorder.close();
  const task = await context.store.get(context.taskId);
  assert.equal(task.title, "Newer title");
  assert.equal(task.events.filter((item) => item.toolCall).length, 1);
  assert.ok(task.events.some((item) => item.title === "Activity recording recovered"));
  assert.equal(reports.length, 1);
});

test("saturation stops acceptance with a coverage notice; an unflushable close rejects", async (t) => {
  const context = await setup(t);
  let stopped = false;
  const recorder = createActivityRecorder({
    ...context,
    runId: "R1",
    pendingLimit: 2,
    onOverflow: () => {
      stopped = true;
    },
    report: () => {},
  });
  recorder.add(event("1"));
  recorder.add(event("2"));
  recorder.add(event("3"));
  assert.equal(stopped, true);
  assert.equal(recorder.add(event("4")), false);
  await recorder.close();
  assert.ok(
    (await context.store.get(context.taskId)).events.some(
      (item) => item.title === "Activity coverage interrupted",
    ),
  );
  const failed = createActivityRecorder({
    ...context,
    runId: "R2",
    report: () => {},
    store: {
      update: async () => {
        throw new Error("disk unavailable");
      },
    },
  });
  failed.add(event());
  await assert.rejects(failed.close(), /could not be persisted/);
  assert.equal(failed.events().length, 1);
});

test("a stale recorder cannot append into a completed run", async (t) => {
  const context = await setup(t);
  const recorder = createActivityRecorder({ ...context, runId: "R1", report: () => {} });
  recorder.add(event());
  await context.store.update(context.taskId, (task) => {
    task.runs[0].status = "interrupted";
  });
  await assert.rejects(recorder.close(), /could not be persisted/);
  assert.equal((await context.store.get(context.taskId)).events.filter((item) => item.toolCall).length, 0);
});
