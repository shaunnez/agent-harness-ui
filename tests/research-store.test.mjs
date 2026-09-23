import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { normalizePdfCapture, serializePdfSnapshot } from "../server/research/research-source-snapshots.mjs";
import { createResearchRuntimeRegistry } from "../server/research/research-runtime-registry.mjs";
import { ResearchService } from "../server/research/research-service.mjs";
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
      // The fake runtime has no host-retained snapshot to verify against.
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

/** A runtime that claims its own quotes are verified. Nothing else about it is unusual: the
 *  point is that an honest-looking result carrying one dishonest field is still not trusted. */
class HostileResearchRuntime {
  id = "hostile";
  #runId = null;

  async start(request) {
    this.#runId = request.id;
    return { runId: request.id, status: "running" };
  }

  async status() {
    return { runId: this.#runId, status: "completed", usage: { modelCalls: 1, partial: false } };
  }

  async cancel() {}

  async *events(runId) {
    const source = {
      id: "source-1",
      sourceType: "web",
      url: "https://example.invalid/hostile",
      title: "Hostile source",
      retrievedAt: "2026-01-01T00:00:00.000Z",
    };
    yield {
      id: `${runId}-E1`,
      ordinal: 1,
      runId,
      timestamp: source.retrievedAt,
      type: "run.started",
      data: {},
    };
    yield {
      id: `${runId}-E2`,
      ordinal: 2,
      runId,
      timestamp: source.retrievedAt,
      type: "source.retrieved",
      data: { source },
    };
  }

  async result(runId) {
    return {
      runId,
      summary: "Trust me.",
      findings: [
        {
          id: "F1",
          claim: "The runtime says this quote was checked.",
          producedBy: "researcher",
          evidence: [
            {
              sourceId: "source-1",
              sourceType: "web",
              url: "https://example.invalid/hostile",
              retrievedAt: "2026-01-01T00:00:00.000Z",
              excerpt: "A quote nobody on the host side has ever seen.",
              // The lie under test.
              quoteVerified: true,
            },
          ],
        },
      ],
      artifacts: [],
      usage: { modelCalls: 1, partial: false },
    };
  }
}

test("a runtime cannot mark its own evidence verified", async () => {
  await withResearchStore(async ({ store, db }) => {
    const runtime = new HostileResearchRuntime();
    const service = new ResearchService({ store, registry: createResearchRuntimeRegistry([runtime]) });
    const created = await service.createRun({ objective: "Trust nothing", runtimeId: "hostile" });
    await service.settled(created.id);

    const rows = db.prepare("SELECT quote_verified FROM research_evidence WHERE run_id = ?").all(created.id);
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].quote_verified), 0, "the persisted row ignores the runtime's claim");

    const result = await service.getResult(created.id);
    assert.equal(result.findings[0].evidence[0].quoteVerified, false, "and so does the returned result");
    // The rest of the evidence survives: only the verification verdict is host-owned.
    assert.equal(result.findings[0].evidence[0].excerpt, "A quote nobody on the host side has ever seen.");
  });
});

test("the host marks evidence verified only after re-reading the matching retained snapshot", async () => {
  await withResearchStore(async ({ store, sourceSnapshotDirectory }) => {
    const run = await store.createRun({
      runtimeId: "claude-cli",
      request: requestFor("Verify retained evidence"),
      budget: resolveResearchBudget("standard"),
    });
    const content = "Application\nApply two coats to the prepared substrate.";
    const digest = createHash("sha256").update(content).digest("hex");
    await mkdir(sourceSnapshotDirectory, { recursive: true });
    await writeFile(path.join(sourceSnapshotDirectory, `${digest}.txt`), content);
    await store.upsertSource(run.id, {
      id: "source-1",
      sourceType: "web",
      url: "https://manufacturer.example/application",
      title: "Application guide",
      retrievedAt: "2026-09-21T00:00:00.000Z",
      contentSha256: digest,
      contentBytes: Buffer.byteLength(content),
      mediaType: "text/plain",
      metadata: { snapshotRef: `sha256:${digest}` },
    });
    await store.recordResult(run.id, {
      runId: run.id,
      findings: [
        {
          id: "F1",
          claim: "Two coats are required.",
          producedBy: "researcher",
          evidence: [
            {
              sourceId: "source-1",
              excerpt: "Apply two coats to the prepared substrate.",
              snapshotRef: `sha256:${digest}`,
              quoteVerified: false,
            },
          ],
        },
        {
          id: "F2",
          claim: "A tampered reference is not verified.",
          producedBy: "researcher",
          evidence: [
            {
              sourceId: "source-1",
              excerpt: "Apply three coats.",
              snapshotRef: `sha256:${digest}`,
              quoteVerified: true,
            },
          ],
        },
      ],
      artifacts: [],
    });

    const result = await store.getResult(run.id);
    assert.equal(result.findings[0].evidence[0].quoteVerified, true);
    assert.equal(result.findings[1].evidence[0].quoteVerified, false);
  });
});

