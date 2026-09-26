// Eversor-owned research persistence. Everything here is a concept Eversor defined: run
// identity, lifecycle, budget, normalized usage, normalized error, claims and evidence.
//
// Two things are deliberately not here. Runtime working state (a graph checkpoint, a session
// handle) belongs to the runtime and stays in the runtime; a runtime's correlation
// identifiers live in `runtime_metadata_json`, which only an adapter reads and which no
// projection exposes. Delete a runtime and this schema still describes the research.
//
// The handle is shared with `SqliteTaskStore` rather than opened a second time: one file, one
// lock, one transaction boundary. That is safe because every transaction below runs to
// COMMIT synchronously, so a task transaction and a research transaction can never interleave
// on the single-threaded event loop.

import { verifySnapshotEvidence } from "./research-source-snapshots.mjs";
import { DEFAULT_RESEARCH_SOURCE_DIRECTORY } from "./research-web-tools.mjs";

const RUN_ID_PREFIX = "RSCH";

/** The only value `recordResult` may write to `quote_verified`. See the call site. */
const UNVERIFIED = 0;

export class ResearchStore {
  #db;
  #sourceSnapshotDirectory;

  constructor(db, { sourceSnapshotDirectory = DEFAULT_RESEARCH_SOURCE_DIRECTORY } = {}) {
    if (!db) throw new Error("ResearchStore requires an open database handle.");
    this.#db = db;
    this.#sourceSnapshotDirectory = sourceSnapshotDirectory;
  }

