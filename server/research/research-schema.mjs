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
      model_json TEXT,
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
  addResearchRunModelColumn(db);
  createResearchQuestionSchema(db);
}

/** A research question groups one or three runs of the same objective under a research project,
 *  and carries the reviews made of it. The question's status is not stored: it is computed from
 *  its runs every time it is read, so it cannot drift from them.
 *
 *  `source_key` is how a repeated external request (a Linear issue, a PlanCheck tender line)
 *  finds the question it already raised instead of starting three more runs. It is null for a
 *  question asked by hand, and SQLite's UNIQUE allows any number of nulls. */
function createResearchQuestionSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS research_questions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      title TEXT NOT NULL,
      objective TEXT NOT NULL,
      profile TEXT NOT NULL,
      runs_planned INTEGER NOT NULL,
      source_json TEXT NOT NULL,
      source_key TEXT UNIQUE
    );
    CREATE TABLE IF NOT EXISTS research_reviews (
      question_id TEXT NOT NULL REFERENCES research_questions(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL,
      decision TEXT NOT NULL,
      note TEXT NOT NULL,
      reviewer TEXT NOT NULL,
      decided_at TEXT NOT NULL,
      evidence_sha256 TEXT NOT NULL,
      PRIMARY KEY (question_id, ordinal)
    );
    CREATE INDEX IF NOT EXISTS research_questions_project_idx
      ON research_questions(project_id, created_at DESC, id DESC);
  `);
  const columns = new Set(
    db
      .prepare("PRAGMA table_info(research_runs)")
      .all()
      .map((column) => column.name),
  );
  // Null on every run that predates questions, and on a run submitted on its own.
  if (!columns.has("question_id")) db.exec("ALTER TABLE research_runs ADD COLUMN question_id TEXT");
  if (!columns.has("run_label")) db.exec("ALTER TABLE research_runs ADD COLUMN run_label TEXT");
  // The run's cost band and per-component citation checks, as the runtime reported them when the
  // run ended. Null for a runtime with no cost-band recipe (the fake) and for any run that failed
  // before producing one.
  if (!columns.has("outcome_json")) db.exec("ALTER TABLE research_runs ADD COLUMN outcome_json TEXT");
  const questionColumns = new Set(
    db
      .prepare("PRAGMA table_info(research_questions)")
      .all()
      .map((column) => column.name),
  );
  // The pinned scope every run was given (`research-scope.mjs`), with who scoped it. Null on a
  // question asked without one.
  if (!questionColumns.has("scope_json"))
    db.exec("ALTER TABLE research_questions ADD COLUMN scope_json TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS research_runs_question_idx ON research_runs(question_id, run_label)");
}

/** `model_json` arrived after `research_runs` existed, so a database created before it needs
 *  the column added rather than the table recreated. Null in every pre-existing row, which is
 *  the correct answer: those runs did not record what answered them. */
function addResearchRunModelColumn(db) {
  const columns = db.prepare("PRAGMA table_info(research_runs)").all();
  if (columns.some((column) => column.name === "model_json")) return;
  db.exec("ALTER TABLE research_runs ADD COLUMN model_json TEXT");
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
