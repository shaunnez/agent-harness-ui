// Research-plane DDL (architecture §7.1). Additive only: nothing here alters a table, column
// or index the SDLC plane owns, and the research plane owns nothing the SDLC plane reads.
//
// Claims and evidence are first-class rows rather than JSON nested inside a run blob. Audit
// §10 identifies the missing claim -> source -> locator -> verification chain as a core gap;
// nesting it would reproduce the gap in a new table.

export function createResearchSchema(db) {
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
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL,
      url TEXT,
      title TEXT,
      retrieved_at TEXT NOT NULL,
      content_sha256 TEXT,
      content_bytes INTEGER,
      media_type TEXT,
      metadata_json TEXT
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
      PRIMARY KEY (run_id, id)
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
}
