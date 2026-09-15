import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { SqliteTaskStore } from "../../../server/sqlite-store.mjs";
import { JsonTaskStore, migratePersistedTaskState } from "../../../server/store.mjs";
import { createIsolatedApi } from "../../../scripts/frontier/isolated-api.mjs";
import { WORKSPACE_HISTORY_LIMIT } from "../../../server/workspace-history.mjs";

async function setup(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "frontier-history-"));
  const file = path.join(root, "tasks.sqlite3");
  const store = new SqliteTaskStore(file);
  await store.init();
  t.after(async () => {
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  const create = (title = "History task") =>
    store.create({
      title,
      description: "Deterministic history contract fixture",
      repositoryPath: "/sample",
      workflow: "implement",
      priority: "medium",
    });
  const page = async (after = 0, through, cursor, limit = 100, sourceId) => {
    const head = await store.workspaceHead();
    return store.workspaceHistory(
      new URLSearchParams({
        sourceId: sourceId ?? head.sourceId,
        after: String(after),
        through: String(through ?? head.upper),
        limit: String(limit),
        ...(cursor ? { cursor } : {}),
      }),
    );
  };
  return { store, root, file, create, page };
}

test("workspace observation ordering is independent of equal or late provider times; pagination is bounded", async (t) => {
  const { store, create, page } = await setup(t);
  const a = await create("A"),
    b = await create("B");
  const base = (await store.workspaceHead()).upper;
  for (const id of [b.id, a.id])
    await store.update(id, (task) => {
      task.status = "blocked";
      task.blocker = { code: "sample", detail: id, detectedAt: "2001-01-01T00:00:00.000Z" };
    });
  const upper = (await store.workspaceHead()).upper;
  const first = await page(base, upper, null, 1);
  assert.equal(first.items[0].taskId, b.id);
  await store.update(a.id, (task) => {
    task.status = "completed";
    task.blocker = null;
  });
  const second = await page(base, upper, first.nextCursor, 1);
  assert.equal(second.items[0].taskId, a.id);
  assert.equal(second.nextCursor, null);
  assert.ok(second.items[0].sequence > first.items[0].sequence);
  assert.equal((await page(upper)).items[0].status, "completed");
  assert.deepEqual(await page(base, upper, first.nextCursor, 1), second);
});

test("material state history survives completion, repair and renewed blocking between reads", async (t) => {
  const { store, create, page } = await setup(t);
  const task = await create(),
    base = (await store.workspaceHead()).upper;
  for (const status of ["completed", "repair-required", "blocked"])
    await store.update(task.id, (next) => {
      next.status = status;
      next.error = status === "completed" ? null : `Recorded ${status}`;
    });
  assert.deepEqual(
    (await page(base)).items.map((item) => item.status),
    ["completed", "repair-required", "blocked"],
  );
  const head = await store.workspaceHead();
  await store.updateCore(task.id, (next) => {
    next.title = "Renamed task";
  });
  assert.equal((await store.workspaceHead()).upper, head.upper);
  await assert.rejects(
    store.update(task.id, (next) => {
      next.status = "completed";
      throw new Error("rollback");
    }),
    /rollback/,
  );
  assert.equal((await store.workspaceHead()).upper, head.upper);
});

test("completed run records are idempotent, preserve missing/zero usage and exclude transcript contents", async (t) => {
  const { store, create, page } = await setup(t);
  const task = await create(),
    base = (await store.workspaceHead()).upper;
  const run = {
    id: "R1",
    stage: "implement",
    status: "completed",
    startedAt: "2026-09-08T01:00:00Z",
    completedAt: "2026-09-09T01:00:00Z",
    usage: null,
    model: "sample",
    reasoning: "high",
    output: "PRIVATE TRANSCRIPT",
  };
  await store.update(task.id, (next) => {
    next.runs.push(run);
  });
  const first = await page(base);
  assert.equal(first.items[0].kind, "run-completed");
  assert.equal(first.items[0].run.usage, null);
  assert.ok(!JSON.stringify(first).includes("PRIVATE"));
  const through = (await store.workspaceHead()).upper;
  await store.update(task.id, () => {});
  assert.equal((await store.workspaceHead()).upper, through);
  await store.update(task.id, (next) => {
    next.runs[0].usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  });
  assert.equal((await page(through)).items[0].run.usage.totalTokens, 0);
  assert.equal((await store.watchedRun(task.id, "R1")).active, false);
  assert.equal((await store.watchedRun(task.id, "missing")).run, null);
});

test("source identity survives restart but not a copied database or rollback-compatible JSON import", async (t) => {
  const { store, create, root, file } = await setup(t);
  const task = await create();
  const original = await store.workspaceHead();
  const exported = path.join(root, "rollback.json");
  await store.exportJson(exported);
  assert.deepEqual(JSON.parse(await readFile(exported, "utf8")).tasks[0], await store.get(task.id));
  store.close();
  await store.init();
  assert.equal((await store.workspaceHead()).sourceId, original.sourceId);
  store.close();
  const copiedPath = path.join(root, "copy.sqlite3");
  await copyFile(file, copiedPath);
  const copy = new SqliteTaskStore(copiedPath);
  await copy.init();
  assert.notEqual((await copy.workspaceHead()).sourceId, original.sourceId);
  copy.close();
  const imported = new SqliteTaskStore(path.join(root, "import.sqlite3"), { legacyJsonPath: exported });
  await imported.init();
  const importedHead = await imported.workspaceHead();
  assert.notEqual(importedHead.sourceId, original.sourceId);
  assert.equal(importedHead.upper, 0, "legacy history is a baseline, never backfilled");
  const expected = JSON.parse(await readFile(exported, "utf8"));
  migratePersistedTaskState(expected);
  assert.deepEqual(await imported.get(task.id), expected.tasks[0]);
  imported.close();
  const legacy = new JsonTaskStore(exported);
  await legacy.init();
  assert.equal(typeof legacy.workspaceHistory, "undefined");
});

test("pruning during pagination reports incomplete coverage; invalid and cross-source cursors fail closed", async (t) => {
  const { store, create, page, file } = await setup(t);
  const task = await create();
  await store.updateCore(task.id, (next) => {
    next.status = "completed";
  });
  const head = await store.workspaceHead(),
    first = await page(0, head.upper, null, 1);
  const db = new DatabaseSync(file);
  db.exec("BEGIN IMMEDIATE");
  const add = db.prepare(
    "INSERT INTO workspace_history(observed_at, task_id, payload_json) VALUES (?, ?, ?)",
  );
  for (let i = 0; i < WORKSPACE_HISTORY_LIMIT; i++)
    add.run(new Date().toISOString(), task.id, JSON.stringify({ kind: "task-state", taskId: task.id }));
  db.exec("COMMIT");
  db.close();
  await store.updateCore(task.id, () => {});
  const pruned = await page(0, head.upper, first.nextCursor, 1);
  assert.equal(pruned.coverage.complete, false);
  assert.match(pruned.coverage.reason, /no longer retained/);
  await assert.rejects(page(0, undefined, "garbage"), /cursor/);
  await assert.rejects(page(1, head.upper, first.nextCursor), /cursor/);
  await assert.rejects(page(0, undefined, null, 100, "replaced-source"), /source changed/);
  await assert.rejects(page(0, Number.MAX_SAFE_INTEGER), /bounds/);
  await assert.rejects(page(0, undefined, null, 101), /limit/);
});

test("workspace API uses the existing HTTP boundary and exact run reads do not hydrate task histories", async (t) => {
  const api = await createIsolatedApi();
  t.after(async () => {
    await api.close();
    await rm(api.root, { recursive: true, force: true });
  });
  const task = await api.store.create({
    title: "API history",
    description: "Fixture",
    repositoryPath: api.repositoryPath,
    workflow: "implement",
    priority: "low",
  });
  const head = await (await fetch(`${api.origin}/api/workspace/history?view=head`)).json();
  assert.ok(head.available && head.sourceId);
  assert.ok(!JSON.stringify(head).includes(api.root));
  assert.equal(
    (
      await fetch(`${api.origin}/api/workspace/history?view=head`, {
        headers: { origin: "https://evil.invalid" },
      })
    ).status,
    403,
  );
  api.store.get = () => {
    throw new Error("Unexpected full task hydration");
  };
  const page = await fetch(
    `${api.origin}/api/workspace/history?sourceId=${head.sourceId}&after=0&through=${head.upper}`,
  );
  assert.equal(page.status, 200);
  const run = await fetch(`${api.origin}/api/tasks/${task.id}/runs/absent`);
  assert.equal(run.status, 200);
  assert.equal((await run.json()).run, null);
});

test("schema-2 upgrade starts at an explicit baseline and leaves canonical task data intact", async (t) => {
  const { store, file, create, page } = await setup(t);
  const task = await create();
  const canonical = await store.get(task.id);
  store.close();
  const db = new DatabaseSync(file);
  db.exec(
    "DROP TABLE workspace_history; DELETE FROM schema_migrations WHERE version = 3; INSERT OR IGNORE INTO schema_migrations VALUES (2, '2026-09-01T00:00:00Z'); DELETE FROM metadata WHERE key LIKE 'workspace_%';",
  );
  db.close();
  await store.init();
  const head = await store.workspaceHead();
  assert.equal(head.upper, 0);
  assert.ok(head.coverageStartAt);
  const expected = { tasks: [canonical] };
  migratePersistedTaskState(expected);
  assert.deepEqual(await store.get(task.id), expected.tasks[0]);
  assert.deepEqual((await page()).items, []);
});

test("undated terminal runs remain inspectable without acquiring an invented completion time", async (t) => {
  const { store, create, page } = await setup(t);
  const task = await create(),
    base = (await store.workspaceHead()).upper;
  await store.update(task.id, (next) => {
    next.runs.push({
      id: "undated",
      stage: "scouts",
      status: "completed",
      startedAt: null,
      completedAt: null,
      usage: null,
    });
  });
  const observed = (await page(base)).items.find((item) => item.kind === "run-completed");
  assert.equal(observed.run.id, "undated");
  assert.equal(observed.run.completedAt ?? null, null);
});

test("watch summaries park waiting runs and candidate gate observations retain exact identity and reason", async (t) => {
  const { store, create, page } = await setup(t);
  const task = await create(),
    base = (await store.workspaceHead()).upper;
  await store.update(task.id, (next) => {
    next.status = "awaiting-spec-approval";
    next.activeRunIds = ["old"];
    next.runs.push({
      id: "old",
      status: "running",
      stage: "specification",
      startedAt: new Date().toISOString(),
    });
    next.candidates = [{ id: "C-1", revisionNumber: 3, headRevision: "abcd", status: "ready_for_review" }];
    next.gateFreshness = {
      test: {
        state: "stale",
        fresh: false,
        candidateId: "C-1",
        candidateRevision: 3,
        reasonCopy: "New candidate requires verification",
      },
    };
    next.artifacts.push({
      id: "A1",
      stage: "test",
      name: "Retained verification",
      createdAt: new Date().toISOString(),
    });
  });
  assert.equal((await store.watchedRun(task.id, "old")).active, false);
  const records = (await page(base)).items;
  assert.equal(records.find((item) => item.kind === "artifact-arrived").artifactId, "A1");
  const gate = records.find((item) => item.kind === "candidate-gates");
  assert.equal(gate.candidateRevision, 3);
  assert.equal(gate.candidateHeadRevision, "abcd");
  assert.match(gate.reason, /test: stale.*requires verification/);
});