  async createRun({ runtimeId, request, budget, now = new Date().toISOString() }) {
    return this.#transaction(() => {
      const id = this.#nextRunId();
      const stored = { ...request, id };
      this.#db
        .prepare(`
        INSERT INTO research_runs(
          id, created_at, updated_at, status, runtime_id, profile, revision,
          request_json, budget_json, usage_json, budget_state_json, runtime_metadata_json,
          model_json, error_json, cancellation_requested_at)
        VALUES (?, ?, ?, 'queued', ?, ?, 1, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL)
      `)
        .run(id, now, now, runtimeId, request.profile, JSON.stringify(stored), JSON.stringify(budget));
      return this.#readRun(id);
    });
  }

  async getRun(runId) {
    return this.#readRun(runId);
  }

  async listRuns({ limit = 50 } = {}) {
    const rows = this.#db
      .prepare(`
      SELECT * FROM research_runs ORDER BY created_at DESC, id DESC LIMIT ?
    `)
      .all(Math.max(1, Math.min(200, Number(limit) || 50)));
    return rows.map(runRecord);
  }

  /** Runs that had not finished when the companion last stopped. */
  async listInterruptedRuns() {
    return this.#db
      .prepare("SELECT * FROM research_runs WHERE status NOT IN ('completed', 'failed', 'cancelled')")
      .all()
      .map(runRecord);
  }

  /** Apply `mutate` to a mutable draft of the run's writable fields under the recorded
   *  revision, the same optimistic-concurrency shape `tasks` uses. A competing write bumps the
   *  revision and this throws rather than silently overwriting it. */
  async updateRun(runId, mutate, { now = new Date().toISOString() } = {}) {
    return this.#transaction(() => {
      const row = this.#db.prepare("SELECT * FROM research_runs WHERE id = ?").get(runId);
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
      const changed = this.#db
        .prepare(`
        UPDATE research_runs
        SET updated_at = ?, status = ?, revision = revision + 1, usage_json = ?, budget_state_json = ?,
            runtime_metadata_json = ?, model_json = ?, error_json = ?, cancellation_requested_at = ?
        WHERE id = ? AND revision = ?
      `)
        .run(
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
        );
      if (Number(changed.changes) !== 1) {
        const error = new Error(`Research run ${runId} changed while it was being updated.`);
        error.statusCode = 409;
        throw error;
      }
      return this.#readRun(runId);
    });
  }

  /** The run's cost band and citation checks, written once when it ends. Kept beside the neutral
   *  result rather than inside it: agreement across a question's runs needs the recipe's numbers,
   *  and the findings carry them only as prose. */
  async recordOutcome(runId, outcome) {
    this.#db
      .prepare("UPDATE research_runs SET outcome_json = ? WHERE id = ?")
      .run(outcome ? JSON.stringify(outcome) : null, runId);
  }

  /** Adapter-only. The runtime's correlation identifiers never reach a projection or a route,
   *  which is what keeps `ResearchRunRecord` free of runtime vocabulary. */
  async runtimeMetadata(runId) {
    const row = this.#db.prepare("SELECT runtime_metadata_json FROM research_runs WHERE id = ?").get(runId);
    if (!row?.runtime_metadata_json) return null;
    return JSON.parse(row.runtime_metadata_json);
  }

  /** Append-only, ascending ordinal. Events are an ingest stream, not a synchronised
   *  collection, so this is not the delete-and-reinsert pattern task collections use. */
  async appendEvent(runId, event) {
    return this.#transaction(() => {
      const previous = this.#db
        .prepare("SELECT MAX(ordinal) AS highest FROM research_events WHERE run_id = ?")
        .get(runId);
      const ordinal = Number(previous?.highest ?? 0) + 1;
      const stored = { ...event, runId, ordinal };
      this.#db
        .prepare(`
        INSERT INTO research_events(run_id, id, ordinal, occurred_at, type, payload_json)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(run_id, id) DO NOTHING
      `)
        .run(runId, stored.id, ordinal, stored.timestamp, stored.type, JSON.stringify(stored));
      return stored;
    });
  }

  async listEvents(runId, { afterOrdinal = 0, limit = 200 } = {}) {
    const capped = Math.max(1, Math.min(500, Number(limit) || 200));
    const rows = this.#db
      .prepare(`
      SELECT payload_json, ordinal FROM research_events
      WHERE run_id = ? AND ordinal > ?
      ORDER BY ordinal ASC LIMIT ?
    `)
      .all(runId, Number(afterOrdinal) || 0, capped + 1);
    const page = rows.slice(0, capped);
    return {
      events: page.map((row) => JSON.parse(row.payload_json)),
      nextCursor: rows.length > capped && page.length ? String(page.at(-1).ordinal) : null,
    };
  }

  async upsertSource(runId, source) {
    return this.#transaction(() => {
      this.#db
        .prepare(`
        INSERT INTO research_sources(
          run_id, id, source_type, url, title, retrieved_at, content_sha256, content_bytes,
          media_type, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(run_id, id) DO UPDATE SET
          url = excluded.url,
          title = excluded.title,
          retrieved_at = excluded.retrieved_at,
          content_sha256 = COALESCE(excluded.content_sha256, research_sources.content_sha256),
          content_bytes = COALESCE(excluded.content_bytes, research_sources.content_bytes),
          media_type = COALESCE(excluded.media_type, research_sources.media_type),
          metadata_json = COALESCE(excluded.metadata_json, research_sources.metadata_json)
      `)
        .run(
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
        );
      return this.#readSource(runId, source.id);
    });
  }

  async listSources(runId) {
    return this.#db
      .prepare("SELECT * FROM research_sources WHERE run_id = ? ORDER BY retrieved_at ASC, id ASC")
      .all(runId)
      .map(sourceRecord);
  }

  /** Persist the deliverable. Sources referenced by evidence but never announced through a
   *  `source.retrieved` event are backfilled here, so an evidence row can never point at a
   *  source the operator cannot inspect. */
  async recordResult(runId, result, { now = new Date().toISOString() } = {}) {
    const verifiedEvidence = await this.#verifyResultEvidence(runId, result);
    return this.#transaction(() => {
      const known = new Set(
        this.#db
          .prepare("SELECT id FROM research_sources WHERE run_id = ?")
          .all(runId)
          .map((row) => row.id),
      );
      const insertFinding = this.#db.prepare(`
        INSERT INTO research_findings(run_id, id, ordinal, created_at, produced_by, claim, payload_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(run_id, id) DO UPDATE SET
          ordinal = excluded.ordinal,
          produced_by = excluded.produced_by,
          claim = excluded.claim,
          payload_json = excluded.payload_json
      `);
      const insertEvidence = this.#db.prepare(`
        INSERT INTO research_evidence(
          run_id, finding_id, id, ordinal, source_id, locator_json, excerpt, snapshot_ref,
          quote_verified, authority)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(run_id, id) DO UPDATE SET
          finding_id = excluded.finding_id,
          ordinal = excluded.ordinal,
          source_id = excluded.source_id,
          locator_json = excluded.locator_json,
          excerpt = excluded.excerpt,
          snapshot_ref = excluded.snapshot_ref,
          quote_verified = excluded.quote_verified,
          authority = excluded.authority
      `);
      for (const [index, finding] of (result.findings ?? []).entries()) {
        const { evidence = [], ...rest } = finding;
        insertFinding.run(
          runId,
          finding.id,
          index + 1,
          now,
          finding.producedBy,
          finding.claim,
          JSON.stringify(rest),
        );
        for (const [position, reference] of evidence.entries()) {
          if (!known.has(reference.sourceId)) {
            this.#db
              .prepare(`
              INSERT INTO research_sources(run_id, id, source_type, url, title, retrieved_at)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(run_id, id) DO NOTHING
            `)
              .run(
                runId,
                reference.sourceId,
                reference.sourceType ?? "other",
                reference.url ?? null,
                reference.title ?? null,
                reference.retrievedAt ?? now,
              );
            known.add(reference.sourceId);
          }
          insertEvidence.run(
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
          );
        }
      }
      for (const [index, artifact] of (result.artifacts ?? []).entries()) {
        this.#db
          .prepare(`
          INSERT INTO research_artifacts(run_id, id, ordinal, created_at, kind, name, content_ref, payload_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
          ON CONFLICT(run_id, id) DO UPDATE SET
            ordinal = excluded.ordinal,
            kind = excluded.kind,
            name = excluded.name,
            content_ref = excluded.content_ref
        `)
          .run(runId, artifact.id, index + 1, now, artifact.kind, artifact.name, artifact.contentRef);
      }
      const summary = {
        summary: result.summary ?? null,
        unresolvedQuestions: result.unresolvedQuestions ?? [],
        truncatedBy: result.truncatedBy ?? null,
      };
      this.#db
        .prepare(`
        INSERT INTO research_artifacts(run_id, id, ordinal, created_at, kind, name, content_ref, payload_json)
        VALUES (?, '__result__', 0, ?, 'result-summary', 'Result summary', 'inline', ?)
        ON CONFLICT(run_id, id) DO UPDATE SET created_at = excluded.created_at, payload_json = excluded.payload_json
      `)
        .run(runId, now, JSON.stringify(summary));
      return true;
    });
  }

  /** Rebuild the neutral `ResearchResult` from the rows. Nothing is read back out of the
   *  runtime, which is what makes "remove the runtime, keep the research" true. */
  async getResult(runId) {
    const run = this.#readRun(runId);
    if (!run) return null;
    const summaryRow = this.#db
      .prepare("SELECT payload_json FROM research_artifacts WHERE run_id = ? AND id = '__result__'")
      .get(runId);
    if (!summaryRow) return null;
    return researchResultFromRows({
      run,
      summaryRow,
      sources: this.listSourcesSync(runId),
      evidenceRows: this.#db
        .prepare("SELECT * FROM research_evidence WHERE run_id = ? ORDER BY finding_id ASC, ordinal ASC")
        .all(runId),
      findingRows: this.#db
        .prepare("SELECT * FROM research_findings WHERE run_id = ? ORDER BY ordinal ASC")
        .all(runId),
      artifactRows: this.#db
        .prepare(
          "SELECT * FROM research_artifacts WHERE run_id = ? AND id <> '__result__' ORDER BY ordinal ASC",
        )
        .all(runId),
    });
  }

  listSourcesSync(runId) {
    return this.#db
      .prepare("SELECT * FROM research_sources WHERE run_id = ? ORDER BY retrieved_at ASC, id ASC")
      .all(runId)
      .map(sourceRecord);
  }

  async #verifyResultEvidence(runId, result) {
    const sources = new Map(this.listSourcesSync(runId).map((source) => [source.id, source]));
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
          ) {
            verified.add(`${finding.id}#${index + 1}`);
          }
        }),
      ),
    );
    return verified;
  }

  #readRun(runId) {
    const row = this.#db.prepare("SELECT * FROM research_runs WHERE id = ?").get(runId);
    return row ? runRecord(row) : null;
  }

  #readSource(runId, sourceId) {
    const row = this.#db
      .prepare("SELECT * FROM research_sources WHERE run_id = ? AND id = ?")
      .get(runId, sourceId);
    return row ? sourceRecord(row) : null;
  }

  #nextRunId() {
    const row = this.#db.prepare("SELECT value FROM metadata WHERE key = 'research_next_id'").get();
    const next = Number(row?.value ?? 1);
    this.#db
      .prepare(
        "INSERT INTO metadata(key, value) VALUES ('research_next_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(String(next + 1));
    return `${RUN_ID_PREFIX}-${String(next).padStart(3, "0")}`;
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
}

