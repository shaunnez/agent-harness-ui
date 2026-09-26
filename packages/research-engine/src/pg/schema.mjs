// The research service's Postgres schema: the same tables as the harness's SQLite research plane
// (`research-schema.mjs`), plus research projects, which in the harness are harness projects.
//
// The engine has no Postgres driver. Every Postgres module here takes a `db` with two methods,
// which the service builds from `pg` (or PGlite in tests and local runs):
//
//   db.query(text, params)          → Promise<{ rows, rowCount }>, one statement, $1… parameters
//   db.exec(text)                   → Promise<void>, any number of statements, no parameters
//   db.transaction(async (tx) => …) → Promise<the callback's result>; `tx` has `query` and `exec`
//
// Choices that keep a record reading exactly as it does from SQLite, so a question's evidence
// fingerprint is the same whichever database holds it:
// - JSON is stored as TEXT, not JSONB. JSONB reorders keys, and the fingerprint hashes JSON.
// - Times are ISO strings in TEXT, as the stores already write them.
// - Keys and times sort with the C collation, which is SQLite's byte order.
//
// Migrations are numbered and applied in order inside one transaction each, and never edited
// once released: a change is a new entry.

const MIGRATIONS = [
  {
    version: 1,
    name: "research plane",
    sql: `
      CREATE SEQUENCE IF NOT EXISTS research_run_seq START 1;
      CREATE SEQUENCE IF NOT EXISTS research_question_seq START 1;

      CREATE TABLE research_projects (
        id TEXT COLLATE "C" PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT COLLATE "C" NOT NULL,
        archived_at TEXT
      );

      CREATE TABLE research_runs (
        id TEXT COLLATE "C" PRIMARY KEY,
        created_at TEXT COLLATE "C" NOT NULL,
        updated_at TEXT COLLATE "C" NOT NULL,
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
        cancellation_requested_at TEXT,
        question_id TEXT COLLATE "C",
        run_label TEXT COLLATE "C",
        question_ordinal INTEGER,
        outcome_json TEXT
      );
      CREATE TABLE research_events (
        run_id TEXT COLLATE "C" NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
        id TEXT COLLATE "C" NOT NULL,
        ordinal INTEGER NOT NULL,
        occurred_at TEXT NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (run_id, id)
      );
      CREATE TABLE research_sources (
        run_id TEXT COLLATE "C" NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
        id TEXT COLLATE "C" NOT NULL,
        source_type TEXT NOT NULL,
        url TEXT,
        title TEXT,
        retrieved_at TEXT COLLATE "C" NOT NULL,
        content_sha256 TEXT,
        content_bytes INTEGER,
        media_type TEXT,
        metadata_json TEXT,
        PRIMARY KEY (run_id, id)
      );
      CREATE TABLE research_findings (
        run_id TEXT COLLATE "C" NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
        id TEXT COLLATE "C" NOT NULL,
        ordinal INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        produced_by TEXT NOT NULL,
        claim TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (run_id, id)
      );
      CREATE TABLE research_evidence (
        run_id TEXT COLLATE "C" NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
        finding_id TEXT COLLATE "C" NOT NULL,
        id TEXT COLLATE "C" NOT NULL,
        ordinal INTEGER NOT NULL,
        source_id TEXT COLLATE "C" NOT NULL,
        locator_json TEXT,
        excerpt TEXT,
        snapshot_ref TEXT,
        quote_verified INTEGER NOT NULL,
        authority TEXT,
        PRIMARY KEY (run_id, id),
        -- Evidence can only cite a source of the same run, as in SQLite.
        FOREIGN KEY (run_id, source_id) REFERENCES research_sources(run_id, id) ON DELETE CASCADE
      );
      CREATE TABLE research_artifacts (
        run_id TEXT COLLATE "C" NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
        id TEXT COLLATE "C" NOT NULL,
        ordinal INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        content_ref TEXT NOT NULL,
        payload_json TEXT,
        PRIMARY KEY (run_id, id)
      );
      CREATE INDEX research_runs_updated_idx ON research_runs(updated_at DESC, id DESC);
      CREATE INDEX research_runs_status_idx ON research_runs(status, updated_at DESC);
      CREATE INDEX research_runs_question_order_idx ON research_runs(question_id, question_ordinal);
      CREATE INDEX research_events_page_idx ON research_events(run_id, ordinal ASC);
      CREATE INDEX research_findings_page_idx ON research_findings(run_id, ordinal ASC);
      CREATE INDEX research_evidence_find_idx ON research_evidence(run_id, finding_id);
      CREATE INDEX research_sources_run_idx ON research_sources(run_id, retrieved_at DESC);

      CREATE TABLE research_questions (
        id TEXT COLLATE "C" PRIMARY KEY,
        project_id TEXT COLLATE "C" NOT NULL REFERENCES research_projects(id),
        created_at TEXT COLLATE "C" NOT NULL,
        title TEXT NOT NULL,
        objective TEXT NOT NULL,
        profile TEXT NOT NULL,
        runs_planned INTEGER NOT NULL,
        source_json TEXT NOT NULL,
        -- A repeated external request finds its question by this. Postgres, like SQLite, allows
        -- any number of nulls under UNIQUE.
        source_key TEXT UNIQUE,
        scope_json TEXT
      );
      CREATE TABLE research_reviews (
        question_id TEXT COLLATE "C" NOT NULL REFERENCES research_questions(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL,
        decision TEXT NOT NULL,
        note TEXT NOT NULL,
        reviewer TEXT NOT NULL,
        decided_at TEXT NOT NULL,
        evidence_sha256 TEXT NOT NULL,
        PRIMARY KEY (question_id, ordinal)
      );
      CREATE INDEX research_questions_project_idx ON research_questions(project_id, created_at DESC, id DESC);
    `,
  },
  {
    version: 2,
    name: "shared tool answers",
    sql: `
      -- Searches, captured pages and QV reads shared across runs (engine/tool-cache.mjs). Keyed by
      -- a hash of what was asked; the value is the provider's answer as JSON.
      CREATE TABLE research_tool_cache (
        kind TEXT COLLATE "C" NOT NULL,
        key_sha256 TEXT COLLATE "C" NOT NULL,
        stored_at TEXT COLLATE "C" NOT NULL,
        value_json TEXT NOT NULL,
        PRIMARY KEY (kind, key_sha256)
      );
      CREATE INDEX research_tool_cache_age_idx ON research_tool_cache(stored_at);
    `,
  },
  {
    version: 3,
    name: "staged runs and answer reuse",
    sql: `
      -- As in SQLite (research-schema.mjs): a staged five-run question, and the hash of what a
      -- question asked, by which a later identical ask may be answered.
      ALTER TABLE research_questions ADD COLUMN runs_staged INTEGER;
      ALTER TABLE research_questions ADD COLUMN answer_key TEXT COLLATE "C";
      CREATE INDEX research_questions_answer_idx ON research_questions(answer_key, created_at DESC);
    `,
  },
  {
    version: 4,
    name: "shared pacing",
    sql: `
      -- One pacing decision across the service's workers (engine/pacer-sync.mjs). Times are epoch
      -- milliseconds: they are compared, never shown.
      CREATE TABLE research_pacer (
        key TEXT COLLATE "C" PRIMARY KEY,
        lim INTEGER NOT NULL,
        successes INTEGER NOT NULL,
        cooldown_until BIGINT NOT NULL,
        halved_until BIGINT NOT NULL
      );
      CREATE TABLE research_pacer_workers (
        key TEXT COLLATE "C" NOT NULL,
        worker_id TEXT COLLATE "C" NOT NULL,
        seen_at BIGINT NOT NULL,
        PRIMARY KEY (key, worker_id)
      );
    `,
  },
];

