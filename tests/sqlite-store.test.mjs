import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { promisify } from "node:util";
import { SqliteTaskStore } from "../server/sqlite-store.mjs";
import { JsonTaskStore, migratePersistedTaskState } from "../server/store.mjs";

const exec = promisify(execFile);

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-sqlite-store-"));
  const jsonPath = path.join(directory, "tasks.json");
  const databasePath = path.join(directory, "tasks.sqlite3");
  const jsonStore = new JsonTaskStore(jsonPath);
  await jsonStore.init();
  const task = await jsonStore.create({
    title: "SQLite migration",
    description: "Retain exact current workflow state.",
    repositoryPath: directory,
    workflow: "implement",
    priority: "high",
  });
  await jsonStore.update(task.id, (draft) => {
    draft.artifacts.push({
      id: "artifact-1",
      runId: "run-1",
      stage: "triage",
      name: "triage.md",
      kind: "markdown",
      content: "# Triage\n\nRetained content.",
      createdAt: "2026-08-09T00:00:01.000Z",
      model: "gpt-5.6-luna",
      reasoning: "xhigh",
      usage: { inputTokens: 10, cachedInputTokens: 5, outputTokens: 2, totalTokens: 12 },
      gateResult: { verdict: "PASS", summary: "Fixture passed." },
      contextManifest: {
        stage: "triage",
        promptCharacters: 100,
        estimatedPromptTokens: 25,
        repositoryAccess: "read-only",
        policy: "Fixture policy",
        sources: [],
      },
    });
    draft.runs.push({
      id: "run-1",
      kind: "agent",
      status: "completed",
      stage: "triage",
      role: "triage",
      model: "gpt-5.6-luna",
      reasoning: "xhigh",
      startedAt: "2026-08-09T00:00:00.000Z",
      completedAt: "2026-08-09T00:00:01.000Z",
      durationMs: 1_000,
      artifactId: "artifact-1",
      usage: null,
      credits: null,
      apiEstimate: null,
      candidateId: null,
      candidateRevision: null,
      workPackageId: null,
      attempt: 1,
      retryOfRunId: null,
      repairOfRunId: null,
      toolCalls: [],
      test: null,
      evidenceError: null,
      freshness: null,
      gateResult: null,
      error: null,
      source: "codex-jsonl",
    });
    draft.events.push({
      id: "event-1",
      at: "2026-08-09T00:00:01.000Z",
      category: "artifact",
      tone: "success",
      stage: "triage",
      title: "Artifact retained",
      detail: "triage.md",
      runId: "run-1",
      artifactId: "artifact-1",
    });
  });
  return { directory, jsonPath, databasePath, jsonStore, taskId: task.id };
}