test("the store verifies PDF excerpts only on the cited physical page", async () => {
  await withResearchStore(async ({ store, sourceSnapshotDirectory }) => {
    const run = await store.createRun({
      runtimeId: "claude-cli",
      request: requestFor("Verify a PDF page"),
      budget: resolveResearchBudget("standard"),
    });
    const envelope = serializePdfSnapshot(
      normalizePdfCapture({
        pages: [
          { pageNumber: 1, content: "First page only" },
          { pageNumber: 2, content: "THERMAL PERFORMANCE" },
        ],
        numPages: 2,
        totalPages: 2,
        pageCap: 3,
      }),
    );
    const digest = createHash("sha256").update(envelope).digest("hex");
    await mkdir(sourceSnapshotDirectory, { recursive: true });
    await writeFile(path.join(sourceSnapshotDirectory, `${digest}.txt`), envelope, { mode: 0o600 });
    await store.upsertSource(run.id, {
      id: "source-pdf",
      sourceType: "web",
      url: "https://example.test/guide.pdf",
      title: "Guide",
      retrievedAt: "2026-09-21T00:00:00.000Z",
      contentSha256: digest,
      contentBytes: Buffer.byteLength(envelope),
      mediaType: "application/pdf",
      metadata: { snapshotRef: `sha256:${digest}`, snapshotFormat: "research-pdf-v1" },
    });
    await store.recordResult(run.id, {
      findings: [
        {
          id: "F1",
          claim: "Correct page",
          producedBy: "researcher",
          evidence: [
            {
              sourceId: "source-pdf",
              excerpt: "THERMAL PERFORMANCE",
              locator: { page: 2 },
              snapshotRef: `sha256:${digest}`,
            },
          ],
        },
        {
          id: "F2",
          claim: "Wrong page",
          producedBy: "researcher",
          evidence: [
            {
              sourceId: "source-pdf",
              excerpt: "THERMAL PERFORMANCE",
              locator: { page: 1 },
              snapshotRef: `sha256:${digest}`,
            },
          ],
        },
      ],
      artifacts: [],
    });
    const result = await store.getResult(run.id);
    assert.equal(result.findings[0].evidence[0].quoteVerified, true);
    assert.equal(result.findings[1].evidence[0].quoteVerified, false);
  });
});

test("source identity is scoped to its run", async () => {
  await withResearchStore(async ({ store, db }) => {
    const runs = [];
    for (const objective of ["First question", "Second question"]) {
      const run = await store.createRun({ runtimeId: "fake", request: requestFor(objective), budget: {} });
      // Both runs number their sources from one, the way an independent runtime would.
      await store.upsertSource(run.id, {
        id: "source-1",
        sourceType: "web",
        url: `https://example.invalid/${run.id}`,
        title: `Source for ${objective}`,
        retrievedAt: "2026-01-01T00:00:00.000Z",
      });
      await store.recordResult(run.id, {
        runId: run.id,
        findings: [
          {
            id: "F1",
            claim: objective,
            producedBy: "researcher",
            evidence: [{ sourceId: "source-1", excerpt: `Excerpt for ${objective}` }],
          },
        ],
        artifacts: [],
      });
      runs.push(run);
    }

    const shared = db.prepare("SELECT run_id, url FROM research_sources WHERE id = 'source-1'").all();
    assert.equal(shared.length, 2, "both source records survive independently");
    assert.deepEqual(shared.map((row) => row.run_id).sort(), runs.map((run) => run.id).sort());

    for (const run of runs) {
      const sources = await store.listSources(run.id);
      assert.deepEqual(
        sources.map((source) => source.url),
        [`https://example.invalid/${run.id}`],
        "a run sees only its own source",
      );
      const result = await store.getResult(run.id);
      assert.equal(result.findings[0].evidence[0].url, `https://example.invalid/${run.id}`);
      assert.equal(result.findings[0].evidence[0].title, `Source for ${result.findings[0].claim}`);
    }

    // And the database refuses a citation that reaches across runs, rather than relying on
    // every future writer remembering to scope the lookup.
    assert.throws(() =>
      db
        .prepare(`
          INSERT INTO research_evidence(run_id, finding_id, id, ordinal, source_id, quote_verified)
          VALUES (?, 'F1', 'F1#2', 2, 'source-1', 0)
        `)
        .run("RSCH-404"),
    );
  });
});

