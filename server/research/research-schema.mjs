// Research-plane DDL (architecture §7.1). Additive only: nothing here alters a table, column
// or index the SDLC plane owns, and the research plane owns nothing the SDLC plane reads.
//
// Claims and evidence are first-class rows rather than JSON nested inside a run blob. Audit
// §10 identifies the missing claim -> source -> locator -> verification chain as a core gap;
// nesting it would reproduce the gap in a new table.
//
// Source identity is run-scoped. A runtime is free to number its own sources `source-1`, and
// two runs that both do so are two different sources, not one row the second run overwrites.

export function createResearchSchema(db) {
  const rebuilding = renameLegacySourceIdentity(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS research_runs (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      status TEXT NOT NULL,
      runtime_id TEXT NOT NULL,
      profile TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      request_json TEXT NOT NULL,
      budget_json TEXT NOT NULL,
      usage_json TEXT,
      budget_state_json TEXT,
      runtime_metadata_json TEXT,
      error_json TEXT,
      cancellation_requested_at TEXT
    );
    CREATE TABLE IF NOT EXISTS research_events (
      run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      occurred_at TEXT NOT NULL,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (run_id, id)
    );
    CREATE TABLE IF NOT EXISTS research_sources (
      run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      url TEXT,
      title TEXT,
      retrieved_at TEXT NOT NULL,
      content_sha256 TEXT,
      content_bytes INTEGER,
      media_type TEXT,
      metadata_json TEXT,
      PRIMARY KEY (run_id, id)
    );
    CREATE TABLE IF NOT EXISTS research_findings (
      run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      produced_by TEXT NOT NULL,
      claim TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (run_id, id)
    );
    CREATE TABLE IF NOT EXISTS research_evidence (
      run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
      finding_id TEXT NOT NULL,
      id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      source_id TEXT NOT NULL,
      locator_json TEXT,
      excerpt TEXT,
      snapshot_ref TEXT,
      quote_verified INTEGER NOT NULL,
      authority TEXT,
      PRIMARY KEY (run_id, id),
      -- Evidence can only cite a source belonging to the same run. The database, not the
      -- writer, is what makes cross-run citation impossible.
      FOREIGN KEY (run_id, source_id) REFERENCES research_sources(run_id, id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS research_artifacts (
      run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      content_ref TEXT NOT NULL,
      payload_json TEXT,
      PRIMARY KEY (run_id, id)
    );
    CREATE INDEX IF NOT EXISTS research_runs_updated_idx  ON research_runs(updated_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS research_runs_status_idx   ON research_runs(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS research_events_page_idx   ON research_events(run_id, ordinal ASC);
    CREATE INDEX IF NOT EXISTS research_findings_page_idx ON research_findings(run_id, ordinal ASC);
    CREATE INDEX IF NOT EXISTS research_evidence_find_idx ON research_evidence(run_id, finding_id);
    CREATE INDEX IF NOT EXISTS research_sources_run_idx   ON research_sources(run_id, retrieved_at DESC);
  `);
  if (rebuilding) copyLegacySourceIdentity(db);
}

/** Slice 1 briefly gave `research_sources` a globally unique id. No released schema version
 *  carries that shape, but a database opened on the slice-1 branch does, so it is renamed out
 *  of the way here and copied into the run-scoped tables below. */
function renameLegacySourceIdentity(db) {
  const existing = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'research_sources'")
    .get();
  if (!existing || existing.sql.includes("PRIMARY KEY (run_id, id)")) return false;
  db.exec(`
    DROP INDEX IF EXISTS research_sources_run_idx;
    DROP INDEX IF EXISTS research_evidence_find_idx;
    ALTER TABLE research_sources RENAME TO research_sources_legacy;
    ALTER TABLE research_evidence RENAME TO research_evidence_legacy;
  `);
  return true;
}

function copyLegacySourceIdentity(db) {
  db.exec(`
    INSERT INTO research_sources(
      run_id, id, source_type, url, title, retrieved_at, content_sha256, content_bytes,
      media_type, metadata_json)
    SELECT run_id, id, source_type, url, title, retrieved_at, content_sha256, content_bytes,
           media_type, metadata_json
    FROM research_sources_legacy;
    INSERT INTO research_evidence(
      run_id, finding_id, id, ordinal, source_id, locator_json, excerpt, snapshot_ref,
      quote_verified, authority)
    SELECT evidence.run_id, evidence.finding_id, evidence.id, evidence.ordinal, evidence.source_id,
           evidence.locator_json, evidence.excerpt, evidence.snapshot_ref, 0, evidence.authority
    FROM research_evidence_legacy AS evidence
    WHERE EXISTS (
      SELECT 1 FROM research_sources
      WHERE research_sources.run_id = evidence.run_id AND research_sources.id = evidence.source_id
    );
    DROP TABLE research_evidence_legacy;
    DROP TABLE research_sources_legacy;
  `);
}
