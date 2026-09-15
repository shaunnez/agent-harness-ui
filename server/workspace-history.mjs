import { randomUUID } from "node:crypto";
import {
  isWatchRunActive,
  materialCoreChanges,
  projectWatchRun,
  workspaceIdentity,
} from "./workspace-history-projection.mjs";

export const WORKSPACE_HISTORY_LIMIT = 5000;
const metadata = (db, key) => db.prepare("SELECT value FROM metadata WHERE key = ?").get(key)?.value;
const setMetadata = (db, key, value) =>
  db
    .prepare(
      "INSERT INTO metadata(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(key, String(value));

export function createWorkspaceHistorySchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS workspace_history (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    observed_at TEXT NOT NULL,
    task_id TEXT NOT NULL,
    payload_json TEXT NOT NULL
  );`);
}

export function initializeWorkspaceHistory(db) {
  if (!metadata(db, "workspace_source_id")) {
    setMetadata(db, "workspace_source_id", randomUUID());
    setMetadata(db, "workspace_coverage_start", new Date().toISOString());
    setMetadata(db, "workspace_history_floor", 0);
  }
  return metadata(db, "workspace_source_id");
}

export function workspaceHistoryHead(db, sourceId) {
  return {
    available: true,
    sourceId,
    upper: Number(
      db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'workspace_history'").get()?.seq ?? 0,
    ),
    floor: Number(metadata(db, "workspace_history_floor") ?? 0),
    coverageStartAt: metadata(db, "workspace_coverage_start"),
    capturedAt: new Date().toISOString(),
    reason: null,
  };
}

function append(db, task, facts) {
  // Import happens before enabling observation. Existing history is a baseline, not backfilled facts.
  if (!facts.length || !metadata(db, "workspace_source_id")) return;
  const projects =
    JSON.parse(db.prepare("SELECT payload_json FROM settings WHERE id = 1").get().payload_json).projects ??
    [];
  const identity = workspaceIdentity(task, projects);
  const observedAt = new Date().toISOString();
  const insert = db.prepare(
    "INSERT INTO workspace_history(observed_at, task_id, payload_json) VALUES (?, ?, ?)",
  );
  for (const fact of facts) insert.run(observedAt, task.id, JSON.stringify({ ...identity, ...fact }));
}

export function observeWorkspaceCore(db, previous, task) {
  append(db, task, materialCoreChanges(previous, task));
}

export function observeWorkspaceRecords(db, task) {
  if (!metadata(db, "workspace_source_id")) return;
  const facts = [];
  const artifacts = new Set(
    db
      .prepare("SELECT id FROM artifacts WHERE task_id = ?")
      .all(task.id)
      .map((row) => row.id),
  );
  for (const artifact of task.artifacts ?? [])
    if (!artifacts.has(artifact.id))
      facts.push({
        kind: "artifact-arrived",
        artifactId: artifact.id,
        stage: artifact.stage,
        label: String(artifact.name ?? "Artifact available").slice(0, 250),
        reason: null,
      });
  const runs = new Map(
    db
      .prepare("SELECT id, payload_json FROM runs WHERE task_id = ?")
      .all(task.id)
      .map((row) => [row.id, JSON.parse(row.payload_json)]),
  );
  for (const run of task.runs ?? []) {
    if (
      !["completed", "failed", "cancelled", "interrupted", "timed-out", "timed_out", "timeout"].includes(
        run.status,
      )
    )
      continue;
    const projected = projectWatchRun(run);
    if (JSON.stringify(projectWatchRun(runs.get(run.id))) === JSON.stringify(projected)) continue;
    facts.push({
      kind: "run-completed",
      run: projected,
      stage: run.stage,
      label: `Run ${run.id} · ${run.status}`,
      reason: null,
    });
  }
  append(db, task, facts);
}

export function pruneWorkspaceHistory(db) {
  if (!metadata(db, "workspace_source_id")) return;
  const upper = workspaceHistoryHead(db, null).upper;
  const floor = Math.max(0, upper - WORKSPACE_HISTORY_LIMIT);
  if (floor <= Number(metadata(db, "workspace_history_floor") ?? 0)) return;
  db.prepare("DELETE FROM workspace_history WHERE sequence <= ?").run(floor);
  setMetadata(db, "workspace_history_floor", floor);
}

function invalid(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
const integer = (value) =>
  /^\d+$/.test(value ?? "") && Number.isSafeInteger(Number(value)) ? Number(value) : null;

export function pageWorkspaceHistory(db, sourceId, params) {
  // A read snapshot binds coverage and rows even when another process commits/prunes between queries.
  db.exec("BEGIN");
  try {
    const page = readWorkspacePage(db, sourceId, params);
    db.exec("COMMIT");
    return page;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function readWorkspacePage(db, sourceId, params) {
  const head = workspaceHistoryHead(db, sourceId);
  if (params.get("sourceId") !== sourceId)
    throw invalid("The workspace source changed. Capture a new baseline.", 409);
  const after = integer(params.get("after")),
    through = integer(params.get("through"));
  const limit = params.has("limit") ? integer(params.get("limit")) : 100;
  if (after == null || through == null || after > through || through > head.upper || !limit || limit > 100)
    throw invalid("Invalid workspace history bounds or page limit.");
  let position = after;
  const cursor = params.get("cursor");
  if (cursor) {
    let decoded;
    try {
      decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    } catch {
      throw invalid("Invalid workspace history cursor.");
    }
    if (
      !Array.isArray(decoded) ||
      decoded.length !== 5 ||
      decoded[0] !== sourceId ||
      decoded[1] !== after ||
      decoded[2] !== through ||
      !Number.isSafeInteger(decoded[3]) ||
      decoded[3] < after ||
      decoded[3] > through ||
      decoded[4] !== 1
    )
      throw invalid("Workspace history cursor does not match this interval.");
    position = decoded[3];
  }
  const rows = db
    .prepare(`SELECT sequence, observed_at, payload_json FROM workspace_history
    WHERE sequence > ? AND sequence <= ? ORDER BY sequence LIMIT ?`)
    .all(position, through, limit + 1);
  const selected = rows.slice(0, limit);
  return {
    sourceId,
    after,
    through,
    items: selected.map((row) => ({
      ...JSON.parse(row.payload_json),
      sequence: Number(row.sequence),
      observedAt: row.observed_at,
    })),
    nextCursor:
      rows.length > limit
        ? Buffer.from(
            JSON.stringify([sourceId, after, through, Number(selected.at(-1).sequence), 1]),
          ).toString("base64url")
        : null,
    coverage: {
      complete: after >= head.floor,
      floor: head.floor,
      reason:
        after < head.floor
          ? "Some changes in this interval are no longer retained. This briefing is incomplete."
          : null,
    },
  };
}

export function readWatchedRun(db, taskId, runId) {
  const row = db
    .prepare(`SELECT tasks.core_json, runs.payload_json FROM tasks LEFT JOIN runs
    ON runs.task_id = tasks.id AND runs.id = ? WHERE tasks.id = ?`)
    .get(runId, taskId);
  const run = row?.payload_json ? projectWatchRun(JSON.parse(row.payload_json)) : null;
  const task = row ? JSON.parse(row.core_json) : null;
  return {
    taskId,
    run,
    active: isWatchRunActive(task, run),
  };
}