/** A `research_runs` row as the run record every reader sees. Shared with the Postgres store
 *  (`pg/research-store.mjs`), so both databases give the same record. */
export function runRecord(row) {
  const request = JSON.parse(row.request_json);
  return {
    id: row.id,
    runtimeId: row.runtime_id,
    // Null until the runtime reports one. Never defaulted: see `readResearchModelIdentity`.
    model: row.model_json ? JSON.parse(row.model_json) : null,
    profile: row.profile,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revision: Number(row.revision),
    objective: request.objective,
    request,
    budget: JSON.parse(row.budget_json),
    usage: row.usage_json ? JSON.parse(row.usage_json) : null,
    budgetState: row.budget_state_json ? JSON.parse(row.budget_state_json) : null,
    error: row.error_json ? JSON.parse(row.error_json) : null,
    cancellationRequestedAt: row.cancellation_requested_at ?? null,
    // Present only on a run that belongs to a question or reported a cost band, so a run
    // submitted on its own reads exactly as it did before questions existed.
    ...(row.question_id
      ? {
          questionId: row.question_id,
          runLabel: row.run_label ?? null,
          questionOrdinal: row.question_ordinal ?? null,
        }
      : {}),
    ...(row.outcome_json ? { outcome: JSON.parse(row.outcome_json) } : {}),
  };
}

