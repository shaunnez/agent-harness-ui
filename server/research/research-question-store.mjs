// Research questions and their reviews. A question is the unit a research project shows: one
// objective, answered by one or three runs that the research plane already stores. This file owns
// only the grouping and the reviews; the runs, their events, sources and results stay in
// `ResearchStore`, and a question never copies them.
//
// It shares the database handle with `ResearchStore` and `SqliteTaskStore`, and every
// transaction runs to COMMIT synchronously, as theirs do.

const QUESTION_ID_PREFIX = "RQ";

export class ResearchQuestionStore {
  #db;

  constructor(db) {
    if (!db) throw new Error("ResearchQuestionStore requires an open database handle.");
    this.#db = db;
  }

  /** Creates the question, or returns the one an earlier delivery of the same external request
   *  created, with `reused: true`. Checked and inserted in one transaction, so two deliveries
   *  racing each other still produce one question. */
  createQuestion({
    projectId,
    title,
    objective,
    profile,
    runsPlanned,
    source,
    sourceKey,
    scope = null,
    now,
  }) {
    return this.#transaction(() => {
      if (sourceKey) {
        const existing = this.findBySourceKey(sourceKey);
        if (existing) return { question: existing, reused: true };
      }
      const id = this.#nextQuestionId();
      this.#db
        .prepare(`
        INSERT INTO research_questions(
          id, project_id, created_at, title, objective, profile, runs_planned, source_json, source_key,
          scope_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
        .run(
          id,
          projectId,
          now,
          title,
          objective,
          profile,
          runsPlanned,
          JSON.stringify(source),
          sourceKey ?? null,
          scope ? JSON.stringify(scope) : null,
        );
      return { question: this.getQuestion(id), reused: false };
    });
  }

  /** The question an external request already raised, or null. */
  findBySourceKey(sourceKey) {
    const row = this.#db.prepare("SELECT * FROM research_questions WHERE source_key = ?").get(sourceKey);
    return row ? questionRecord(row) : null;
  }

  getQuestion(id) {
    const row = this.#db.prepare("SELECT * FROM research_questions WHERE id = ?").get(id);
    return row ? questionRecord(row) : null;
  }

  listQuestions(projectId) {
    return this.#db
      .prepare("SELECT * FROM research_questions WHERE project_id = ? ORDER BY created_at DESC, id DESC")
      .all(projectId)
      .map(questionRecord);
  }

  /** Binds a started run to its question. The run row already exists; only its grouping changes.
   *  `ordinal` counts from 1 across every attempt, so a retry's runs follow the ones it replaces. */
  attachRun(questionId, runId, label, ordinal) {
    this.#db
      .prepare("UPDATE research_runs SET question_id = ?, run_label = ?, question_ordinal = ? WHERE id = ?")
      .run(questionId, label, ordinal, runId);
  }

  /** The question's run ids and ordinals in the order they were started, every attempt included. */
  runOrder(questionId) {
    return this.#db
      .prepare(`
      SELECT id, question_ordinal AS ordinal FROM research_runs WHERE question_id = ?
      ORDER BY question_ordinal ASC, run_label ASC, id ASC
    `)
      .all(questionId)
      .map((row) => ({ id: row.id, ordinal: Number(row.ordinal) }));
  }

  addReview(questionId, { decision, note, reviewer, decidedAt, evidenceSha }) {
    return this.#transaction(() => {
      const previous = this.#db
        .prepare("SELECT MAX(ordinal) AS highest FROM research_reviews WHERE question_id = ?")
        .get(questionId);
      this.#db
        .prepare(`
        INSERT INTO research_reviews(
          question_id, ordinal, decision, note, reviewer, decided_at, evidence_sha256)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
        .run(
          questionId,
          Number(previous?.highest ?? 0) + 1,
          decision,
          note,
          reviewer,
          decidedAt,
          evidenceSha,
        );
      return this.latestReview(questionId);
    });
  }

  /** The review that stands. Earlier ones are kept, so a changed mind leaves a trail. */
  latestReview(questionId) {
    const row = this.#db
      .prepare("SELECT * FROM research_reviews WHERE question_id = ? ORDER BY ordinal DESC LIMIT 1")
      .get(questionId);
    return row
      ? {
          decision: row.decision,
          note: row.note,
          reviewer: row.reviewer,
          decidedAt: row.decided_at,
          evidenceSha: row.evidence_sha256,
        }
      : null;
  }

  #nextQuestionId() {
    const row = this.#db.prepare("SELECT value FROM metadata WHERE key = 'research_question_next_id'").get();
    const next = Number(row?.value ?? 1);
    this.#db
      .prepare(
        "INSERT INTO metadata(key, value) VALUES ('research_question_next_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(String(next + 1));
    return `${QUESTION_ID_PREFIX}-${String(next).padStart(3, "0")}`;
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

function questionRecord(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    createdAt: row.created_at,
    title: row.title,
    objective: row.objective,
    profile: row.profile,
    runsPlanned: Number(row.runs_planned),
    source: JSON.parse(row.source_json),
    // `{scope, scopedBy, reviewed}`, or null for a question asked without a scope.
    scope: row.scope_json ? JSON.parse(row.scope_json) : null,
  };
}