/** The version the code expects. */
export const RESEARCH_PG_SCHEMA_VERSION = MIGRATIONS.at(-1).version;

/**
 * Brings the database up to the latest schema. Safe to call on every start, and from two
 * processes at once: an advisory lock makes the second wait for the first.
 * `extra` are the service's own migrations (its batch tables), applied after the engine's, under
 * their own names so the two sequences never collide.
 */
export async function migrateResearchSchema(db, { extra = [] } = {}) {
  const applied = [];
  await db.transaction(async (tx) => {
    // Any fixed key: it only has to be the same in every process that migrates this database.
    await tx.query("SELECT pg_advisory_xact_lock(4217012)");
    await tx.query(`
      CREATE TABLE IF NOT EXISTS research_schema_migrations (
        scope TEXT NOT NULL,
        version INTEGER NOT NULL,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL,
        PRIMARY KEY (scope, version)
      )
    `);
    const { rows } = await tx.query("SELECT scope, version FROM research_schema_migrations");
    const done = new Set(rows.map((row) => `${row.scope}:${Number(row.version)}`));
    const plans = [
      { scope: "engine", migrations: MIGRATIONS },
      ...extra.map((entry) => ({ scope: entry.scope, migrations: entry.migrations })),
    ];
    for (const { scope, migrations } of plans) {
      for (const migration of migrations) {
        if (done.has(`${scope}:${migration.version}`)) continue;
        await tx.exec(migration.sql);
        await tx.query(
          "INSERT INTO research_schema_migrations(scope, version, name, applied_at) VALUES ($1, $2, $3, $4)",
          [scope, migration.version, migration.name, new Date().toISOString()],
        );
        applied.push(`${scope}:${migration.version}`);
      }
    }
  });
  return applied;
}
