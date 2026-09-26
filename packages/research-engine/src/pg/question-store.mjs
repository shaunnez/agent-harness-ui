// `ResearchQuestionStore` on Postgres, and the research projects a question belongs to.
// Same methods and records as `../research-question-store.mjs`, all async; the question service
// awaits every call, so it runs on either store.

import { questionRecord } from "../research-question-store.mjs";

const QUESTION_ID_PREFIX = "RQ";

export class PgResearchQuestionStore {
  #db;

  constructor(db) {
    if (!db) throw new Error("PgResearchQuestionStore requires a database handle.");
    this.#db = db;
  }

  /** Creates the question, or returns the one an earlier delivery of the same external request
   *  created, with `reused: true`. Two deliveries racing each other still make one question: the
   *  loser's insert meets the unique source key and reads the winner's row. */
  async createQuestion({
    projectId,
    title,
    objective,
    profile,
    runsPlanned,
    source,
    sourceKey,
    scope = null,
    staged = false,
    answerKey = null,
    now,
  }) {
    if (sourceKey) {
      const existing = await this.findBySourceKey(sourceKey);
      if (existing) return { question: existing, reused: true };
    }
    return this.#db.transaction(async (tx) => {
      const { rows } = await tx.query("SELECT nextval('research_question_seq') AS next");
      const id = `${QUESTION_ID_PREFIX}-${String(Number(rows[0].next)).padStart(3, "0")}`;
      const inserted = await tx.query(
        `INSERT INTO research_questions(
           id, project_id, created_at, title, objective, profile, runs_planned, source_json, source_key, scope_json,
           runs_staged, answer_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (source_key) DO NOTHING`,
        [
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
          staged ? 1 : null,
          answerKey,
        ],
      );
      if (Number(inserted.rowCount) === 1) return { question: await getQuestion(tx, id), reused: false };
      const { rows: winner } = await tx.query("SELECT * FROM research_questions WHERE source_key = $1", [
        sourceKey,
      ]);
      return { question: questionRecord(winner[0]), reused: true };
    });
  }

  async findBySourceKey(sourceKey) {
    const { rows } = await this.#db.query("SELECT * FROM research_questions WHERE source_key = $1", [
      sourceKey,
    ]);
    return rows[0] ? questionRecord(rows[0]) : null;
  }

  /** The newest question asked with this answer key, or null. */
  async findByAnswerKey(answerKey) {
    const { rows } = await this.#db.query(
      "SELECT * FROM research_questions WHERE answer_key = $1 ORDER BY created_at DESC, id DESC LIMIT 1",
      [answerKey],
    );
    return rows[0] ? questionRecord(rows[0]) : null;
  }

  async getQuestion(id) {
    return getQuestion(this.#db, id);
  }

  async listQuestions(projectId) {
    const { rows } = await this.#db.query(
      "SELECT * FROM research_questions WHERE project_id = $1 ORDER BY created_at DESC, id DESC",
      [projectId],
    );
    return rows.map(questionRecord);
  }

  async attachRun(questionId, runId, label, ordinal) {
    await this.#db.query(
      "UPDATE research_runs SET question_id = $1, run_label = $2, question_ordinal = $3 WHERE id = $4",
      [questionId, label, ordinal, runId],
    );
  }

  async runOrder(questionId) {
    const { rows } = await this.#db.query(
      `SELECT id, question_ordinal AS ordinal FROM research_runs WHERE question_id = $1
       ORDER BY question_ordinal ASC NULLS FIRST, run_label ASC NULLS FIRST, id ASC`,
      [questionId],
    );
    return rows.map((row) => ({ id: row.id, ordinal: Number(row.ordinal) }));
  }

  async addReview(questionId, { decision, note, reviewer, decidedAt, evidenceSha }) {
    return this.#db.transaction(async (tx) => {
      await tx.query("SELECT id FROM research_questions WHERE id = $1 FOR UPDATE", [questionId]);
      const { rows } = await tx.query(
        "SELECT MAX(ordinal) AS highest FROM research_reviews WHERE question_id = $1",
        [questionId],
      );
      await tx.query(
        `INSERT INTO research_reviews(question_id, ordinal, decision, note, reviewer, decided_at, evidence_sha256)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [questionId, Number(rows[0]?.highest ?? 0) + 1, decision, note, reviewer, decidedAt, evidenceSha],
      );
      return latestReview(tx, questionId);
    });
  }

  async latestReview(questionId) {
    return latestReview(this.#db, questionId);
  }
}

/** Research projects. In the harness they are harness projects of kind `research`; here they are
 *  the service's own, in the shape the question service reads (`{id, name, kind, archivedAt}`). */
export class PgResearchProjectStore {
  #db;

  constructor(db) {
    if (!db) throw new Error("PgResearchProjectStore requires a database handle.");
    this.#db = db;
  }

  async list() {
    const { rows } = await this.#db.query("SELECT * FROM research_projects ORDER BY created_at ASC, id ASC");
    return rows.map(projectRecord);
  }

  async get(id) {
    const { rows } = await this.#db.query("SELECT * FROM research_projects WHERE id = $1", [id]);
    return rows[0] ? projectRecord(rows[0]) : null;
  }

  /** Creates the project if it does not exist; an existing one keeps its name. */
  async ensure({ id, name, now = new Date().toISOString() }) {
    await this.#db.query(
      "INSERT INTO research_projects(id, name, created_at) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
      [id, name, now],
    );
    return this.get(id);
  }
}

async function getQuestion(db, id) {
  const { rows } = await db.query("SELECT * FROM research_questions WHERE id = $1", [id]);
  return rows[0] ? questionRecord(rows[0]) : null;
}

async function latestReview(db, questionId) {
  const { rows } = await db.query(
    "SELECT * FROM research_reviews WHERE question_id = $1 ORDER BY ordinal DESC LIMIT 1",
    [questionId],
  );
  const row = rows[0];
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

function projectRecord(row) {
  return {
    id: row.id,
    name: row.name,
    kind: "research",
    createdAt: row.created_at,
    archivedAt: row.archived_at ?? null,
  };
}
