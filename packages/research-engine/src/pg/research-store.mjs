// `ResearchStore` on Postgres: the same methods, the same records, for the research service.
// The SQL follows `../research-store.mjs` statement for statement, and the rows are read back
// through that file's own mappers, so a run reads the same from either database.
//
// `db` is the injected handle described in `schema.mjs`. Every write that reads before it writes
// runs in a transaction, and `updateRun` still refuses a write that lost a race on `revision`.

import { verifySnapshotEvidence } from "../research-source-snapshots.mjs";
import { researchResultFromRows, runRecord, sourceRecord } from "../research-store.mjs";
import { DEFAULT_RESEARCH_SOURCE_DIRECTORY } from "../research-web-tools.mjs";

const RUN_ID_PREFIX = "RSCH";
const UNVERIFIED = 0;

export class PgResearchStore {
  #db;
  #sourceSnapshotDirectory;

  constructor(db, { sourceSnapshotDirectory = DEFAULT_RESEARCH_SOURCE_DIRECTORY } = {}) {
    if (!db) throw new Error("PgResearchStore requires a database handle.");
    this.#db = db;
    this.#sourceSnapshotDirectory = sourceSnapshotDirectory;
  }

  async createRun({ runtimeId, request, budget, now = new Date().toISOString() }) {
    return this.#db.transaction(async (tx) => {
      const { rows } = await tx.query("SELECT nextval('research_run_seq') AS next");
      const id = `${RUN_ID_PREFIX}-${String(Number(rows[0].next)).padStart(3, "0")}`;
      const stored = { ...request, id };
      await tx.query(
        `INSERT INTO research_runs(
           id, created_at, updated_at, status, runtime_id, profile, revision, request_json, budget_json)
         VALUES ($1, $2, $3, 'queued', $4, $5, 1, $6, $7)`,
        [id, now, now, runtimeId, request.profile, JSON.stringify(stored), JSON.stringify(budget)],
      );
      return readRun(tx, id);
    });
  }

  async getRun(runId) {
    return readRun(this.#db, runId);
  }

  async listRuns({ limit = 50 } = {}) {
    const { rows } = await this.#db.query(
      "SELECT * FROM research_runs ORDER BY created_at DESC, id DESC LIMIT $1",
      [Math.max(1, Math.min(200, Number(limit) || 50))],
    );
    return rows.map(runRecord);
  }

  /** Runs that had not finished when the service last stopped. */
  async listInterruptedRuns() {
    const { rows } = await this.#db.query(
      "SELECT * FROM research_runs WHERE status NOT IN ('completed', 'failed', 'cancelled')",
    );
    return rows.map(runRecord);
  }

  async updateRun(runId, mutate, { now = new Date().toISOString() } = {}) {
    return this.#db.transaction(async (tx) => {
      const { rows } = await tx.query("SELECT * FROM research_runs WHERE id = $1", [runId]);
      const row = rows[0];
      if (!row) return null;
      const draft = {
        status: row.status,
        usage: row.usage_json ? JSON.parse(row.usage_json) : null,
        budgetState: row.budget_state_json ? JSON.parse(row.budget_state_json) : null,
        error: row.error_json ? JSON.parse(row.error_json) : null,
        runtimeMetadata: row.runtime_metadata_json ? JSON.parse(row.runtime_metadata_json) : null,
        model: row.model_json ? JSON.parse(row.model_json) : null,
        cancellationRequestedAt: row.cancellation_requested_at ?? null,
      };
      mutate(draft);
      const changed = await tx.query(
        `UPDATE research_runs
         SET updated_at = $1, status = $2, revision = revision + 1, usage_json = $3, budget_state_json = $4,
             runtime_metadata_json = $5, model_json = $6, error_json = $7, cancellation_requested_at = $8
         WHERE id = $9 AND revision = $10`,
        [
          now,
          draft.status,
          draft.usage ? JSON.stringify(draft.usage) : null,
          draft.budgetState ? JSON.stringify(draft.budgetState) : null,
          draft.runtimeMetadata ? JSON.stringify(draft.runtimeMetadata) : null,
          draft.model ? JSON.stringify(draft.model) : null,
          draft.error ? JSON.stringify(draft.error) : null,
          draft.cancellationRequestedAt,
          runId,
          Number(row.revision),
        ],
      );
      if (Number(changed.rowCount) !== 1) {
        const error = new Error(`Research run ${runId} changed while it was being updated.`);
        error.statusCode = 409;
        throw error;
      }
      return readRun(tx, runId);
    });
  }

  async recordOutcome(runId, outcome) {
    await this.#db.query("UPDATE research_runs SET outcome_json = $1 WHERE id = $2", [
      outcome ? JSON.stringify(outcome) : null,
      runId,
    ]);
  }

  async runtimeMetadata(runId) {
    const { rows } = await this.#db.query("SELECT runtime_metadata_json FROM research_runs WHERE id = $1", [
      runId,
    ]);
    return rows[0]?.runtime_metadata_json ? JSON.parse(rows[0].runtime_metadata_json) : null;
  }

  async appendEvent(runId, event) {
    return this.#db.transaction(async (tx) => {
      // One consumer per run appends its events in order; the row lock keeps two from numbering
      // the same ordinal if that ever changes.
      await tx.query("SELECT id FROM research_runs WHERE id = $1 FOR UPDATE", [runId]);
      const { rows } = await tx.query(
        "SELECT MAX(ordinal) AS highest FROM research_events WHERE run_id = $1",
        [runId],
      );
      const ordinal = Number(rows[0]?.highest ?? 0) + 1;
      const stored = { ...event, runId, ordinal };
      await tx.query(
        `INSERT INTO research_events(run_id, id, ordinal, occurred_at, type, payload_json)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (run_id, id) DO NOTHING`,
        [runId, stored.id, ordinal, stored.timestamp, stored.type, JSON.stringify(stored)],
      );
      return stored;
    });
  }

  async listEvents(runId, { afterOrdinal = 0, limit = 200 } = {}) {
    const capped = Math.max(1, Math.min(500, Number(limit) || 200));
    const { rows } = await this.#db.query(
      `SELECT payload_json, ordinal FROM research_events
       WHERE run_id = $1 AND ordinal > $2
       ORDER BY ordinal ASC LIMIT $3`,
      [runId, Number(afterOrdinal) || 0, capped + 1],
    );
    const page = rows.slice(0, capped);
    return {
      events: page.map((row) => JSON.parse(row.payload_json)),
      nextCursor: rows.length > capped && page.length ? String(page.at(-1).ordinal) : null,
    };
  }

  async upsertSource(runId, source) {
    await this.#db.query(
      `INSERT INTO research_sources(
         run_id, id, source_type, url, title, retrieved_at, content_sha256, content_bytes,
         media_type, metadata_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (run_id, id) DO UPDATE SET
         url = excluded.url,
         title = excluded.title,
         retrieved_at = excluded.retrieved_at,
         content_sha256 = COALESCE(excluded.content_sha256, research_sources.content_sha256),
         content_bytes = COALESCE(excluded.content_bytes, research_sources.content_bytes),
         media_type = COALESCE(excluded.media_type, research_sources.media_type),
         metadata_json = COALESCE(excluded.metadata_json, research_sources.metadata_json)`,
      [
        runId,
        source.id,
        source.sourceType ?? "other",
        source.url ?? null,
        source.title ?? null,
        source.retrievedAt,
        source.contentSha256 ?? null,
        source.contentBytes ?? null,
        source.mediaType ?? null,
        source.metadata ? JSON.stringify(source.metadata) : null,
      ],
    );
    const { rows } = await this.#db.query("SELECT * FROM research_sources WHERE run_id = $1 AND id = $2", [
      runId,
      source.id,
    ]);
    return rows[0] ? sourceRecord(rows[0]) : null;
  }

  async listSources(runId) {
    return listSources(this.#db, runId);
  }

  async recordResult(runId, result, { now = new Date().toISOString() } = {}) {
    const verifiedEvidence = await this.#verifyResultEvidence(runId, result);
    return this.#db.transaction(async (tx) => {
      const { rows: known } = await tx.query("SELECT id FROM research_sources WHERE run_id = $1", [runId]);
      const knownIds = new Set(known.map((row) => row.id));
      for (const [index, finding] of (result.findings ?? []).entries()) {
        const { evidence = [], ...rest } = finding;
        await tx.query(
          `INSERT INTO research_findings(run_id, id, ordinal, created_at, produced_by, claim, payload_json)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (run_id, id) DO UPDATE SET
             ordinal = excluded.ordinal,
             produced_by = excluded.produced_by,
             claim = excluded.claim,
             payload_json = excluded.payload_json`,
          [runId, finding.id, index + 1, now, finding.producedBy, finding.claim, JSON.stringify(rest)],
        );
        for (const [position, reference] of evidence.entries()) {
          if (!knownIds.has(reference.sourceId)) {
            await tx.query(
              `INSERT INTO research_sources(run_id, id, source_type, url, title, retrieved_at)
               VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (run_id, id) DO NOTHING`,
              [
                runId,
                reference.sourceId,
                reference.sourceType ?? "other",
                reference.url ?? null,
                reference.title ?? null,
                reference.retrievedAt ?? now,
              ],
            );
            knownIds.add(reference.sourceId);
          }
          await tx.query(
            `INSERT INTO research_evidence(
               run_id, finding_id, id, ordinal, source_id, locator_json, excerpt, snapshot_ref,
               quote_verified, authority)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (run_id, id) DO UPDATE SET
               finding_id = excluded.finding_id,
               ordinal = excluded.ordinal,
               source_id = excluded.source_id,
               locator_json = excluded.locator_json,
               excerpt = excluded.excerpt,
               snapshot_ref = excluded.snapshot_ref,
               quote_verified = excluded.quote_verified,
               authority = excluded.authority`,
            [
              runId,
              finding.id,
              `${finding.id}#${position + 1}`,
              position + 1,
              reference.sourceId,
              reference.locator ? JSON.stringify(reference.locator) : null,
              reference.excerpt ?? null,
              reference.snapshotRef ?? null,
              verifiedEvidence.has(`${finding.id}#${position + 1}`) ? 1 : UNVERIFIED,
              reference.authority ?? null,
            ],
          );
        }
      }
      for (const [index, artifact] of (result.artifacts ?? []).entries()) {
        await tx.query(
          `INSERT INTO research_artifacts(run_id, id, ordinal, created_at, kind, name, content_ref, payload_json)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NULL)
           ON CONFLICT (run_id, id) DO UPDATE SET
             ordinal = excluded.ordinal,
             kind = excluded.kind,
             name = excluded.name,
             content_ref = excluded.content_ref`,
          [runId, artifact.id, index + 1, now, artifact.kind, artifact.name, artifact.contentRef],
        );
      }
      const summary = {
        summary: result.summary ?? null,
        unresolvedQuestions: result.unresolvedQuestions ?? [],
        truncatedBy: result.truncatedBy ?? null,
      };
      await tx.query(
        `INSERT INTO research_artifacts(run_id, id, ordinal, created_at, kind, name, content_ref, payload_json)
         VALUES ($1, '__result__', 0, $2, 'result-summary', 'Result summary', 'inline', $3)
         ON CONFLICT (run_id, id) DO UPDATE SET created_at = excluded.created_at, payload_json = excluded.payload_json`,
        [runId, now, JSON.stringify(summary)],
      );
      return true;
    });
  }

  async getResult(runId) {
    const run = await readRun(this.#db, runId);
    if (!run) return null;
    const { rows: summaryRows } = await this.#db.query(
      "SELECT payload_json FROM research_artifacts WHERE run_id = $1 AND id = '__result__'",
      [runId],
    );
    if (!summaryRows[0]) return null;
    const [sources, evidence, findings, artifacts] = await Promise.all([
      listSources(this.#db, runId),
      this.#db.query(
        "SELECT * FROM research_evidence WHERE run_id = $1 ORDER BY finding_id ASC, ordinal ASC",
        [runId],
      ),
      this.#db.query("SELECT * FROM research_findings WHERE run_id = $1 ORDER BY ordinal ASC", [runId]),
      this.#db.query(
        "SELECT * FROM research_artifacts WHERE run_id = $1 AND id <> '__result__' ORDER BY ordinal ASC",
        [runId],
      ),
    ]);
    return researchResultFromRows({
      run,
      summaryRow: summaryRows[0],
      sources,
      evidenceRows: evidence.rows,
      findingRows: findings.rows,
      artifactRows: artifacts.rows,
    });
  }

  async #verifyResultEvidence(runId, result) {
    const sources = new Map((await listSources(this.#db, runId)).map((source) => [source.id, source]));
    const verified = new Set();
    await Promise.all(
      (result.findings ?? []).flatMap((finding) =>
        (finding.evidence ?? []).map(async (reference, index) => {
          const source = sources.get(reference.sourceId);
          if (
            await verifySnapshotEvidence({
              source,
              reference,
              snapshotDirectory: this.#sourceSnapshotDirectory,
            })
          )
            verified.add(`${finding.id}#${index + 1}`);
        }),
      ),
    );
    return verified;
  }
}

async function readRun(db, runId) {
  const { rows } = await db.query("SELECT * FROM research_runs WHERE id = $1", [runId]);
  return rows[0] ? runRecord(rows[0]) : null;
}

async function listSources(db, runId) {
  const { rows } = await db.query(
    "SELECT * FROM research_sources WHERE run_id = $1 ORDER BY retrieved_at ASC, id ASC",
    [runId],
  );
  return rows.map(sourceRecord);
}