test("imports JSON exactly once into normalized SQLite tables without modifying the source", async () => {
  const context = await fixture();
  const sourceBefore = await readFile(context.jsonPath, "utf8");
  const sqlite = new SqliteTaskStore(context.databasePath, { legacyJsonPath: context.jsonPath });
  try {
    await sqlite.init();
    const migratedState = JSON.parse(sourceBefore);
    migratePersistedTaskState(migratedState);
    const expected = migratedState.tasks.find((task) => task.id === context.taskId);
    const actual = await sqlite.get(context.taskId);
    assert.deepEqual(actual, expected);
    assert.equal(await readFile(context.jsonPath, "utf8"), sourceBefore);

    const summaries = await sqlite.listSummaries();
    assert.equal(summaries[0].artifactCount, 1);
    assert.equal(summaries[0].eventCount, 2);
    assert.equal(summaries[0].runCount, 1);
    assert.equal("content" in summaries[0].artifacts[0], false);
    assert.equal("events" in summaries[0], false);
    assert.equal("runs" in summaries[0], false);

    const evaluationTasks = await sqlite.listEvaluationTasks();
    assert.equal(evaluationTasks[0].artifacts[0].gateResult.verdict, "PASS");
    assert.equal(evaluationTasks[0].artifacts[0].contextManifest.promptCharacters, 100);
    assert.equal("content" in evaluationTasks[0].artifacts[0], false);

    const artifacts = await sqlite.pageArtifacts(context.taskId, new URLSearchParams({ limit: "1" }));
    assert.equal(artifacts.total, 1);
    assert.equal(artifacts.items[0].id, "artifact-1");
    assert.equal("content" in artifacts.items[0], false);
    const events = await sqlite.pageEvents(context.taskId, new URLSearchParams({ filter: "activity" }));
    assert.deepEqual(new Set(events.items.map((event) => event.category)), new Set(["artifact", "activity"]));
    const runs = await sqlite.pageRuns(context.taskId, new URLSearchParams({ limit: "1" }));
    assert.equal(runs.items[0].id, "run-1");
    assert.equal(await sqlite.pageEvents("AH-404", new URLSearchParams()), null);
  } finally {
    sqlite.close();
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("persists targeted updates, rolls failed mutations back, and reopens without drift", async () => {
  const context = await fixture();
  const sqlite = new SqliteTaskStore(context.databasePath, { legacyJsonPath: context.jsonPath });
  try {
    await sqlite.init();
    await sqlite.update(context.taskId, (draft) => {
      draft.priority = "low";
      draft.events.push({
        id: "event-2",
        at: "2026-08-09T00:00:02.000Z",
        category: "decision",
        tone: "info",
        stage: "triage",
        title: "Priority changed",
        detail: "low",
      });
    });
    await assert.rejects(
      sqlite.update(context.taskId, (draft) => {
        draft.priority = "medium";
        throw new Error("stop transaction");
      }),
      /stop transaction/,
    );
    assert.equal((await sqlite.get(context.taskId)).priority, "low");
    sqlite.close();

    const reopened = new SqliteTaskStore(context.databasePath, { legacyJsonPath: context.jsonPath });
    await reopened.init();
    const task = await reopened.get(context.taskId);
    assert.equal(task.priority, "low");
    assert.equal(task.events.at(-1).id, "event-2");
    assert.equal(task.artifacts[0].content, "# Triage\n\nRetained content.");
    reopened.close();
  } finally {
    sqlite.close();
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("core-only and unchanged collection updates do not rewrite retained evidence", async () => {
  const context = await fixture();
  const sqlite = new SqliteTaskStore(context.databasePath, { legacyJsonPath: context.jsonPath });
  let observer;
  try {
    await sqlite.init();
    observer = new DatabaseSync(context.databasePath);
    observer.exec(`
      CREATE TABLE collection_update_audit(table_name TEXT NOT NULL);
      CREATE TRIGGER audit_artifact_update AFTER UPDATE ON artifacts BEGIN
        INSERT INTO collection_update_audit(table_name) VALUES ('artifacts');
      END;
      CREATE TRIGGER audit_event_update AFTER UPDATE ON events BEGIN
        INSERT INTO collection_update_audit(table_name) VALUES ('events');
      END;
      CREATE TRIGGER audit_run_update AFTER UPDATE ON runs BEGIN
        INSERT INTO collection_update_audit(table_name) VALUES ('runs');
      END;
    `);
    const before = await sqlite.get(context.taskId);
    await sqlite.update(context.taskId, (draft) => {
      draft.priority = "low";
    });
    assert.equal(observer.prepare("SELECT COUNT(*) AS count FROM collection_update_audit").get().count, 0);

    await sqlite.update(context.taskId, (draft) => {
      draft.status = "awaiting-pr-merge";
      draft.pullRequestIntent = { status: "open" };
    });
    const semanticUpdatedAt = (await sqlite.getCore(context.taskId)).updatedAt;
    await sqlite.updateCore(context.taskId, (draft) => {
      draft.pullRequestIntent.lastCheckedAt = "2026-08-09T00:10:00.000Z";
    }, { touchUpdatedAt: false });
    const after = await sqlite.get(context.taskId);
    assert.equal(after.updatedAt, semanticUpdatedAt);
    assert.deepEqual(after.artifacts, before.artifacts);
    assert.deepEqual(after.runs, before.runs);
    assert.deepEqual(after.events, before.events);
    assert.deepEqual((await sqlite.listPullRequestTasks()).map((task) => task.id), [context.taskId]);
  } finally {
    observer?.close();
    sqlite.close();
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("serializes competing transitions across independent SQLite connections", async () => {
  const context = await fixture();
  const first = new SqliteTaskStore(context.databasePath, { legacyJsonPath: context.jsonPath });
  const second = new SqliteTaskStore(context.databasePath, { legacyJsonPath: context.jsonPath });
  try {
    await first.init();
    await second.init();
    const accepted = await first.transition(
      context.taskId,
      (task) => task.status === "queued",
      (task) => { task.status = "awaiting-triage"; },
    );
    assert.equal(accepted.status, "awaiting-triage");
    await assert.rejects(
      second.transition(
        context.taskId,
        (task) => task.status === "queued",
        (task) => { task.status = "cancelled"; },
      ),
      (error) => error.code === "TASK_TRANSITION_CONFLICT",
    );
    assert.equal((await second.get(context.taskId)).status, "awaiting-triage");
  } finally {
    first.close();
    second.close();
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("allows exactly one cross-process claimant for the same task transition", async () => {
  const context = await fixture();
  const seed = new SqliteTaskStore(context.databasePath, { legacyJsonPath: context.jsonPath });
  try {
    await seed.init();
    seed.close();
    const script = `
      import { SqliteTaskStore } from ${JSON.stringify(new URL("../server/sqlite-store.mjs", import.meta.url).href)};
      const store = new SqliteTaskStore(${JSON.stringify(context.databasePath)});
      await store.init();
      try {
        await store.transition(
          ${JSON.stringify(context.taskId)},
          (task) => task.status === "queued",
          (task) => { task.status = process.argv[1]; },
        );
        console.log(JSON.stringify({ accepted: true, status: process.argv[1] }));
      } catch (error) {
        console.log(JSON.stringify({ accepted: false, code: error.code }));
      } finally {
        store.close();
      }
    `;
    const [first, second] = await Promise.all([
      exec(process.execPath, ["--input-type=module", "--eval", script, "awaiting-plan-approval"]),
      exec(process.execPath, ["--input-type=module", "--eval", script, "cancelled"]),
    ]);
    const results = [first, second].map((result) => JSON.parse(result.stdout.trim()));
    assert.equal(results.filter((result) => result.accepted).length, 1);
    assert.equal(results.filter((result) => result.code === "TASK_TRANSITION_CONFLICT").length, 1);
  } finally {
    seed.close();
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("exports a rollback-compatible JSON snapshot with current SQLite state", async () => {
  const context = await fixture();
  const sqlite = new SqliteTaskStore(context.databasePath, { legacyJsonPath: context.jsonPath });
  try {
    await sqlite.init();
    await sqlite.update(context.taskId, (task) => { task.title = "Exported current title"; });
    const exportPath = path.join(context.directory, "rollback.json");
    const result = await sqlite.exportJson(exportPath);
    assert.equal(result.tasks, 1);
    const exported = JSON.parse(await readFile(exportPath, "utf8"));
    assert.equal(exported.tasks[0].title, "Exported current title");
    assert.equal(exported.tasks[0].artifacts[0].content, "# Triage\n\nRetained content.");
  } finally {
    sqlite.close();
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("fails closed when the legacy JSON authority changes after migration", async () => {
  const context = await fixture();
  const sqlite = new SqliteTaskStore(context.databasePath, { legacyJsonPath: context.jsonPath });
  try {
    await sqlite.init();
    sqlite.close();
    const state = JSON.parse(await readFile(context.jsonPath, "utf8"));
    state.tasks[0].title = "Changed through legacy fallback";
    await writeFile(context.jsonPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    const reopened = new SqliteTaskStore(context.databasePath, { legacyJsonPath: context.jsonPath });
    await assert.rejects(
      reopened.init(),
      /changed after SQLite migration/i,
    );
    reopened.close();
  } finally {
    sqlite.close();
    await rm(context.directory, { recursive: true, force: true });
  }
});
