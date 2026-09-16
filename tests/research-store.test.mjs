import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { ResearchStore } from "../server/research/research-store.mjs";
import { DATABASE_SCHEMA_VERSION, migrateSqliteSchema } from "../server/sqlite-storage.mjs";
import { SqliteTaskStore } from "../server/sqlite-store.mjs";
import { resolveResearchBudget } from "../src/research-budget-policy.ts";
import { runToEnd, withResearchService, withResearchStore } from "./research-test-support.mjs";

function requestFor(objective, profile = "standard") {
  return { id: "", objective, profile, context: [], budget: resolveResearchBudget(profile) };
}

test("the research schema is additive and leaves the task plane untouched", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-research-schema-"));
  try {
    const store = new SqliteTaskStore(path.join(directory, "tasks.sqlite3"));
    await store.init();
    const db = store.databaseHandle();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name);
    for (const table of ["tasks", "artifacts", "events", "runs", "settings", "metadata"]) {
      assert.ok(tables.includes(table), `${table} survives the research migration`);
    }
    for (const table of [
      "research_runs",
      "research_events",
      "research_sources",
      "research_findings",
      "research_evidence",
      "research_artifacts",
    ]) {
      assert.ok(tables.includes(table), `${table} is created`);
    }
    assert.equal(DATABASE_SCHEMA_VERSION, 4);
    assert.ok(
      db.prepare("SELECT 1 AS present FROM schema_migrations WHERE version = 4").get(),
      "the migration is recorded",
    );
    // The task plane keeps its original columns; nothing was altered to make room.
    const taskColumns = db
      .prepare("SELECT name FROM pragma_table_info('tasks')")
      .all()
      .map((row) => row.name);
    assert.deepEqual(taskColumns, [
      "id",
      "created_at",
      "updated_at",
      "status",
      "current_stage",
      "revision",
      "core_json",
    ]);
    store.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a research run round-trips through SQLite with its budget unchanged", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-research-reopen-"));
  const databasePath = path.join(directory, "tasks.sqlite3");
  try {
    const budget = resolveResearchBudget("deep", { maxUsd: 12.5, maxTokens: 500_000 });
    let runId;
    {
      const db = new DatabaseSync(databasePath);
      migrateSqliteSchema(db);
      const store = new ResearchStore(db);
      const created = await store.createRun({
        runtimeId: "fake",
        request: { ...requestFor("Survive a restart", "deep"), budget },
        budget,
      });
      runId = created.id;
      await store.updateRun(runId, (draft) => {
        draft.status = "running";
        draft.usage = { inputTokens: 10, outputTokens: 4, modelCalls: 1, partial: false };
        draft.runtimeMetadata = { opaqueCorrelationId: "abc-123" };
      });
      db.close();
    }
    const db = new DatabaseSync(databasePath);
    const store = new ResearchStore(db);
    const reopened = await store.getRun(runId);
    assert.equal(reopened.status, "running");
    // The ceilings a run was admitted under are exactly the ceilings it can be audited
    // against later; a lossy round-trip would make that audit meaningless.
    assert.deepEqual(reopened.budget, budget);
    assert.deepEqual(reopened.request.budget, budget);
    assert.equal(reopened.usage.modelCalls, 1);
    assert.equal(reopened.usage.partial, false);
    // Runtime correlation data is retrievable by an adapter and absent from the record.
    assert.deepEqual(await store.runtimeMetadata(runId), { opaqueCorrelationId: "abc-123" });
    assert.ok(!("runtimeMetadata" in reopened), "the public record carries no runtime metadata");
    db.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("run updates are guarded by revision, the way task updates are", async () => {
  await withResearchStore(async ({ store }) => {
    const created = await store.createRun({
      runtimeId: "fake",
      request: requestFor("Guard concurrent writes"),
      budget: resolveResearchBudget("standard"),
    });
    assert.equal(created.revision, 1);
    const updated = await store.updateRun(created.id, (draft) => {
      draft.status = "running";
    });
    assert.equal(updated.revision, 2);
    assert.equal(await store.getRun("RSCH-404"), null);
    assert.equal(
      await store.updateRun("RSCH-404", (draft) => {
        draft.status = "running";
      }),
      null,
    );
  });
});

test("events are append-only with a monotonic ordinal and a usable cursor", async () => {
  await withResearchStore(async ({ store }) => {
    const created = await store.createRun({
      runtimeId: "fake",
      request: requestFor("Page through events"),
      budget: resolveResearchBudget("standard"),
    });
    for (let index = 1; index <= 5; index += 1) {
      const stored = await store.appendEvent(created.id, {
        id: `E${index}`,
        runId: created.id,
        ordinal: 0,
        timestamp: `2026-09-17T00:00:0${index}.000Z`,
        type: "log",
        data: { index },
      });
      assert.equal(stored.ordinal, index, "the store assigns the ordinal, not the runtime");
    }
    const first = await store.listEvents(created.id, { limit: 2 });
    assert.deepEqual(
      first.events.map((event) => event.ordinal),
      [1, 2],
    );
    assert.equal(first.nextCursor, "2");
    const next = await store.listEvents(created.id, { afterOrdinal: first.nextCursor, limit: 10 });
    assert.deepEqual(
      next.events.map((event) => event.ordinal),
      [3, 4, 5],
    );
    assert.equal(next.nextCursor, null);
  });
});

test("claims, evidence and sources are separate rows, not a blob", async () => {
  await withResearchService(async ({ service, runtime, db }) => {
    const created = await service.createRun({ objective: "Keep evidence first class" });
    await runToEnd(service, runtime, created.id);

    const counts = Object.fromEntries(
      ["research_findings", "research_evidence", "research_sources", "research_artifacts"].map((table) => [
        table,
        Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE run_id = ?`).get(created.id).count),
      ]),
    );
    assert.equal(counts.research_findings, 3);
    assert.equal(counts.research_evidence, 3);
    assert.equal(counts.research_sources, 3);
    // Three fake artifacts: the brief plus the internal result-summary row.
    assert.equal(counts.research_artifacts, 2);

    const evidence = db
      .prepare("SELECT * FROM research_evidence WHERE run_id = ? ORDER BY finding_id ASC")
      .all(created.id);
    for (const row of evidence) {
      assert.ok(row.source_id, "evidence points at a source row");
      assert.ok(row.excerpt, "evidence retains the excerpt");
      assert.ok(row.locator_json, "evidence retains an exact locator");
      // The host, not the runtime, owns this column, and slice 1 has nothing to verify against.
      assert.equal(Number(row.quote_verified), 0);
    }
    const sources = await service.listSources(created.id);
    assert.equal(sources.length, 3);
    assert.ok(sources.every((source) => source.retrievedAt && source.url));
    // No host-side snapshot exists yet, and the columns say so rather than inventing one.
    assert.ok(sources.every((source) => source.contentSha256 === null));
  });
});

test("deleting a run cascades to everything the run owns", async () => {
  await withResearchService(async ({ service, runtime, db }) => {
    const created = await service.createRun({ objective: "Cascade cleanly" });
    await runToEnd(service, runtime, created.id);
    db.exec("PRAGMA foreign_keys = ON");
    db.prepare("DELETE FROM research_runs WHERE id = ?").run(created.id);
    for (const table of ["research_events", "research_findings", "research_evidence", "research_sources"]) {
      assert.equal(
        Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE run_id = ?`).get(created.id).count),
        0,
        `${table} is cascaded`,
      );
    }
  });
});
