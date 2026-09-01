import { createHash } from "node:crypto";
import { access, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { cleanupOrphanAttachmentSets } from "./attachment-storage.mjs";
import { defaultRuntimeSettings } from "./model-catalog.mjs";
import { retainRunActivityEvents, TASK_STORE_SCHEMA_VERSION } from "./run-activity.mjs";
import {
  assertProjectIsUnique,
  createTaskRecord,
  linkTaskContinuation,
  migratePersistedTaskState,
  projectRecord,
} from "./store.mjs";
import {
  normalizeActivityFilter,
  projectArtifactMetadata,
  projectTaskCore,
  projectTaskPollState,
  projectTaskSummary,
} from "./task-projections.mjs";
import {
  assertImportState,
  canonicalJson,
  migrateSqliteSchema,
  querySqlitePage,
  syncTaskCollection,
} from "./sqlite-storage.mjs";

export class SqliteTaskStore {
  #filePath;
  #legacyJsonPath;
  #db = null;
  #queue = Promise.resolve();

  constructor(filePath, { legacyJsonPath = null } = {}) {
    this.#filePath = filePath;
    this.#legacyJsonPath = legacyJsonPath;
  }

  dataDirectory() {
    return path.dirname(this.#filePath);
  }

  async init() {
    this.#db = new DatabaseSync(this.#filePath);
    // Startup can legitimately overlap when a stale companion is still exiting or a second
    // process is competing for one transition. Apply the busy handler before WAL negotiation,
    // because `journal_mode = WAL` itself takes a database lock.
    this.#db.exec("PRAGMA busy_timeout = 5000");
    this.#db.exec("PRAGMA foreign_keys = ON");
    this.#db.exec("PRAGMA journal_mode = WAL");
    this.#db.exec("PRAGMA synchronous = FULL");
    migrateSqliteSchema(this.#db);
    if (!this.#hasState()) {
      const legacy = await this.#readLegacyState();
      if (legacy) {
        this.#importState(legacy.state, legacy.sourceHash);
        await this.#assertLegacySourceUnchanged();
      } else this.#initializeEmptyState();
    } else await this.#assertLegacySourceUnchanged();
    await this.recoverInterrupted();
    await cleanupOrphanAttachmentSets(this.dataDirectory(), this.#readAttachmentOwners());
    this.#db.exec("PRAGMA optimize");
  }

  close() {
    this.#db?.close();
    this.#db = null;
  }

  async list() {
    return clone(this.#readAllTasks());
  }

  async listPullRequestTasks() {
    return clone(
      this.#db
        .prepare(`
      SELECT id
      FROM tasks
      WHERE
        (status = 'merging' AND json_extract(core_json, '$.pullRequestIntent.status') = 'publishing') OR
        (status = 'awaiting-pr-merge' AND json_extract(core_json, '$.pullRequestIntent.status') = 'open')
      ORDER BY updated_at ASC, id ASC
    `)
        .all()
        .map((row) => this.#readTask(row.id)),
    );
  }

  async listWorktreeTasks() {
    return clone(
      this.#db
        .prepare(`
      SELECT core_json
      FROM tasks
      WHERE json_array_length(json_extract(core_json, '$.workPackages')) > 0 OR
        json_array_length(json_extract(core_json, '$.candidates')) > 0
      ORDER BY created_at DESC, id DESC
    `)
        .all()
        .map((row) => JSON.parse(row.core_json)),
    );
  }

  async listSummaries() {
    const taskRows = this.#db
      .prepare(`
      SELECT
        tasks.core_json,
        tasks.revision AS poll_version,
        (SELECT COUNT(*) FROM artifacts WHERE artifacts.task_id = tasks.id) AS artifact_count,
        (SELECT COUNT(*) FROM events WHERE events.task_id = tasks.id) AS event_count,
        (SELECT COUNT(*) FROM runs WHERE runs.task_id = tasks.id) AS run_count
      FROM tasks
      ORDER BY created_at DESC, id DESC
    `)
      .all();
    const metadataRows = this.#db
      .prepare(`
      SELECT task_id, metadata_json
      FROM (
        SELECT
          task_id,
          metadata_json,
          ordinal,
          ROW_NUMBER() OVER (PARTITION BY task_id, stage ORDER BY created_at DESC, id DESC) AS stage_rank
        FROM artifacts
      )
      WHERE stage_rank = 1
      ORDER BY task_id, ordinal
    `)
      .all();
    const artifactsByTask = new Map();
    for (const row of metadataRows) {
      const artifacts = artifactsByTask.get(row.task_id) ?? [];
      artifacts.push(JSON.parse(row.metadata_json));
      artifactsByTask.set(row.task_id, artifacts);
    }
    return taskRows.map((row) => {
      const core = JSON.parse(row.core_json);
      return projectTaskSummary(
        {
          ...core,
          artifacts: artifactsByTask.get(core.id) ?? [],
        },
        {
          artifactCount: Number(row.artifact_count),
          eventCount: Number(row.event_count),
          runCount: Number(row.run_count),
          pollVersion: String(row.poll_version),
        },
      );
    });
  }

  async listPollStates() {
    return this.#db
      .prepare(`
      SELECT id, revision
      FROM tasks
      ORDER BY created_at DESC, id DESC
    `)
      .all()
      .map((row) => projectTaskPollState({ id: row.id }, row.revision));
  }

  async listEvaluationTasks() {
    const tasks = this.#db
      .prepare(`
      SELECT core_json
      FROM tasks
      ORDER BY created_at DESC, id DESC
    `)
      .all()
      .map((row) => ({
        ...JSON.parse(row.core_json),
        artifacts: [],
      }));
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const artifactRows = this.#db
      .prepare(`
      SELECT
        task_id,
        metadata_json,
        json_extract(payload_json, '$.gateResult') AS gate_result_json,
        json_extract(payload_json, '$.contextManifest') AS context_manifest_json
      FROM artifacts
      ORDER BY task_id, ordinal
    `)
      .all();
    for (const row of artifactRows) {
      const task = byId.get(row.task_id);
      if (!task) continue;
      task.artifacts.push({
        ...JSON.parse(row.metadata_json),
        ...optionalJsonField("gateResult", row.gate_result_json),
        ...optionalJsonField("contextManifest", row.context_manifest_json),
      });
    }
    return tasks;
  }

  async get(id) {
    return clone(this.#readTask(id));
  }

  async getCore(id) {
    const task = this.#readTask(id, { includeEvents: false, includeRuns: false, includeArtifacts: false });
    if (!task) return null;
    const counts = this.#db
      .prepare(`
      SELECT
        (SELECT revision FROM tasks WHERE id = ?) AS poll_version,
        (SELECT COUNT(*) FROM artifacts WHERE task_id = ?) AS artifact_count,
        (SELECT COUNT(*) FROM events WHERE task_id = ?) AS event_count,
        (SELECT COUNT(*) FROM runs WHERE task_id = ?) AS run_count
    `)
      .get(id, id, id, id);
    return {
      ...projectTaskCore(task),
      artifactCount: Number(counts.artifact_count),
      eventCount: Number(counts.event_count),
      runCount: Number(counts.run_count),
      pollVersion: String(counts.poll_version),
    };
  }

  async getPollState(id) {
    const row = this.#db.prepare("SELECT id, revision FROM tasks WHERE id = ?").get(id);
    return row ? projectTaskPollState({ id: row.id }, row.revision) : null;
  }

  async getArtifact(taskId, artifactId) {
    const row = this.#db
      .prepare("SELECT payload_json FROM artifacts WHERE task_id = ? AND id = ?")
      .get(taskId, artifactId);
    return row ? JSON.parse(row.payload_json) : null;
  }

  async pageArtifacts(taskId, searchParams) {
    const includeContent = searchParams.get("include") === "content";
    return querySqlitePage(this.#db, {
      table: "artifacts",
      taskId,
      searchParams,
      sortColumn: "created_at",
      payloadColumn: includeContent ? "payload_json" : "metadata_json",
    });
  }

  async pageRuns(taskId, searchParams) {
    const filter = normalizeActivityFilter(searchParams.get("filter"));
    const filterSql =
      filter === "test"
        ? "AND (stage = 'test' OR json_extract(payload_json, '$.kind') = 'test')"
        : filter === "agent"
          ? "AND stage <> 'test' AND COALESCE(json_extract(payload_json, '$.kind'), '') <> 'test'"
          : "";
    return querySqlitePage(this.#db, {
      table: "runs",
      taskId,
      searchParams,
      sortColumn: "started_at",
      payloadColumn: "payload_json",
      filterSql,
    });
  }

  async pageEvents(taskId, searchParams) {
    const filter = normalizeActivityFilter(searchParams.get("filter"));
    const filterSql = {
      all: "",
      activity: "AND category IN ('activity', 'artifact')",
      agent:
        "AND category = 'agent' AND COALESCE(json_extract(payload_json, '$.runKind'), '') <> 'test' AND COALESCE(json_extract(payload_json, '$.role'), '') <> 'test'",
      test: "AND (json_extract(payload_json, '$.runKind') = 'test' OR json_extract(payload_json, '$.role') = 'test')",
      decision:
        "AND (category = 'decision' OR json_extract(payload_json, '$.decisionId') IS NOT NULL OR json_extract(payload_json, '$.approvalId') IS NOT NULL)",
    }[filter];
    return querySqlitePage(this.#db, {
      table: "events",
      taskId,
      searchParams,
      sortColumn: "occurred_at",
      payloadColumn: "payload_json",
      filterSql,
    });
  }

  async settings() {
    return clone(this.#readSettings());
  }

  async listProjects() {
    return clone(this.#readSettings().projects ?? []);
  }

  async createProject(input) {
    return this.#enqueue(() =>
      this.#transaction(() => {
        const settings = this.#readSettings();
        settings.projects ??= [];
        const projects = settings.projects;
        assertProjectIsUnique(projects, input);
        const project = projectRecord(input);
        projects.push(project);
        this.#db.prepare("UPDATE settings SET payload_json = ? WHERE id = 1").run(JSON.stringify(settings));
        return clone(project);
      }),
    );
  }

  async updateSettings(updater) {
    return this.#enqueue(() =>
      this.#transaction(() => {
        const settings = this.#readSettings();
        updater(settings);
        this.#db.prepare("UPDATE settings SET payload_json = ? WHERE id = 1").run(JSON.stringify(settings));
        return clone(settings);
      }),
    );
  }

  async create(input) {
    return this.#enqueue(() =>
      this.#transaction(() => {
        const nextId = Number(this.#metadata("next_id") ?? 1);
        const state = { nextId, settings: this.#readSettings(), tasks: [] };
        const task = createTaskRecord(state, input);
        this.#insertTask(task);
        this.#setMetadata("next_id", String(state.nextId));
        return clone(task);
      }),
    );
  }

  async createContinuation(sourceId, input, { expectedUpdatedAt = null } = {}) {
    return this.#enqueue(() =>
      this.#transaction(() => {
        const sourceRow = this.#db.prepare("SELECT revision FROM tasks WHERE id = ?").get(sourceId);
        if (!sourceRow) return null;
        const source = this.#readTask(sourceId);
        if (source.continuedByTaskId) {
          const existing = this.#readTask(source.continuedByTaskId);
          if (!existing) {
            const error = new Error(
              `Linked implementation task ${source.continuedByTaskId} could not be found.`,
            );
            error.code = "TASK_TRANSITION_CONFLICT";
            error.statusCode = 409;
            throw error;
          }
          return clone({ task: existing, created: false });
        }
        if (expectedUpdatedAt && source.updatedAt !== expectedUpdatedAt) {
          const error = new Error(
            "The investigation changed before its implementation continuation was created.",
          );
          error.code = "TASK_TRANSITION_CONFLICT";
          error.statusCode = 409;
          throw error;
        }
        const nextId = Number(this.#metadata("next_id") ?? 1);
        const state = { nextId, settings: this.#readSettings(), tasks: [] };
        const task = createTaskRecord(state, input);
        linkTaskContinuation(source, task);
        this.#insertTask(task);
        this.#updateTask(source, Number(sourceRow.revision));
        this.#setMetadata("next_id", String(state.nextId));
        return clone({ task, created: true });
      }),
    );
  }

  async update(id, updater) {
    return this.#mutateTask(id, null, updater);
  }

  async updateCore(id, updater, { touchUpdatedAt = true } = {}) {
    return this.#enqueue(() =>
      this.#transaction(() => {
        const row = this.#db.prepare("SELECT revision FROM tasks WHERE id = ?").get(id);
        if (!row) return null;
        const task = this.#readTask(id, {
          includeEvents: false,
          includeRuns: false,
          includeArtifacts: false,
        });
        updater(task);
        if (touchUpdatedAt) task.updatedAt = new Date().toISOString();
        this.#updateTaskCore(task, Number(row.revision));
        return clone(task);
      }),
    );
  }

  async transition(id, condition, updater, readTransitionContext) {
    return this.#mutateTask(id, condition, updater, readTransitionContext);
  }

  async recoverInterrupted() {
    return this.#enqueue(() =>
      this.#transaction(() => {
        const state = {
          schemaVersion: Number(this.#metadata("task_store_schema_version") ?? TASK_STORE_SCHEMA_VERSION),
          nextId: Number(this.#metadata("next_id") ?? 1),
          settings: this.#readSettings(),
          tasks: this.#readAllTasks(),
        };
        const changed = migratePersistedTaskState(state);
        if (!changed) return false;
        this.#db
          .prepare("UPDATE settings SET payload_json = ? WHERE id = 1")
          .run(JSON.stringify(state.settings));
        this.#setMetadata("next_id", String(state.nextId));
        this.#setMetadata("task_store_schema_version", String(TASK_STORE_SCHEMA_VERSION));
        for (const task of state.tasks) {
          const row = this.#db.prepare("SELECT revision FROM tasks WHERE id = ?").get(task.id);
          this.#updateTask(task, Number(row.revision));
        }
        return true;
      }),
    );
  }

  async exportJson(outputPath) {
    const state = {
      schemaVersion: TASK_STORE_SCHEMA_VERSION,
      nextId: Number(this.#metadata("next_id") ?? 1),
      tasks: this.#readAllTasks(),
      settings: this.#readSettings(),
    };
    const target = path.resolve(outputPath);
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(temporary, target);
    return { path: target, tasks: state.tasks.length };
  }

  #mutateTask(id, condition, updater, readTransitionContext) {
    return this.#enqueue(async () => {
      const context = await readTransitionContext?.();
      return this.#transaction(() => {
        const row = this.#db.prepare("SELECT revision FROM tasks WHERE id = ?").get(id);
        if (!row) return null;
        const task = this.#readTask(id);
        if (condition && !condition(task, { ...(context ?? {}), settings: this.#readSettings() })) {
          const error = new Error("Task state changed before the requested action could be reserved.");
          error.code = "TASK_TRANSITION_CONFLICT";
          error.statusCode = 409;
          throw error;
        }
        updater(task);
        task.updatedAt = new Date().toISOString();
        task.events = retainRunActivityEvents(task.events);
        this.#updateTask(task, Number(row.revision));
        return clone(task);
      });
    });
  }

  #enqueue(operation) {
    const pending = this.#queue.then(operation, operation);
    this.#queue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }

  #transaction(operation) {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.#db.exec("COMMIT");
      return result;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  #hasState() {
    return Boolean(this.#db.prepare("SELECT 1 AS present FROM settings WHERE id = 1").get());
  }

  #initializeEmptyState() {
    this.#transaction(() => {
      this.#db
        .prepare("INSERT INTO settings(id, payload_json) VALUES (1, ?)")
        .run(JSON.stringify(defaultRuntimeSettings()));
      this.#setMetadata("next_id", "1");
      this.#setMetadata("task_store_schema_version", String(TASK_STORE_SCHEMA_VERSION));
    });
  }

  async #readLegacyState() {
    if (!this.#legacyJsonPath) return null;
    try {
      await access(this.#legacyJsonPath);
    } catch {
      return null;
    }
    const source = await readFile(this.#legacyJsonPath, "utf8");
    const state = JSON.parse(source);
    migratePersistedTaskState(state);
    assertImportState(state);
    return {
      state,
      sourceHash: createHash("sha256").update(source).digest("hex"),
    };
  }

  async #assertLegacySourceUnchanged() {
    const importedHash = this.#metadata("legacy_json_sha256");
    if (!importedHash || !this.#legacyJsonPath) return;
    if (!this.#metadata("legacy_import_complete")) {
      throw new Error(
        "SQLite task-store migration is incomplete; the JSON task store remains authoritative.",
      );
    }
    let source;
    try {
      source = await readFile(this.#legacyJsonPath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    const currentHash = createHash("sha256").update(source).digest("hex");
    if (currentHash !== importedHash) {
      throw new Error(
        "The legacy JSON task store changed after SQLite migration. Refusing to choose an authority automatically; export or reconcile the newer state explicitly.",
      );
    }
  }

  #importState(state, sourceHash) {
    this.#transaction(() => {
      this.#db
        .prepare("INSERT INTO settings(id, payload_json) VALUES (1, ?)")
        .run(JSON.stringify(state.settings ?? defaultRuntimeSettings()));
      this.#setMetadata("next_id", String(state.nextId));
      this.#setMetadata(
        "task_store_schema_version",
        String(state.schemaVersion ?? TASK_STORE_SCHEMA_VERSION),
      );
      this.#setMetadata("legacy_json_sha256", sourceHash);
      for (const task of state.tasks) this.#insertTask(task);
      const imported = this.#readAllTasks();
      const originalById = new Map(state.tasks.map((task) => [task.id, task]));
      if (
        imported.length !== state.tasks.length ||
        imported.some((task) => canonicalJson(task) !== canonicalJson(originalById.get(task.id)))
      ) {
        throw new Error("SQLite import parity check failed; the JSON task store remains authoritative.");
      }
      this.#setMetadata("legacy_import_complete", new Date().toISOString());
    });
  }

  #readAllTasks() {
    return this.#db
      .prepare("SELECT id FROM tasks ORDER BY created_at DESC, id DESC")
      .all()
      .map((row) => this.#readTask(row.id));
  }

  #readAttachmentOwners() {
    return this.#db
      .prepare("SELECT json_extract(core_json, '$.attachments') AS attachments_json FROM tasks")
      .all()
      .map((row) => ({ attachments: JSON.parse(row.attachments_json ?? "[]") }));
  }

  #readTask(
    id,
    { includeEvents = true, includeRuns = true, includeArtifacts = true, artifactMetadataOnly = false } = {},
  ) {
    const row = this.#db.prepare("SELECT core_json FROM tasks WHERE id = ?").get(id);
    if (!row) return null;
    const task = JSON.parse(row.core_json);
    task.artifacts = includeArtifacts
      ? this.#db
          .prepare(
            `SELECT ${artifactMetadataOnly ? "metadata_json" : "payload_json"} AS payload_json
         FROM artifacts WHERE task_id = ? ORDER BY ordinal`,
          )
          .all(id)
          .map((item) => JSON.parse(item.payload_json))
      : [];
    task.events = includeEvents
      ? this.#db
          .prepare("SELECT payload_json FROM events WHERE task_id = ? ORDER BY ordinal")
          .all(id)
          .map((item) => JSON.parse(item.payload_json))
      : [];
    task.runs = includeRuns
      ? this.#db
          .prepare("SELECT payload_json FROM runs WHERE task_id = ? ORDER BY ordinal")
          .all(id)
          .map((item) => JSON.parse(item.payload_json))
      : [];
    return task;
  }

  #insertTask(task) {
    const core = taskCore(task);
    this.#db
      .prepare(`
      INSERT INTO tasks(id, created_at, updated_at, status, current_stage, revision, core_json)
      VALUES (?, ?, ?, ?, ?, 1, ?)
    `)
      .run(task.id, task.createdAt, task.updatedAt, task.status, task.currentStage, JSON.stringify(core));
    this.#syncCollections(task);
  }

  #updateTask(task, expectedRevision) {
    this.#updateTaskCore(task, expectedRevision);
    this.#syncCollections(task);
  }

  #updateTaskCore(task, expectedRevision) {
    const result = this.#db
      .prepare(`
      UPDATE tasks
      SET created_at = ?, updated_at = ?, status = ?, current_stage = ?, revision = revision + 1, core_json = ?
      WHERE id = ? AND revision = ?
    `)
      .run(
        task.createdAt,
        task.updatedAt,
        task.status,
        task.currentStage,
        JSON.stringify(taskCore(task)),
        task.id,
        expectedRevision,
      );
    if (Number(result.changes) !== 1) {
      const error = new Error("Task state changed before the requested action could be persisted.");
      error.code = "TASK_TRANSITION_CONFLICT";
      error.statusCode = 409;
      throw error;
    }
  }

  #syncCollections(task) {
    syncTaskCollection(this.#db, "artifacts", task.id, task.artifacts ?? [], (artifact, ordinal) => ({
      id: artifact.id,
      ordinal,
      sort: artifact.createdAt ?? "",
      type: artifact.stage ?? "",
      metadata: JSON.stringify(projectArtifactMetadata(artifact)),
      payload: JSON.stringify(artifact),
    }));
    syncTaskCollection(this.#db, "events", task.id, task.events ?? [], (event, ordinal) => ({
      id: event.id,
      ordinal,
      sort: event.at ?? "",
      type: event.category ?? "activity",
      payload: JSON.stringify(event),
    }));
    syncTaskCollection(this.#db, "runs", task.id, task.runs ?? [], (run, ordinal) => ({
      id: run.id,
      ordinal,
      sort: run.startedAt ?? run.completedAt ?? "",
      type: run.stage ?? "triage",
      status: run.status ?? "completed",
      payload: JSON.stringify(run),
    }));
  }

  #readSettings() {
    const row = this.#db.prepare("SELECT payload_json FROM settings WHERE id = 1").get();
    if (!row) throw new Error("SQLite task store settings are missing.");
    return JSON.parse(row.payload_json);
  }

  #metadata(key) {
    return this.#db.prepare("SELECT value FROM metadata WHERE key = ?").get(key)?.value ?? null;
  }

  #setMetadata(key, value) {
    this.#db
      .prepare(`
      INSERT INTO metadata(key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `)
      .run(key, value);
  }
}

function taskCore(task) {
  const { artifacts: _artifacts, events: _events, runs: _runs, ...core } = task;
  return core;
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function optionalJsonField(name, value) {
  if (value == null) return {};
  if (typeof value !== "string") return { [name]: value };
  try {
    return { [name]: JSON.parse(value) };
  } catch {
    return { [name]: value };
  }
}
