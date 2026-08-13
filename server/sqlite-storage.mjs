import { decodePageCursor, encodePageCursor, normalizePageLimit } from "./task-projections.mjs";

export const DATABASE_SCHEMA_VERSION = 2;

export function migrateSqliteSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      payload_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      status TEXT NOT NULL,
      current_stage TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      core_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS artifacts (
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      stage TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (task_id, id)
    );
    CREATE TABLE IF NOT EXISTS events (
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      occurred_at TEXT NOT NULL,
      category TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (task_id, id)
    );
    CREATE TABLE IF NOT EXISTS runs (
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      started_at TEXT NOT NULL,
      stage TEXT NOT NULL,
      status TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (task_id, id)
    );
    CREATE INDEX IF NOT EXISTS tasks_updated_idx ON tasks(updated_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS tasks_created_idx ON tasks(created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS artifacts_page_idx ON artifacts(task_id, created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS events_page_idx ON events(task_id, occurred_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS runs_page_idx ON runs(task_id, started_at DESC, id DESC);
  `);
  db.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(
    DATABASE_SCHEMA_VERSION,
    new Date().toISOString(),
  );
}

export function syncTaskCollection(db, table, taskId, items, project) {
  const existingRows = db.prepare(`SELECT * FROM ${table} WHERE task_id = ?`).all(taskId);
  const existingById = new Map(existingRows.map((row) => [row.id, row]));
  const incomingIds = new Set(items.map((item) => item.id));
  const remove = db.prepare(`DELETE FROM ${table} WHERE task_id = ? AND id = ?`);
  for (const id of existingById.keys()) {
    if (!incomingIds.has(id)) remove.run(taskId, id);
  }
  for (const [ordinal, item] of items.entries()) {
    const row = project(item, ordinal);
    if (storedCollectionRowMatches(table, existingById.get(row.id), row)) continue;
    if (table === "artifacts") upsertArtifact(db, taskId, row);
    else if (table === "events") upsertEvent(db, taskId, row);
    else upsertRun(db, taskId, row);
  }
}

function storedCollectionRowMatches(table, stored, projected) {
  if (!stored || Number(stored.ordinal) !== projected.ordinal) return false;
  if (stored.payload_json !== projected.payload) return false;
  if (table === "artifacts") {
    return (
      stored.created_at === projected.sort &&
      stored.stage === projected.type &&
      stored.metadata_json === projected.metadata
    );
  }
  if (table === "events") {
    return stored.occurred_at === projected.sort && stored.category === projected.type;
  }
  return (
    stored.started_at === projected.sort &&
    stored.stage === projected.type &&
    stored.status === projected.status
  );
}

export function querySqlitePage(
  db,
  { table, taskId, searchParams, sortColumn, payloadColumn, filterSql = "" },
) {
  if (!db.prepare("SELECT 1 AS present FROM tasks WHERE id = ?").get(taskId)) return null;
  const limit = normalizePageLimit(searchParams.get("limit"));
  const cursor = decodePageCursor(searchParams.get("cursor"));
  const cursorSql = cursor ? `AND (${sortColumn} < ? OR (${sortColumn} = ? AND id < ?))` : "";
  const parameters = cursor ? [taskId, cursor[0], cursor[0], cursor[1], limit + 1] : [taskId, limit + 1];
  const rows = db
    .prepare(`
    SELECT id, ${sortColumn} AS sort_value, ${payloadColumn} AS payload_json
    FROM ${table}
    WHERE task_id = ? ${filterSql} ${cursorSql}
    ORDER BY ${sortColumn} DESC, id DESC
    LIMIT ?
  `)
    .all(...parameters);
  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const total = Number(
    db
      .prepare(`
    SELECT COUNT(*) AS count FROM ${table} WHERE task_id = ? ${filterSql}
  `)
      .get(taskId).count,
  );
  return {
    items: pageRows.map((row) => JSON.parse(row.payload_json)),
    total,
    nextCursor:
      hasMore && pageRows.length
        ? encodePageCursor([String(pageRows.at(-1).sort_value), String(pageRows.at(-1).id)])
        : null,
  };
}

export function assertImportState(state) {
  if (!state || typeof state !== "object" || !Array.isArray(state.tasks)) {
    throw new Error("Legacy JSON task store must contain a tasks array.");
  }
  if (!Number.isInteger(state.nextId) || state.nextId < 1) {
    throw new Error("Legacy JSON task store nextId is invalid.");
  }
  const ids = new Set();
  for (const task of state.tasks) {
    if (!task?.id || ids.has(task.id)) throw new Error("Legacy JSON task IDs must be present and unique.");
    ids.add(task.id);
    if (!Array.isArray(task.artifacts) || !Array.isArray(task.events) || !Array.isArray(task.runs)) {
      throw new Error(`${task.id} is missing retained artifact, event, or run arrays.`);
    }
  }
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function upsertArtifact(db, taskId, row) {
  db.prepare(`
    INSERT INTO artifacts(task_id, id, ordinal, created_at, stage, metadata_json, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(task_id, id) DO UPDATE SET
      ordinal = excluded.ordinal,
      created_at = excluded.created_at,
      stage = excluded.stage,
      metadata_json = excluded.metadata_json,
      payload_json = excluded.payload_json
  `).run(taskId, row.id, row.ordinal, row.sort, row.type, row.metadata, row.payload);
}

function upsertEvent(db, taskId, row) {
  db.prepare(`
    INSERT INTO events(task_id, id, ordinal, occurred_at, category, payload_json)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(task_id, id) DO UPDATE SET
      ordinal = excluded.ordinal,
      occurred_at = excluded.occurred_at,
      category = excluded.category,
      payload_json = excluded.payload_json
  `).run(taskId, row.id, row.ordinal, row.sort, row.type, row.payload);
}

function upsertRun(db, taskId, row) {
  db.prepare(`
    INSERT INTO runs(task_id, id, ordinal, started_at, stage, status, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(task_id, id) DO UPDATE SET
      ordinal = excluded.ordinal,
      started_at = excluded.started_at,
      stage = excluded.stage,
      status = excluded.status,
      payload_json = excluded.payload_json
  `).run(taskId, row.id, row.ordinal, row.sort, row.type, row.status, row.payload);
}