test("a database carrying the pre-review global source id migrates forward", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-research-legacy-"));
  try {
    const file = path.join(directory, "tasks.sqlite3");
    const legacy = new DatabaseSync(file);
    legacy.exec("PRAGMA foreign_keys = ON");
    migrateSqliteSchema(legacy);
    // Recreate the shape slice 1 shipped to review: a globally unique source id.
    legacy.exec(`
      DROP TABLE research_evidence;
      DROP TABLE research_sources;
      CREATE TABLE research_sources (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
        source_type TEXT NOT NULL, url TEXT, title TEXT, retrieved_at TEXT NOT NULL,
        content_sha256 TEXT, content_bytes INTEGER, media_type TEXT, metadata_json TEXT);
      CREATE TABLE research_evidence (
        run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
        finding_id TEXT NOT NULL, id TEXT NOT NULL, ordinal INTEGER NOT NULL, source_id TEXT NOT NULL,
        locator_json TEXT, excerpt TEXT, snapshot_ref TEXT, quote_verified INTEGER NOT NULL,
        authority TEXT, PRIMARY KEY (run_id, id));
    `);
    const store = new ResearchStore(legacy);
    const run = await store.createRun({ runtimeId: "fake", request: requestFor("Legacy run"), budget: {} });
    legacy
      .prepare(
        "INSERT INTO research_sources(id, run_id, source_type, retrieved_at) VALUES ('source-1', ?, 'web', '2026-01-01T00:00:00.000Z')",
      )
      .run(run.id);
    legacy
      .prepare(`
        INSERT INTO research_evidence(run_id, finding_id, id, ordinal, source_id, excerpt, quote_verified)
        VALUES (?, 'F1', 'F1#1', 1, 'source-1', 'Carried across', 1)
      `)
      .run(run.id);
    legacy.close();

    const reopened = new DatabaseSync(file);
    reopened.exec("PRAGMA foreign_keys = ON");
    migrateSqliteSchema(reopened);
    const sources = reopened.prepare("SELECT sql FROM sqlite_master WHERE name = 'research_sources'").get();
    assert.match(sources.sql, /PRIMARY KEY \(run_id, id\)/);
    const evidence = reopened.prepare("SELECT * FROM research_evidence WHERE run_id = ?").all(run.id);
    assert.equal(evidence.length, 1, "the evidence row survives the rebuild");
    assert.equal(evidence[0].excerpt, "Carried across");
    // A verified flag written before the host owned the column is not grandfathered in.
    assert.equal(Number(evidence[0].quote_verified), 0);
    assert.equal(Number(reopened.prepare("SELECT COUNT(*) AS count FROM research_sources").get().count), 1);
    reopened.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a run records what answered it, and a runtime that reports nothing stays unknown", async () => {
  await withResearchService(async ({ service, runtime, store }) => {
    const run = await service.createRun({ objective: "Record the model identity." });
    // The fake runtime is honest about being a fake: `live: false` is what a reader needs in
    // order to distinguish an invented finding from a real one without recognising a provider
    // name, and it is the whole of phase 0's second half.
    assert.deepEqual(run.model, { provider: "fake", model: "deterministic-fake", live: false });

    await runToEnd(service, runtime, run.id);
    // It survives on the record and reaches the result, so a finding read on its own still
    // says what produced it.
    assert.deepEqual((await service.getRun(run.id)).model, run.model);
    assert.deepEqual((await service.getResult(run.id)).model, run.model);
    assert.deepEqual((await store.listRuns({}))[0].model, run.model);
  });
});

test("an identity the runtime never reported is null, never a plausible default", async () => {
  await withResearchStore(async ({ store }) => {
    const silent = {
      id: "silent",
      async start(request) {
        return {
          runId: request.id,
          runtimeId: "silent",
          status: "running",
          startedAt: new Date().toISOString(),
        };
      },
      async status(runId) {
        return { runId, status: "completed", usage: { partial: false } };
      },
      async cancel() {},
      async *events() {},
      async result(runId) {
        return { runId, findings: [], artifacts: [], usage: { partial: false } };
      },
    };
    const service = new ResearchService({ store, registry: createResearchRuntimeRegistry([silent]) });
    const run = await service.createRun({ objective: "Say nothing about the model.", runtimeId: "silent" });
    await service.settled(run.id);
    assert.equal(run.model, null);
    assert.equal((await service.getRun(run.id)).model, null);
  });
});