export function sourceRecord(row) {
  return {
    id: row.id,
    runId: row.run_id,
    sourceType: row.source_type,
    url: row.url ?? null,
    title: row.title ?? null,
    retrievedAt: row.retrieved_at,
    contentSha256: row.content_sha256 ?? null,
    contentBytes: row.content_bytes == null ? null : Number(row.content_bytes),
    mediaType: row.media_type ?? null,
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) : null,
  };
}

/** Rebuild the neutral `ResearchResult` from the rows. Nothing is read back out of the runtime,
 *  which is what makes "remove the runtime, keep the research" true. Shared with the Postgres
 *  store. */
export function researchResultFromRows({
  run,
  summaryRow,
  sources,
  evidenceRows,
  findingRows,
  artifactRows,
}) {
  const summary = JSON.parse(summaryRow.payload_json);
  const byId = new Map(sources.map((source) => [source.id, source]));
  const evidenceByFinding = new Map();
  for (const row of evidenceRows) {
    const source = byId.get(row.source_id);
    const reference = {
      sourceId: row.source_id,
      sourceType: source?.sourceType ?? "other",
      ...(source?.url ? { url: source.url } : {}),
      ...(source?.title ? { title: source.title } : {}),
      retrievedAt: source?.retrievedAt ?? run.createdAt,
      ...(row.locator_json ? { locator: JSON.parse(row.locator_json) } : {}),
      ...(row.excerpt == null ? {} : { excerpt: row.excerpt }),
      ...(row.snapshot_ref ? { snapshotRef: row.snapshot_ref } : {}),
      quoteVerified: Number(row.quote_verified) === 1,
      ...(row.authority ? { authority: row.authority } : {}),
    };
    const bucket = evidenceByFinding.get(row.finding_id) ?? [];
    bucket.push(reference);
    evidenceByFinding.set(row.finding_id, bucket);
  }
  const findings = findingRows.map((row) => ({
    ...JSON.parse(row.payload_json),
    id: row.id,
    claim: row.claim,
    producedBy: row.produced_by,
    evidence: evidenceByFinding.get(row.id) ?? [],
  }));
  const artifacts = artifactRows.map((row) => ({
    id: row.id,
    kind: row.kind,
    name: row.name,
    contentRef: row.content_ref,
  }));
  return {
    runId: run.id,
    // Read back from the run, not from whatever the runtime put in the result blob, so a
    // finding always reports the identity the run itself is stamped with.
    ...(run.model ? { model: run.model } : {}),
    ...(summary.summary ? { summary: summary.summary } : {}),
    findings,
    artifacts,
    usage: run.usage ?? { partial: true },
    ...(summary.unresolvedQuestions?.length ? { unresolvedQuestions: summary.unresolvedQuestions } : {}),
    ...(summary.truncatedBy ? { truncatedBy: summary.truncatedBy } : {}),
  };
}
